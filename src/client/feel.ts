import { CAR } from '../shared/cars/physics';
import type { Sound } from './audio';
import { rumble } from './input/controls';

/** Haut de chaque rapport, en fraction de la vitesse de pointe (6 rapports). */
const GEARS = [0.16, 0.3, 0.45, 0.61, 0.79, 1.3];

export interface FeelCar {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  boostTicks: number;
  drift: boolean;
  offroad: boolean;
}

/**
 * Sensations de conduite côté client : boîte de vitesses simulée (son, compte-tours),
 * crissement des pneus, vent, vibreurs, vibrations de la manette.
 */
export class CarFeel {
  gear = 1;
  rpm = 0;
  slide = 0;
  speed01 = 0;
  private lastV = 0;
  private throttle = 0;
  private rumbleT = 0;

  constructor(private sound: Sound, private vibrate: () => boolean) {}

  update(c: FeelCar | null, dt: number, opts: { kerb?: boolean; rough?: boolean; on: boolean }): void {
    if (!c || dt <= 0) {
      this.sound.setCar(null, false);
      return;
    }
    const cos = Math.cos(c.a), sin = Math.sin(c.a);
    const vf = c.vx * cos + c.vy * sin, vr = -c.vx * sin + c.vy * cos;
    const sp = Math.hypot(c.vx, c.vy);
    const s = Math.max(0, vf) / CAR.maxSpeed;
    this.speed01 = Math.min(1.3, sp / CAR.maxSpeed);
    // Gaz estimés d'après l'accélération (le rendu ne connaît pas les commandes).
    const acc = (vf - this.lastV) / dt;
    this.lastV = vf;
    this.throttle += ((acc > 15 || c.boostTicks > 0 ? 1 : 0) - this.throttle) * Math.min(1, dt * 8);
    // Rapports avec hystérésis.
    const lo = this.gear > 1 ? GEARS[this.gear - 2] : 0, hi = GEARS[this.gear - 1];
    if (s > hi && this.gear < GEARS.length) {
      this.gear++;
      if (opts.on) this.sound.shift();
    } else if (s < lo - 0.04 && this.gear > 1) this.gear--;
    const glo = this.gear > 1 ? GEARS[this.gear - 2] : 0, ghi = GEARS[this.gear - 1];
    const target = 0.22 + 0.78 * Math.min(1, Math.max(0, (s - glo * 0.6) / (ghi - glo * 0.6)));
    this.rpm += (target - this.rpm) * Math.min(1, dt * 12);
    const slideTarget = sp > 60 ? Math.min(1, Math.max(0, (Math.abs(vr) - 40) / 160)) + (c.drift ? 0.3 : 0) : 0;
    this.slide += (Math.min(1, slideTarget) - this.slide) * Math.min(1, dt * 10);

    this.sound.setCar({ rpm: this.rpm, throttle: this.throttle, speed: Math.min(1, this.speed01), slide: this.slide, kerb: !!opts.kerb, boost: c.boostTicks > 0, rough: !!opts.rough || c.offroad }, opts.on);

    // Vibrations continues : vibreurs, hors-piste, glisse.
    this.rumbleT -= dt;
    if (opts.on && this.rumbleT <= 0) {
      const k = opts.kerb ? 0.45 : c.offroad && sp > 80 ? 0.3 : this.slide > 0.3 ? 0.18 * this.slide : 0;
      if (k > 0) rumble(this.vibrate(), k, 120);
      this.rumbleT = 0.1;
    }
  }

  /** Choc : vibration proportionnelle à la violence. */
  impact(power: number): void {
    rumble(this.vibrate(), Math.min(1, power / 300), 90 + Math.min(200, power / 2));
  }

  /** Texte du compte-tours (rapport + barre), pour le HUD. */
  gauge(): string {
    const n = 10, on = Math.round(this.rpm * n);
    const cls = this.rpm > 0.92 ? 'rpm red' : 'rpm';
    return `<span class="gear">${this.gear}</span><span class="${cls}">${'▮'.repeat(on)}<i>${'▮'.repeat(n - on)}</i></span>`;
  }
}
