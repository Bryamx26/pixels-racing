import { CAR_LENGTH, CAR_WIDTH } from '../../shared/constants';
import { CARS } from '../../shared/cars/roster';
import { lerp } from '../../shared/math';
import type { RoamCar, RoamEvent } from '../../shared/world/roam';
import type { Challenge, Pt, World } from '../../shared/world/world';
import { drawText } from './pixelFont';
import { ISO, groundMatrix } from './iso';
import { CAR_HEIGHT, drawIsoCar } from './isoCar';
import { GroundBaker, OX, STANDING, TILE, blockSprite, drawProp, mapX, mapY, treeSprite, worldRect, type SpriteImg } from './worldArt';

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

interface Drawable {
  key: number;
  draw: () => void;
}

/** Ce que l'interface demande de montrer en plus du décor. */
export interface WorldOverlay {
  /** Panneaux bonus encore debout. */
  boards: { id: number; x: number; y: number }[];
  /** Défi en cours, et prochain objectif (ligne d'arrivée ou point de passage). */
  active: Challenge | null;
  target: Pt | null;
}

export const KIND_COLOR: Record<Challenge['kind'], string> = {
  drift: '#c06bd8',
  driftArea: '#c06bd8',
  speedtrap: '#3fa9f5',
  speedzone: '#3fa9f5',
  sprint: '#ff9f1c',
};

const MAX_TILES = 110;
const MAX_SPRITES = 500;

/**
 * Rendu du monde ouvert : sol cuit en tuiles à la demande (gardées dans un cache), bâtiments
 * en images créées quand ils approchent, arbres partagés, voitures et effets triés par profondeur.
 */
