import { CAR_LENGTH, CAR_WIDTH } from '../../shared/constants';
import { CARS, CAR_CELL_H, CAR_CELL_W } from '../../shared/cars/carAtlas';
import { lerp } from '../../shared/math';
import type { RaceEvent, RaceState, Racer } from '../../shared/race/race';
import type { Track } from '../../shared/track/track';
import atlasUrl from '../assets/voitures.png';
import { drawText } from './pixelFont';
import { renderTrack } from './trackArt';

export const atlas = new Image();
atlas.src = atlasUrl;
export { atlasUrl };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

/**
 * Rendu pixel art : la scène est dessinée dans un canvas basse résolution (taille de la
 * vue en unités monde) que le CSS agrandit sans lissage, plein écran.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private trackArt: HTMLCanvasElement | null = null;
  private trackId = '';
  private particles: Particle[] = [];
  private lastRear = new Map<string, [number, number, number, number]>();
  private cam = { x: 0, y: 0, init: false };
  shake = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Zoom choisi pour voir au moins ~560 × 340 unités, quel que soit l'écran (PC, mobile, portrait). */
  resize(): void {
    const w = innerWidth, h = innerHeight;
    const zoom = Math.max(0.55, Math.min(h / 340, w / 560));
    this.canvas.width = Math.ceil(w / zoom);
    this.canvas.height = Math.ceil(h / zoom);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Prépare l'image du circuit (une fois par course : les traces de pneus s'y accumulent). */
  setTrack(track: Track): void {
    this.trackArt = renderTrack(track);
    this.trackId = track.def.id;
    this.particles = [];
    this.lastRear.clear();
    this.cam.init = false;
  }

  hasTrack(id: string): boolean {
    return this.trackId === id && !!this.trackArt;
  }

  private spawn(x: number, y: number, color: string, n: number, speed: number, life: number, size = 2): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size });
    }
  }

  onEvents(events: RaceEvent[]): void {
    for (const e of events) {
      if (e.type === 'bump') {
        this.spawn(e.x, e.y, '#ffd84a', 6 + Math.min(10, e.power / 30), 140, 0.35);
        this.spawn(e.x, e.y, '#ff8a2a', 4, 90, 0.3);
      }
    }
  }

  draw(state: RaceState, focusId: string | null, dt: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    if (!this.trackArt) return;
    ctx.imageSmoothingEnabled = false;

    // Caméra : suit la voiture avec une avance dans le sens de la vitesse.
    const focus =
      state.racers.find((r) => r.id === focusId) ??
      [...state.racers].sort((p, q) => q.prog - p.prog)[0];
    if (focus) {
      const tx = focus.x + focus.vx * 0.32, ty = focus.y + focus.vy * 0.32;
      if (!this.cam.init) {
        this.cam = { x: tx, y: ty, init: true };
      } else {
        const k = 1 - Math.exp(-dt * 6);
        this.cam.x = lerp(this.cam.x, tx, k);
        this.cam.y = lerp(this.cam.y, ty, k);
      }
    }
    const art = this.trackArt;
    let cx = Math.round(this.cam.x - W / 2), cy = Math.round(this.cam.y - H / 2);
    if (this.shake > 0) {
      cx += Math.round((Math.random() - 0.5) * this.shake);
      cy += Math.round((Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dt * 30);
    }
    cx = Math.max(-W / 2, Math.min(art.width - W / 2, cx));
    cy = Math.max(-H / 2, Math.min(art.height - H / 2, cy));

    this.updateTrails(state.racers, art);

    ctx.fillStyle = '#2a5e28';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(art, cx, cy, W, H, 0, 0, W, H);

    // Particules (poussière, fumée, étincelles).
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    const sorted = [...state.racers].sort((a, b) => (a.id === focusId ? 1 : b.id === focusId ? -1 : 0));
    for (const r of sorted) this.drawCar(r, cx, cy);
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - cx), Math.round(p.y - cy), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const r of state.racers) {
      const label = r.id === focusId ? (state.phase === 'countdown' ? 'TOI' : '') : r.name;
      if (!label) continue;
      drawText(ctx, label, r.x - cx, r.y - cy - 30, {
        align: 'center',
        color: r.id === focusId ? '#ffcc33' : CARS[r.carId]?.color ?? '#fff',
        shadow: '#000',
      });
    }
  }

  private drawCar(r: Racer, cx: number, cy: number): void {
    const ctx = this.ctx;
    const x = Math.round(r.x - cx), y = Math.round(r.y - cy);
    if (x < -60 || y < -60 || x > this.canvas.width + 60 || y > this.canvas.height + 60) return;
    ctx.save();
    ctx.translate(x, y);
    // Ombre portée.
    ctx.save();
    ctx.translate(3, 4);
    ctx.rotate(r.a);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-CAR_LENGTH / 2 + 2, -CAR_WIDTH / 2 + 1, CAR_LENGTH - 4, CAR_WIDTH - 2);
    ctx.restore();
    ctx.rotate(r.a);
    const col = r.carId % 4, row = Math.floor(r.carId / 4);
    if (atlas.complete && atlas.naturalWidth) {
      ctx.drawImage(atlas, col * CAR_CELL_W, row * CAR_CELL_H, CAR_CELL_W, CAR_CELL_H, -CAR_CELL_W / 2, -CAR_CELL_H / 2, CAR_CELL_W, CAR_CELL_H);
    } else {
      ctx.fillStyle = CARS[r.carId]?.color ?? '#f0f';
      ctx.fillRect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH);
    }
    ctx.restore();
  }

  /** Traces de pneus (dessinées dans l'image du circuit) et poussière dans l'herbe. */
  private updateTrails(racers: Racer[], art: HTMLCanvasElement): void {
    const g = art.getContext('2d')!;
    for (const r of racers) {
      const cos = Math.cos(r.a), sin = Math.sin(r.a);
      const slip = Math.abs(-r.vx * sin + r.vy * cos);
      const speed = Math.hypot(r.vx, r.vy);
      const bx = r.x - cos * CAR_LENGTH * 0.32, by = r.y - sin * CAR_LENGTH * 0.32;
      const ox = -sin * CAR_WIDTH * 0.36, oy = cos * CAR_WIDTH * 0.36;
      const rear: [number, number, number, number] = [bx + ox, by + oy, bx - ox, by - oy];
      const prev = this.lastRear.get(r.id);
      this.lastRear.set(r.id, rear);
      if (r.offroad && speed > 60 && Math.random() < 0.6) {
        this.spawn(bx, by, Math.random() < 0.5 ? '#6b5a2e' : '#2d6a2a', 1, 40, 0.5, 3);
      }
      const skidding = !r.offroad && (slip > 70 || r.drift);
      if (skidding && Math.random() < 0.25) this.spawn(bx, by, '#cfcfd6', 1, 25, 0.6, 3);
      if (!prev || !skidding) continue;
      if (Math.hypot(prev[0] - rear[0], prev[1] - rear[1]) > 30) continue;
      g.strokeStyle = 'rgba(18,18,22,0.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(prev[0], prev[1]);
      g.lineTo(rear[0], rear[1]);
      g.moveTo(prev[2], prev[3]);
      g.lineTo(rear[2], rear[3]);
      g.stroke();
    }
  }
}
