import { ROAD_WIDTH } from '../constants';
import type { CarInput } from '../input';
import { clamp, mulberry32, wrapAngle } from '../math';
import { CAR, forwardSpeed, type CarBody } from '../cars/physics';
import { pointAt, wrapIdx, type Track } from '../track/track';

/** Pilote automatique : vise un point devant sur la piste et freine avant les virages. */
export class BotDriver {
  private rand: () => number;
  private lane: number;
  private laneTarget: number;
  private stuckTicks = 0;
  private reverseTicks = 0;
  private reverseSteer = 1;
  /** 1 = pilote parfait, plus bas = plus lent dans les virages. */
  readonly skill: number;
  /** Vrai quand une ligne droite s'ouvre devant (bon moment pour le turbo ou le nitro). */
  straight = false;

  constructor(seed: number, skill?: number) {
    this.rand = mulberry32(seed);
    this.skill = skill ?? 0.86 + this.rand() * 0.12;
    this.lane = this.laneTarget = (this.rand() - 0.5) * ROAD_WIDTH * 0.4;
  }

  drive(b: CarBody, track: Track): CarInput {
    const vf = forwardSpeed(b);
    // Coincé contre un mur ou une voiture : petite marche arrière en braquant à l'opposé.
    if (this.reverseTicks > 0) {
      this.reverseTicks--;
      return { throttle: 0, brake: 1, steer: this.reverseSteer };
    }
    this.stuckTicks = Math.abs(vf) < 25 ? this.stuckTicks + 1 : 0;
    if (this.stuckTicks > 45) {
      // En marche arrière, braquer à l'opposé ramène le nez vers la piste.
      const [px, py] = pointAt(track, b.idx + 10, 0);
      this.reverseSteer = wrapAngle(Math.atan2(py - b.y, px - b.x) - b.a) > 0 ? -1 : 1;
      this.stuckTicks = 0;
      this.reverseTicks = 55;
    }
    if (this.rand() < 0.01) this.laneTarget = (this.rand() - 0.5) * ROAD_WIDTH * 0.45;
    this.lane += (this.laneTarget - this.lane) * 0.02;

    const look = 7 + Math.max(0, vf) * 0.045;
    const [tx, ty] = pointAt(track, b.idx + look, this.lane);
    const diff = wrapAngle(Math.atan2(ty - b.y, tx - b.x) - b.a);
    const steer = clamp(diff * 2.6, -1, 1);

    // Courbure à venir : écart de cap entre ici et plus loin sur la piste.
    let curve = 0;
    for (const ahead of [12, 24, 36, 48]) {
      const i = wrapIdx(track, b.idx + ahead), j = wrapIdx(track, b.idx);
      const d = Math.abs(wrapAngle(Math.atan2(track.tys[i], track.txs[i]) - Math.atan2(track.tys[j], track.txs[j])));
      curve = Math.max(curve, d * (1 - ahead / 120));
    }
    const target = CAR.maxSpeed * this.skill * clamp(1.05 - curve * 0.62, 0.38, 1);
    const tooFast = vf > target + 15;
    this.straight = curve < 0.18 && vf > 180;
    return {
      throttle: tooFast ? 0 : 1,
      brake: vf > target + 45 ? 1 : 0,
      steer,
      boost: this.straight && b.boost > 0.6,
    };
  }
}