export class WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private baker: GroundBaker;
  private tiles = new Map<string, { c: HTMLCanvasElement; used: number }>();
  private sprites = new Map<number, SpriteImg & { used: number }>();
  private particles: Particle[] = [];
  private lastRear = new Map<string, [number, number, number, number]>();
  private cam = { x: 0, y: 0, init: false };
  private view = { x: 0, y: 0 };
  private frameNo = 0;
  shake = 0;

  constructor(private canvas: HTMLCanvasElement, private world: World) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.baker = new GroundBaker(world);
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    const zoom = Math.max(0.6, Math.min(h / 330, w / 550));
    this.canvas.width = Math.ceil(w / zoom);
    this.canvas.height = Math.ceil(h / zoom);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Recentrage immédiat (voyage rapide). */
  snap(): void {
    this.cam.init = false;
    this.lastRear.clear();
  }

  private tile(i: number, j: number, budget: { n: number }): HTMLCanvasElement | null {
    const k = i + ',' + j;
    let t = this.tiles.get(k);
    if (!t) {
      if (budget.n <= 0) return null;
      budget.n--;
      t = { c: this.baker.bake(i, j), used: 0 };
      this.tiles.set(k, t);
      if (this.tiles.size > MAX_TILES) {
        const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 20);
        for (const [key] of old) this.tiles.delete(key);
      }
    }
    t.used = this.frameNo;
    return t.c;
  }

  private sprite(i: number, budget: { n: number }): SpriteImg | null {
    let s = this.sprites.get(i);
    if (!s) {
      if (budget.n <= 0) return null;
      budget.n--;
      s = { ...blockSprite(this.world.layout.blocks[i]), used: 0 };
      this.sprites.set(i, s);
      if (this.sprites.size > MAX_SPRITES) {
        const old = [...this.sprites.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 60);
        for (const [key] of old) this.sprites.delete(key);
      }
    }
    s.used = this.frameNo;
    return s;
  }

  private spawn(x: number, y: number, z: number, color: string, n: number, speed: number, life: number, size = 2): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      this.particles.push({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 20 + Math.random() * speed * 0.4, life, max: life, color, size });
    }
  }

  onEvents(events: RoamEvent[], myId: string): void {
    for (const e of events) {
      if (e.type === 'bump') {
        this.spawn(e.x, e.y, 8, '#ffd84a', 6 + Math.min(10, e.power / 30), 140, 0.35);
        this.spawn(e.x, e.y, 8, '#ff8a2a', 4, 90, 0.3);
      }
      if (e.type === 'wall' && e.power > 120) {
        this.spawn(e.x, e.y, 8, '#ffd84a', 4 + Math.min(8, e.power / 40), 120, 0.3);
        if (e.id === myId) this.shake = Math.min(8, e.power / 40);
      }
    }
  }

  /** Éclats d'un panneau bonus cassé. */
  smash(x: number, y: number): void {
    this.spawn(x, y, 14, '#ff9f1c', 18, 220, 0.6, 3);
    this.spawn(x, y, 14, '#ffe14f', 10, 160, 0.5, 2);
    this.spawn(x, y, 14, '#5a3b22', 6, 120, 0.5, 2);
  }

  private sx(x: number, y: number): number {
    return mapX(x, y) - this.view.x;
  }
  private sy(x: number, y: number, z = 0): number {
    return mapY(x, y, z) - this.view.y;
  }

  draw(cars: RoamCar[], myId: string, dt: number, ov: WorldOverlay): void {
    this.frameNo++;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const L = this.world.layout;

    const me = cars.find((c) => c.id === myId);
    if (me) {
      const tx = me.x + me.vx * 0.3, ty = me.y + me.vy * 0.3;
      if (!this.cam.init) this.cam = { x: tx, y: ty, init: true };
      else {
        const k = 1 - Math.exp(-dt * 6);
        this.cam.x = lerp(this.cam.x, tx, k);
        this.cam.y = lerp(this.cam.y, ty, k);
      }
    }
    let vx = Math.round(mapX(this.cam.x, this.cam.y) - W / 2);
    let vy = Math.round(mapY(this.cam.x, this.cam.y) - H / 2);
    if (this.shake > 0) {
      vx += Math.round((Math.random() - 0.5) * this.shake);
      vy += Math.round((Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dt * 30);
    }
    this.view = { x: vx, y: vy };

    // Sol : tuiles visibles (et préparation de celles d'à côté quand il reste du temps).
    const budget = { n: 6 };
    ctx.fillStyle = '#4a9a3c';
    ctx.fillRect(0, 0, W, H);
    const i0 = Math.floor(vx / TILE), i1 = Math.floor((vx + W) / TILE);
    const j0 = Math.floor(vy / TILE), j1 = Math.floor((vy + H) / TILE);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const t = this.tile(i, j, budget);
      if (t) ctx.drawImage(t, i * TILE - vx, j * TILE - vy);
    }
    const pre = { n: Math.min(1, budget.n) };
    for (let j = j0 - 1; j <= j1 + 1 && pre.n > 0; j++) for (let i = i0 - 1; i <= i1 + 1 && pre.n > 0; i++) this.tile(i, j, pre);

    this.trails(cars);

    // Particules.
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

    // Scène triée par profondeur. Les grands objets débordent vers le haut de l'écran :
    // on cherche plus bas que la vue.
    const scene: Drawable[] = [];
    const [wx1, wy1, wx2, wy2] = worldRect(vx - 60, vy - 40, vx + W + 60, vy + H + 260, 0);
    const blocks = this.world.query('blocks', wx1, wy1, wx2, wy2);
    const sb = { n: 24 };
    const focus = me ? { x: this.sx(me.x, me.y), y: this.sy(me.x, me.y), key: me.x + me.y } : null;
    const near: { key: number; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const i of blocks) {
      const b = L.blocks[i];
      const s = this.sprite(i, sb);
      if (!s) continue;
      const x = s.x - vx, y = s.y - vy;
      if (x > W || y > H || x + s.canvas.width < 0 || y + s.canvas.height < 0) continue;
      const key = (b.x1 + b.x2) / 2 + (b.y1 + b.y2) / 2;
      near.push({ key, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });
      scene.push({
        key,
        draw: () => {
          const hides =
            focus && b.h > 20 && key > focus.key && !(me!.x > b.x2 || me!.y > b.y2) && focus.x > x && focus.x < x + s.canvas.width && focus.y - 14 > y && focus.y < y + s.canvas.height && this.covers(b, focus.x + vx, focus.y + vy);
          ctx.globalAlpha = hides ? 0.3 : 1;
          ctx.drawImage(s.canvas, x, y);
          ctx.globalAlpha = 1;
        },
      });
    }
    for (const i of this.world.query('trees', wx1, wy1, wx2, wy2)) {
      const t = L.trees[i];
      const sx = Math.round(this.sx(t.x, t.y)), sy = Math.round(this.sy(t.x, t.y));
      if (sx < -60 || sx > W + 60 || sy < -10 || sy > H + 120) continue;
      scene.push({
        key: t.x + t.y,
        draw: () => {
          const s = treeSprite(t);
          const hides = focus && t.x + t.y > focus.key && Math.abs(focus.x - sx) < s.canvas.width / 2 && focus.y < sy && focus.y > sy - s.canvas.height + 10;
          ctx.globalAlpha = hides ? 0.45 : 1;
          ctx.drawImage(s.canvas, sx - s.ax, sy - s.ay);
          ctx.globalAlpha = 1;
        },
      });
    }
    for (const p of L.props) {
      if (!STANDING.has(p.kind) || p.x < wx1 || p.x > wx2 || p.y < wy1 || p.y > wy2) continue;
      const sx = this.sx(p.x, p.y), sy = this.sy(p.x, p.y);
      if (sx < -20 || sx > W + 20 || sy < -10 || sy > H + 60) continue;
      scene.push({ key: p.x + p.y, draw: () => drawProp(ctx, p, sx, sy) });
    }
    for (const b of ov.boards) {
      if (b.x < wx1 || b.x > wx2 || b.y < wy1 || b.y > wy2) continue;
      scene.push({ key: b.x + b.y, draw: () => this.board(b.x, b.y) });
    }
    for (const ch of L.challenges) {
      const [x, y] = ch.path[0];
      if (x < wx1 - 300 || x > wx2 + 300 || y < wy1 - 300 || y > wy2 + 300) continue;
      if (ov.active && ov.active !== ch) continue;
      scene.push({ key: x + y, draw: () => this.gate(ch, ch.path, false) });
    }
    if (ov.active && ov.target && ov.active.kind !== 'driftArea') {
      const ch = ov.active;
      const [x, y] = ov.target;
      scene.push({ key: x + y, draw: () => (ch.kind === 'sprint' ? this.beacon(x, y, KIND_COLOR.sprint) : this.gate(ch, ch.path, true)) });
    }
    // Voitures : devant ou derrière un bâtiment proche selon leur position réelle.
    for (const c of cars) {
      let key = c.x + c.y;
      for (const b of near) {
        if (c.x < b.x1 - 140 || c.x > b.x2 + 140 || c.y < b.y1 - 140 || c.y > b.y2 + 140) continue;
        if (c.x >= b.x2 - 2 || c.y >= b.y2 - 2) key = Math.max(key, b.key + 0.01);
        else key = Math.min(key, b.key - 0.01);
      }
      scene.push({ key: key + (c.id === myId ? 0.001 : 0), draw: () => this.car(c) });
    }
    scene.sort((p, q) => p.key - q.key);
    for (const d of scene) d.draw();

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(this.sx(p.x, p.y)), Math.round(this.sy(p.x, p.y, p.z)), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const c of cars) {
      if (c.id === myId) continue;
      drawText(ctx, c.name, this.sx(c.x, c.y), this.sy(c.x, c.y, CAR_HEIGHT) - 16, { align: 'center', color: CARS[c.carId]?.color ?? '#fff', shadow: '#000' });
    }
    // Flèche vers l'objectif du défi en cours.
    if (me && ov.target) {
      const a = Math.atan2(ov.target[1] - me.y, ov.target[0] - me.x);
      const dist = Math.hypot(ov.target[0] - me.x, ov.target[1] - me.y);
      if (dist > 160) {
        const cx = this.sx(me.x, me.y), cy = this.sy(me.x, me.y, CAR_HEIGHT) - 30;
        // Direction écran de la flèche (projection iso d'un vecteur au sol).
        const dx = (Math.cos(a) - Math.sin(a)) * ISO, dy = ((Math.cos(a) + Math.sin(a)) * ISO) / 2;
        const l = Math.hypot(dx, dy) || 1;
        const ux = dx / l, uy = dy / l;
        ctx.fillStyle = '#000';
        this.arrow(cx, cy, ux, uy, 11);
        ctx.fillStyle = ov.active ? KIND_COLOR[ov.active.kind] : '#fff';
        this.arrow(cx, cy, ux, uy, 8);
      }
    }
  }

  /** Le volume du bloc recouvre-t-il ce point de la carte (ou le toit de la voiture juste au-dessus) ? */
  private covers(b: { x1: number; y1: number; x2: number; y2: number; h: number }, px: number, py: number): boolean {
    const pts: Pt[] = [];
    for (const [x, y] of [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]]) for (const z of [0, b.h]) pts.push([mapX(x, y), mapY(x, y, z)]);
    const hull = convexHull(pts);
    return [0, 12].some((dy) => inConvex(hull, px, py - dy));
  }

  private arrow(cx: number, cy: number, ux: number, uy: number, s: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx + ux * s * 1.4, cy + uy * s * 1.4);
    ctx.lineTo(cx - ux * s * 0.6 - uy * s, cy - uy * s * 0.6 + ux * s);
    ctx.lineTo(cx - ux * s * 0.2, cy - uy * s * 0.2);
    ctx.lineTo(cx - ux * s * 0.6 + uy * s, cy - uy * s * 0.6 - ux * s);
    ctx.closePath();
    ctx.fill();
  }

  /** Arche de départ (ou d'arrivée) d'un défi : deux poteaux et une banderole. */
  private gate(ch: Challenge, path: Pt[], end: boolean): void {
    const ctx = this.ctx;
    const n = path.length;
    const [a, b] = end ? [path[n - 2], path[n - 1]] : [path[0], path[1]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const p = end ? b : a;
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    const half = ch.kind === 'driftArea' ? 140 : Math.min(ch.half, 150);
    const col = KIND_COLOR[ch.kind];
    const H = ch.kind === 'speedtrap' ? 46 : 58;
    const pts = [-1, 1].map((s) => [p[0] + nx * half * s, p[1] + ny * half * s] as Pt);
    const base = pts.map(([x, y]) => [this.sx(x, y), this.sy(x, y)]);
    const top = pts.map(([x, y]) => [this.sx(x, y), this.sy(x, y, H)]);
    // Ligne au sol.
    ctx.strokeStyle = end ? 'rgba(255,255,255,0.8)' : col;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(base[0][0], base[0][1]);
    ctx.lineTo(base[1][0], base[1][1]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = '#1a1a22';
      ctx.fillRect(Math.round(base[k][0]) - 2, Math.round(top[k][1]), 4, Math.round(base[k][1] - top[k][1]));
      ctx.fillStyle = '#e8e8ee';
      ctx.fillRect(Math.round(base[k][0]) - 1, Math.round(top[k][1]), 2, Math.round(base[k][1] - top[k][1]));
    }
    if (ch.kind === 'speedtrap') {
      // Radar : caméra sur un seul poteau.
      ctx.fillStyle = '#1a1a22';
      ctx.fillRect(Math.round(top[1][0]) - 6, Math.round(top[1][1]) - 6, 12, 8);
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(top[1][0]) - 5, Math.round(top[1][1]) - 5, 10, 6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(top[1][0]) + 2, Math.round(top[1][1]) - 3, 2, 2);
      return;
    }
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#1a1a22';
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    ctx.lineTo(top[1][0], top[1][1]);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.strokeStyle = end ? '#f4f4f4' : col;
    if (end) ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Point de passage d'un sprint : colonne de lumière. */
  private beacon(x: number, y: number, col: string): void {
    const ctx = this.ctx;
    const sx = Math.round(this.sx(x, y)), sy = Math.round(this.sy(x, y));
    const t = performance.now() / 1000;
    ctx.globalAlpha = 0.35 + Math.sin(t * 6) * 0.1;
    ctx.fillStyle = col;
    ctx.fillRect(sx - 8, sy - 120, 16, 120);
    ctx.globalAlpha = 0.8;
    ctx.fillRect(sx - 3, sy - 120, 6, 120);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 60, 30, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Panneau bonus (à casser) : planche orange sur deux pieds. */
  private board(x: number, y: number): void {
    const ctx = this.ctx;
    const sx = Math.round(this.sx(x, y)), sy = Math.round(this.sy(x, y));
    const bob = Math.floor(performance.now() / 400) % 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(sx - 10, sy, 22, 3);
    ctx.fillStyle = '#5a3b22';
    ctx.fillRect(sx - 8, sy - 12, 2, 12);
    ctx.fillRect(sx + 6, sy - 12, 2, 12);
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(sx - 12, sy - 28, 24, 17);
    ctx.fillStyle = bob ? '#ff9f1c' : '#ffb347';
    ctx.fillRect(sx - 11, sy - 27, 22, 15);
    drawText(ctx, '★', sx, sy - 24, { align: 'center', color: '#fff6c8', scale: 1 });
  }

  private car(r: RoamCar): void {
    const ctx = this.ctx;
    const sx = Math.round(this.sx(r.x, r.y)), sy = Math.round(this.sy(r.x, r.y));
    if (sx < -60 || sy < -60 || sx > this.canvas.width + 60 || sy > this.canvas.height + 80) return;
    const vf = r.vx * Math.cos(r.a) + r.vy * Math.sin(r.a);
    const roll = Math.max(-1, Math.min(1, (vf * (r.w ?? 0)) / 1050));
    ctx.setTransform(...groundMatrix(OX - this.view.x, -this.view.y));
    ctx.translate(r.x + 3, r.y + 3);
    ctx.rotate(r.a);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-CAR_LENGTH / 2 + 1, -CAR_WIDTH / 2, CAR_LENGTH - 2, CAR_WIDTH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawIsoCar(ctx, r.carId, r.a, sx, sy, -roll);
  }

  /** Traces de pneus (dans les tuiles en cache), poussière, flammes du turbo. */
  private trails(cars: RoamCar[]): void {
    for (const r of cars) {
      const cos = Math.cos(r.a), sin = Math.sin(r.a);
      const slip = Math.abs(-r.vx * sin + r.vy * cos);
      const speed = Math.hypot(r.vx, r.vy);
      const bx = r.x - cos * CAR_LENGTH * 0.32, by = r.y - sin * CAR_LENGTH * 0.32;
      const ox = -sin * CAR_WIDTH * 0.36, oy = cos * CAR_WIDTH * 0.36;
      const rear: [number, number, number, number] = [bx + ox, by + oy, bx - ox, by - oy];
      const prev = this.lastRear.get(r.id);
      this.lastRear.set(r.id, rear);
      if (r.offroad && speed > 60 && Math.random() < 0.6) this.spawn(bx, by, 0, Math.random() < 0.5 ? '#6b5a2e' : '#2d6a2a', 1, 40, 0.5, 3);
      if (r.boostTicks > 0) {
        for (let k = 0; k < 2; k++) {
          this.particles.push({
            x: r.x - cos * CAR_LENGTH * 0.52 + (Math.random() - 0.5) * 8 * -sin,
            y: r.y - sin * CAR_LENGTH * 0.52 + (Math.random() - 0.5) * 8 * cos,
            z: 6,
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
      const skidding = !r.offroad && (slip > 70 || r.drift);
      if (skidding && Math.random() < 0.3) this.spawn(bx, by, 0, '#cfcfd6', 1, 25, 0.7, 3);
      if (!prev || !skidding || Math.hypot(prev[0] - rear[0], prev[1] - rear[1]) > 30) continue;
      const mx = mapX(rear[0], rear[1]), my = mapY(rear[0], rear[1]);
      const tk = Math.floor(mx / TILE) + ',' + Math.floor(my / TILE);
      const t = this.tiles.get(tk);
      if (!t) continue;
      const g = t.c.getContext('2d')!;
      const [ti, tj] = tk.split(',').map(Number);
      g.setTransform(...groundMatrix(OX - ti * TILE, -tj * TILE));
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

function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function inConvex(hull: Pt[], x: number, y: number): boolean {
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}
