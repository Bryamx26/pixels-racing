import { DT } from '../../shared/constants';
import { packInput, unpackInput, type CarInput } from '../../shared/input';
import { lerp, lerpAngle } from '../../shared/math';
import type { RaceEvent, RaceState, Racer } from '../../shared/race/race';
import type { Track } from '../../shared/track/track';

/** Ce que le rendu et l'interface lisent d'une course, locale ou en ligne. */
export interface RaceView {
  readonly myId: string;
  readonly track: Track;
  readonly online: boolean;
  /** Dernier état connu (classement, tours, phase). */
  readonly state: RaceState;
  /** Avance la simulation / la prédiction jusqu'à `now` (ms). */
  update(now: number): void;
  /** État à dessiner, positions interpolées pour un rendu fluide. */
  frame(now: number): RaceState;
  /** Événements survenus depuis le dernier appel. */
  drainEvents(): RaceEvent[];
  paused: boolean;
  dispose(): void;
}

/** Applique l'aller-retour réseau à une commande pour que la prédiction locale soit identique au serveur. */
export const quantize = (i: CarInput): CarInput => unpackInput(packInput(0, i))!.input;

export type Pose = Pick<Racer, 'x' | 'y' | 'a'>;

export function lerpRacers(prev: Map<string, Pose>, cur: Racer[], t: number): Racer[] {
  return cur.map((r) => {
    const p = prev.get(r.id);
    if (!p) return r;
    return { ...r, x: lerp(p.x, r.x, t), y: lerp(p.y, r.y, t), a: lerpAngle(p.a, r.a, t) };
  });
}

/** Boucle à pas fixe côté client : nombre de ticks à jouer pour atteindre `now`. */
export class FixedClock {
  private last = -1;
  acc = 0;

  ticks(now: number): number {
    if (this.last < 0) this.last = now;
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    let n = 0;
    while (this.acc >= DT) {
      this.acc -= DT;
      n++;
    }
    return n;
  }

  get alpha(): number {
    return this.acc / DT;
  }

  reset(): void {
    this.last = -1;
    this.acc = 0;
  }
}
