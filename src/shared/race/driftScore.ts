import type { CarBody } from '../cars/physics';

/**
 * Score du mode drift. Tant que la voiture glisse en travers (angle et vitesse suffisants),
 * des points s'accumulent dans un combo dont le multiplicateur grimpe avec la durée de la
 * glisse. Le combo est encaissé quand la glisse s'arrête proprement, perdu si on tape un mur.
 */
export const DRIFT = {
  minSpeed: 140,
  /** Angle de glisse minimal (rad, ~11°) et maximal (au-delà : tête-à-queue). */
  minAngle: 0.2,
  maxAngle: 1.7,
  /** Délai de grâce entre deux glisses enchaînées (s). */
  grace: 0.7,
  /** Le multiplicateur gagne +1 toutes les `multEvery` secondes de glisse, jusqu'à ×5. */
  multEvery: 1.5,
  maxMult: 5,
  /** Choc contre un mur qui fait perdre le combo. */
  crash: 90,
};

export type DriftEvent = { type: 'banked'; points: number } | { type: 'lost'; points: number };

export class DriftScore {
  total = 0;
  combo = 0;
  mult = 1;
  angle = 0;
  drifting = false;
  /** Meilleur combo encaissé. */
  bestCombo = 0;
  private chain = 0;
  private idle = 0;

  /** Un pas de simulation ; `wallPower` : vitesse d'impact contre un mur ce pas-ci (0 sinon). */
  step(b: CarBody, wallPower: number, dt: number): DriftEvent | null {
    const cos = Math.cos(b.a), sin = Math.sin(b.a);
    const vf = b.vx * cos + b.vy * sin, vr = -b.vx * sin + b.vy * cos;
    const speed = Math.hypot(b.vx, b.vy);
    this.angle = vf > 1 ? Math.abs(Math.atan2(vr, vf)) : 0;
    this.drifting = speed > DRIFT.minSpeed && this.angle > DRIFT.minAngle && this.angle < DRIFT.maxAngle && b.spin <= 0;

    if (wallPower > DRIFT.crash && this.combo > 0) {
      const lost = Math.round(this.combo);
      this.reset();
      return { type: 'lost', points: lost };
    }
    if (this.drifting) {
      this.idle = 0;
      this.chain += dt;
      this.mult = Math.min(DRIFT.maxMult, 1 + Math.floor(this.chain / DRIFT.multEvery));
      this.combo += speed * Math.min(this.angle, 1) * dt * 6 * this.mult;
      return null;
    }
    if (this.combo > 0) {
      this.idle += dt;
      if (this.idle > DRIFT.grace) return this.bank();
    }
    return null;
  }

  /** Encaisse le combo en cours (fin de glisse, ou ligne d'arrivée). */
  bank(): DriftEvent | null {
    if (this.combo <= 0) return null;
    const points = Math.round(this.combo);
    this.total += points;
    this.bestCombo = Math.max(this.bestCombo, points);
    this.reset();
    return { type: 'banked', points };
  }

  private reset(): void {
    this.combo = 0;
    this.mult = 1;
    this.chain = 0;
    this.idle = 0;
  }
}
