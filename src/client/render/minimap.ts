import { CARS } from '../../shared/cars/carAtlas';
import type { RaceState } from '../../shared/race/race';
import type { Track } from '../../shared/track/track';

/** Minicarte : tracé du circuit et point de chaque voiture. */
export class Minimap {
  private base: HTMLCanvasElement | null = null;
  private trackId = '';
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement) {}

  private prepare(t: Track): void {
    const W = 160;
    this.scale = W / t.def.width;
    const H = Math.round(t.def.height * this.scale);
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
      if (i === 0) g.moveTo(t.xs[k] * this.scale, t.ys[k] * this.scale);
      else g.lineTo(t.xs[k] * this.scale, t.ys[k] * this.scale);
    }
    g.closePath();
    g.strokeStyle = '#000';
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = '#d6d6e0';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffcc33';
    g.fillRect(t.xs[0] * this.scale - 2, t.ys[0] * this.scale - 2, 4, 4);
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
      const x = Math.round(r.x * this.scale), y = Math.round(r.y * this.scale);
      const s = r === me ? 7 : 5;
      g.fillStyle = '#000';
      g.fillRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
      g.fillStyle = r === me ? '#ffcc33' : CARS[r.carId]?.color ?? '#fff';
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
}
