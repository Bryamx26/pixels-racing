import { CARS } from '../../shared/cars/roster';
import type { RaceState } from '../../shared/race/race';
import type { Track } from '../../shared/track/track';
import { isoX, isoY } from './iso';

/** Minicarte isométrique : tracé du circuit et point de chaque voiture. */
export class Minimap {
  private base: HTMLCanvasElement | null = null;
  private trackId = '';
  private scale = 1;
  private ox = 0;
  private oy = 0;

  private px(x: number, y: number): [number, number] {
    return [(isoX(x, y) + this.ox) * this.scale + 4, (isoY(x, y) + this.oy) * this.scale + 4];
  }

  constructor(private canvas: HTMLCanvasElement) {}

  private prepare(t: Track): void {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < t.n; i++) {
      const sx = isoX(t.xs[i], t.ys[i]), sy = isoY(t.xs[i], t.ys[i]);
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    const W = 168;
    this.ox = -x0;
    this.oy = -y0;
    this.scale = (W - 8) / (x1 - x0);
    const H = Math.round((y1 - y0) * this.scale + 8);
    this.canvas.width = W;
    this.canvas.height = H;
    const b = document.createElement('canvas');
    b.width = W;
    b.height = H;
    const g = b.getContext('2d')!;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= t.n; i += 3) {
      const k = i % t.n;
      const [x, y] = this.px(t.xs[k], t.ys[k]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.strokeStyle = '#000';
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = '#d6d6e0';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffcc33';
    const [sx, sy] = this.px(t.xs[0], t.ys[0]);
    g.fillRect(sx - 2, sy - 2, 4, 4);
    this.base = b;
    this.trackId = t.def.id;
  }

  draw(t: Track, state: RaceState, myId: string): void {
    if (this.trackId !== t.def.id) this.prepare(t);
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base!, 0, 0);
    const me = state.racers.find((r) => r.id === myId);
    for (const r of [...state.racers.filter((r) => r !== me), ...(me ? [me] : [])]) {
      const [fx, fy] = this.px(r.x, r.y);
      const x = Math.round(fx), y = Math.round(fy);
      const s = r === me ? 7 : 5;
      g.fillStyle = '#000';
      g.fillRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
      g.fillStyle = r === me ? '#ffcc33' : CARS[r.carId]?.color ?? '#fff';
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
}
