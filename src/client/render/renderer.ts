import { CAR_LENGTH, CAR_WIDTH } from '../../shared/constants';
import { CARS } from '../../shared/cars/roster';
import { lerp } from '../../shared/math';
import type { RaceEvent, RaceState, Racer } from '../../shared/race/race';
import { nearestSample, type Track } from '../../shared/track/track';
import { drawText } from './pixelFont';
import { drawSpeedFx } from './speedFx';
import { ISO, ISO_Z, groundMatrix, isoX, isoY, zAt } from './iso';
import { renderIsoTrack, type IsoArt } from './isoArt';
import { CAR_HEIGHT, CAR_SCALE, drawIsoCar } from './isoCar';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

/** Élément de la scène trié par profondeur avant d'être dessiné. */
interface Drawable {
  key: number;
  draw: () => void;
}

/**
 * Rendu pixel art isométrique : la scène est dessinée dans un canvas basse résolution que le
 * CSS agrandit sans lissage, plein écran. Le sol du circuit est une image précalculée ; les
 * voitures, le décor haut, les objets et le pont sont triés par profondeur à chaque image.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private art: IsoArt | null = null;
  private track: Track | null = null;
  /** Fantôme du contre-la-montre (meilleur tour), dessiné en transparence. */
  ghost: { x: number; y: number; a: number; carId: number } | null = null;
  private ghostCanvas = document.createElement('canvas');
  private trackId = '';
  private particles: Particle[] = [];
  private lastRear = new Map<string, [number, number, number, number]>();
  private cam = { x: 0, y: 0, init: false };
  /** Coin haut-gauche de la vue dans l'image du sol. */
  private view = { x: 0, y: 0 };
  shake = 0;
  /** Durée de préparation du décor (diagnostic). */
  bakeMs = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ghostCanvas.width = this.ghostCanvas.height = 120;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Zoom choisi pour voir au moins ~550 × 330 pixels de scène, quel que soit l'écran. */
  resize(): void {
    const w = innerWidth, h = innerHeight;
    const zoom = Math.max(0.6, Math.min(h / 330, w / 550));
    this.canvas.width = Math.ceil(w / zoom);
    this.canvas.height = Math.ceil(h / zoom);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Prépare le décor du circuit (une fois par course : les traces de pneus s'y accumulent). */
  setTrack(track: Track): void {
    const t0 = performance.now();
    this.art = renderIsoTrack(track);
    this.bakeMs = Math.round(performance.now() - t0);
    this.track = track;
    this.trackId = track.def.id;
    this.particles = [];
    this.lastRear.clear();
    this.cam.init = false;
  }

  hasTrack(id: string): boolean {
    return this.trackId === id && !!this.art;
  }

  private zOf(idx: number): number {
    return this.track ? zAt(this.track, idx) : 0;
  }

  private spawn(x: number, y: number, z: number, color: string, n: number, speed: number, life: number, size = 2): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      this.particles.push({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 20 + Math.random() * speed * 0.4, life, max: life, color, size });
    }
  }

  private zNear(x: number, y: number): number {
    const t = this.track;
    if (!t || !t.bridge) return 0;
    return zAt(t, nearestSample(t, x, y));
  }

  private lastRacers: Racer[] = [];

  onEvents(events: RaceEvent[]): void {
    for (const e of events) {
      if (e.type === 'wall' && e.power > 90) {
        // Étincelles contre le mur de pneus.
        const r = this.lastRacers.find((x) => x.id === e.id);
        if (r) this.spawn(r.x, r.y, this.zOf(r.idx) + 6, Math.random() < 0.5 ? '#ffe14f' : '#ff9a2a', 4 + Math.min(10, e.power / 40), 160, 0.3);
      }
      if (e.type === 'spin') this.spawn(e.x, e.y, this.zNear(e.x, e.y), '#1a1a1a', 10, 80, 0.6, 3);
      if (e.type === 'pickup') {
        const z = this.zNear(e.x, e.y) + 10;
        this.spawn(e.x, e.y, z, '#ffe14f', 10, 120, 0.4);
        this.spawn(e.x, e.y, z, '#ffffff', 6, 80, 0.3);
      }
      if (e.type === 'bump') {
        const z = this.zNear(e.x, e.y) + 8;
        this.spawn(e.x, e.y, z, '#ffd84a', 6 + Math.min(10, e.power / 30), 140, 0.35);
        this.spawn(e.x, e.y, z, '#ff8a2a', 4, 90, 0.3);
      }
    }
  }

  /** Position écran (dans la vue) d'un point du monde. */
  private sx(x: number, y: number): number {
    return isoX(x, y) + this.art!.ox - this.view.x;
  }
  private sy(x: number, y: number, z = 0): number {
    return isoY(x, y, z) + this.art!.oy - this.view.y;
  }

  draw(state: RaceState, focusId: string | null, dt: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const art = this.art;
    if (!art) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Caméra : suit la voiture avec une avance dans le sens de la vitesse.
    const focus =
      state.racers.find((r) => r.id === focusId) ??
      [...state.racers].sort((p, q) => q.prog - p.prog)[0];
    if (focus) {
      const tx = focus.x + focus.vx * 0.3, ty = focus.y + focus.vy * 0.3;
      if (!this.cam.init) {
        this.cam = { x: tx, y: ty, init: true };
      } else {
        const k = 1 - Math.exp(-dt * 6);
        this.cam.x = lerp(this.cam.x, tx, k);
        this.cam.y = lerp(this.cam.y, ty, k);
      }
    }
    const camZ = focus ? this.zOf(focus.idx) : 0;
    let vx = Math.round(isoX(this.cam.x, this.cam.y) + art.ox - W / 2);
    let vy = Math.round(isoY(this.cam.x, this.cam.y, camZ * 0.6) + art.oy - H / 2);
    if (this.shake > 0) {
      vx += Math.round((Math.random() - 0.5) * this.shake);
      vy += Math.round((Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dt * 30);
    }
    vx = Math.max(0, Math.min(art.ground.width - W, vx));
    vy = Math.max(0, Math.min(art.ground.height - H, vy));
    this.view = { x: vx, y: vy };

    this.updateTrails(state.racers);
    this.lastRacers = state.racers;

    ctx.fillStyle = '#2a5e28';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(art.ground, vx, vy, W, H, 0, 0, W, H);

    // Particules (poussière, fumée, étincelles).
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
      p.vz -= 60 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    this.drawOils(state);

    // Scène triée par profondeur (x + y monde). Le pont passe après les voitures du dessous
    // et avant celles qui roulent dessus.
    const t = this.track;
    const scene: Drawable[] = [];
    const bridgeKey = art.bridge?.key ?? Infinity;
    const keyOf = (r: { x: number; y: number; idx: number }) => {
      const z = this.zOf(r.idx);
      if (z > 0) return Math.max(r.x + r.y, bridgeKey + 1);
      if (t?.under && r.idx >= t.under[0] - 10 && r.idx <= t.under[1] + 10) return Math.min(r.x + r.y, bridgeKey - 1);
      return r.x + r.y;
    };
    const focusR = state.racers.find((r) => r.id === focusId);
    const fsx = focusR ? this.sx(focusR.x, focusR.y) : -1e9, fsy = focusR ? this.sy(focusR.x, focusR.y, this.zOf(focusR.idx)) : -1e9;
    for (const s of art.sprites) {
      const x = s.x - vx, y = s.y - vy;
      if (x > W || y > H || x + s.canvas.width < 0 || y + s.canvas.height < 0) continue;
      scene.push({
        key: s.depth,
        draw: () => {
          // Un décor qui cache le joueur devient transparent.
          const hides =
            focusR && s.depth > focusR.x + focusR.y && fsx > x && fsx < x + s.canvas.width && fsy - 16 > y && fsy < y + s.canvas.height;
          ctx.globalAlpha = hides ? 0.35 : 1;
          ctx.drawImage(s.canvas, x, y);
          ctx.globalAlpha = 1;
        },
      });
    }
    if (art.bridge) {
      const b = art.bridge;
      scene.push({ key: b.key, draw: () => ctx.drawImage(b.canvas, b.x - vx, b.y - vy) });
    }
    for (const p of state.pickups ?? []) {
      if (p.respawn) continue;
      const idx = t ? nearestSample(t, p.x, p.y) : 0;
      scene.push({ key: keyOf({ x: p.x, y: p.y, idx }), draw: () => this.drawPickup(p.x, p.y, this.zOf(idx)) });
    }
    if (this.ghost && t) {
      const g = this.ghost;
      const idx = nearestSample(t, g.x, g.y);
      scene.push({ key: keyOf({ x: g.x, y: g.y, idx }), draw: () => this.drawGhost(g, this.zOf(idx)) });
    }
    for (const r of state.racers) scene.push({ key: keyOf(r) + (r.id === focusId ? 0.01 : 0), draw: () => this.drawCar(r) });
    scene.sort((p, q) => p.key - q.key);
    for (const d of scene) d.draw();

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(this.sx(p.x, p.y)), Math.round(this.sy(p.x, p.y, p.z)), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const r of state.racers) {
      const label = r.id === focusId ? (state.phase === 'countdown' ? 'TOI' : '') : r.name;
      if (!label) continue;
      drawText(ctx, label, this.sx(r.x, r.y), this.sy(r.x, r.y, this.zOf(r.idx) + CAR_HEIGHT) - 16, {
        align: 'center',
        color: r.id === focusId ? '#ffcc33' : CARS[r.carId]?.color ?? '#fff',
        shadow: '#000',
      });
    }
    if (focusR && state.phase === 'race') drawSpeedFx(ctx, W, H, Math.hypot(focusR.vx, focusR.vy) / 470, focusR.boostTicks > 0, fsx, fsy);
  }

  /** Transforme le contexte pour dessiner à plat sur le sol (à la hauteur z). */
  private ground(z = 0): void {
    const art = this.art!;
    this.ctx.setTransform(...groundMatrix(art.ox - this.view.x, art.oy - this.view.y - z * ISO_Z));
  }

  private drawOils(state: RaceState): void {
    const ctx = this.ctx;
    for (const o of state.oils ?? []) {
      this.ground(this.zNear(o.x, o.y));
      ctx.fillStyle = '#0d0d10';
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, 20, 15, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2f5c';
      ctx.fillRect(o.x - 7, o.y - 5, 6, 3);
      ctx.fillStyle = '#2b5c56';
      ctx.fillRect(o.x + 2, o.y + 2, 7, 3);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Boîte d'objet : cube jaune « ? » qui flotte et tourne sur elle-même. */
  private drawPickup(x: number, y: number, z: number): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const bob = 9 + Math.sin(now * 4 + x) * 2.5;
    const sx = Math.round(this.sx(x, y)), sy = Math.round(this.sy(x, y, z));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 9, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const top = Math.round(sy - bob * ISO_Z - 14);
    const flash = Math.floor(now * 3) % 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(sx - 9, top - 4, 18, 18);
    ctx.fillStyle = flash ? '#ffcc33' : '#ff9f1c';
    ctx.fillRect(sx - 8, top + 1, 8, 12);
    ctx.fillStyle = flash ? '#d99a1c' : '#cc7413';
    ctx.fillRect(sx, top + 1, 8, 12);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(sx - 8, top - 3, 16, 4);
    drawText(ctx, '?', sx, top + 3, { align: 'center', color: '#3a1d00', scale: 1 });
  }

  private drawGhost(g: { x: number; y: number; a: number; carId: number }, z: number): void {
    const c = this.ghostCanvas, gc = c.getContext('2d')!;
    gc.clearRect(0, 0, c.width, c.height);
    gc.imageSmoothingEnabled = false;
    drawIsoCar(gc, g.carId, g.a, 60, 80);
    this.ctx.globalAlpha = 0.42;
    this.ctx.drawImage(c, Math.round(this.sx(g.x, g.y)) - 60, Math.round(this.sy(g.x, g.y, z)) - 80);
    this.ctx.globalAlpha = 1;
  }

  private drawCar(r: Racer): void {
    const ctx = this.ctx;
    const z = this.zOf(r.idx);
    const sx = Math.round(this.sx(r.x, r.y)), sy = Math.round(this.sy(r.x, r.y, z));
    if (sx < -60 || sy < -60 || sx > this.canvas.width + 60 || sy > this.canvas.height + 80) return;
    // Roulis : en virage, la caisse penche vers l'extérieur.
    const vf = r.vx * Math.cos(r.a) + r.vy * Math.sin(r.a);
    const roll = Math.max(-1, Math.min(1, (vf * (r.w ?? 0)) / 1050));
    // Ombre portée au sol.
    this.ground(z);
    ctx.translate(r.x + 3, r.y + 3);
    ctx.rotate(r.a);
    ctx.scale(CAR_SCALE, CAR_SCALE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-CAR_LENGTH / 2 + 1, -CAR_WIDTH / 2, CAR_LENGTH - 2, CAR_WIDTH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawIsoCar(ctx, r.carId, r.a, sx, sy, -roll);
    // Bouclier : bulle clignotante autour de la voiture.
    if (r.shield > 0 && (r.shield > 90 || Math.floor(r.shield / 6) % 2)) {
      ctx.strokeStyle = 'rgba(255, 225, 79, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy - CAR_HEIGHT * ISO_Z * 0.5, CAR_LENGTH * CAR_SCALE * ISO * 0.85, CAR_LENGTH * CAR_SCALE * ISO * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Traces de pneus (dessinées dans l'image du sol) et effets de particules. */
  private updateTrails(racers: Racer[]): void {
    const art = this.art!;
    const g = art.ground.getContext('2d')!;
    for (const r of racers) {
      const z = this.zOf(r.idx);
      const cos = Math.cos(r.a), sin = Math.sin(r.a);
      const slip = Math.abs(-r.vx * sin + r.vy * cos);
      const speed = Math.hypot(r.vx, r.vy);
      const bx = r.x - cos * CAR_LENGTH * 0.32, by = r.y - sin * CAR_LENGTH * 0.32;
      const ox = -sin * CAR_WIDTH * 0.36, oy = cos * CAR_WIDTH * 0.36;
      const rear: [number, number, number, number] = [bx + ox, by + oy, bx - ox, by - oy];
      const prev = this.lastRear.get(r.id);
      this.lastRear.set(r.id, rear);
      if (r.offroad && speed > 60 && Math.random() < 0.6) {
        this.spawn(bx, by, z, Math.random() < 0.5 ? '#6b5a2e' : '#2d6a2a', 1, 40, 0.5, 3);
      }
      // Turbo : flammes à l'arrière. Dégâts : fumée qui sort du capot.
      if (r.boostTicks > 0) {
        for (let k = 0; k < 2; k++) {
          this.particles.push({
            x: r.x - cos * CAR_LENGTH * 0.52 + (Math.random() - 0.5) * 8 * -sin,
            y: r.y - sin * CAR_LENGTH * 0.52 + (Math.random() - 0.5) * 8 * cos,
            z: z + 6,
            vx: -cos * 160 + r.vx * 0.5,
            vy: -sin * 160 + r.vy * 0.5,
            vz: 0,
            life: 0.15,
            max: 0.15,
            color: Math.random() < 0.5 ? '#ffe14f' : '#4fc3ff',
            size: 3,
          });
        }
      }
      if (r.damage > 0.45 && Math.random() < r.damage * 0.5) {
        this.spawn(r.x + cos * CAR_LENGTH * 0.3, r.y + sin * CAR_LENGTH * 0.3, z + 12, r.damage > 0.8 ? '#3b3b40' : '#9a9aa4', 1, 30, 0.8, 3);
      }
      // Aspiration : filets d'air blancs qui filent le long de la voiture.
      if ((r.draft ?? 0) > 0.15 && Math.random() < r.draft) {
        const side = (Math.random() - 0.5) * CAR_WIDTH * 1.6;
        this.particles.push({
          x: r.x + cos * CAR_LENGTH * 0.5 - sin * side,
          y: r.y + sin * CAR_LENGTH * 0.5 + cos * side,
          z: z + 4 + Math.random() * 12,
          vx: -cos * 260 + r.vx * 0.2,
          vy: -sin * 260 + r.vy * 0.2,
          vz: 0,
          life: 0.18,
          max: 0.18,
          color: 'rgba(255,255,255,0.8)',
          size: 2,
        });
      }
      const skidding = !r.offroad && (slip > 70 || r.drift);
      if (skidding) {
        // Fumée des pneus : plus dense quand la voiture est bien en travers.
        const puff = Math.min(1, (slip - 50) / 150) + (r.drift ? 0.4 : 0);
        if (Math.random() < puff) {
          this.spawn(bx + ox, by + oy, z, Math.random() < 0.5 ? '#e4e4ea' : '#c4c4cc', 1, 30, 0.9, 4);
          this.spawn(bx - ox, by - oy, z, '#d6d6de', 1, 30, 0.8, 3);
        }
      }
      // Pas de traces sur le pont (le sol cuit est en dessous).
      if (!prev || !skidding || z > 0) continue;
      if (Math.hypot(prev[0] - rear[0], prev[1] - rear[1]) > 30) continue;
      g.setTransform(...groundMatrix(art.ox, art.oy));
      g.strokeStyle = 'rgba(18,18,22,0.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(prev[0], prev[1]);
      g.lineTo(rear[0], rear[1]);
      g.moveTo(prev[2], prev[3]);
      g.lineTo(rear[2], rear[3]);
      g.stroke();
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
}
