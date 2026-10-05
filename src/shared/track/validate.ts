import { WALL_DIST } from '../constants';
import { wrapAngle } from '../math';
import { BRIDGE_RADIUS, buildTrack, wrapIdx, type Track } from './track';
import type { TrackDef } from './tracks';

export interface TrackProblem {
  message: string;
  /** Position du problème (monde), pour le montrer dans l'éditeur. */
  at: [number, number];
}

export const MIN_POINTS = 4;
export const MAX_POINTS = 40;

/**
 * Vérifie qu'un circuit est jouable : pas de portions qui se touchent (sauf au pont),
 * virages assez larges pour le mur intérieur, tout dans l'image.
 */
export function validateTrack(def: TrackDef, built?: Track): TrackProblem[] {
  const problems: TrackProblem[] = [];
  if (def.points.length < MIN_POINTS) return [{ message: `Il faut au moins ${MIN_POINTS} points.`, at: def.points[0] ?? [0, 0] }];
  if (def.points.length > MAX_POINTS) return [{ message: `${MAX_POINTS} points au maximum.`, at: def.points[0] }];
  const t = built ?? buildTrack(def);
  if (t.length < 2500) problems.push({ message: 'Circuit trop court.', at: [t.xs[0], t.ys[0]] });
  if (t.length > 20000) problems.push({ message: 'Circuit trop long.', at: [t.xs[0], t.ys[0]] });

  const margin = WALL_DIST + 20;
  for (let i = 0; i < t.n; i++) {
    if (t.xs[i] < margin || t.ys[i] < margin || t.xs[i] > def.width - margin || t.ys[i] > def.height - margin) {
      problems.push({ message: 'La piste sort du terrain.', at: [t.xs[i], t.ys[i]] });
      break;
    }
  }

  const nearBridge = (i: number) =>
    !!def.bridge && Math.hypot(t.xs[i] - def.bridge[0], t.ys[i] - def.bridge[1]) < BRIDGE_RADIUS + 120;
  const minArc = Math.ceil((WALL_DIST * 4) / 8);
  const minGap = 2 * WALL_DIST + 20;
  let overlap: TrackProblem | null = null;
  for (let i = 0; i < t.n && !overlap; i += 2) {
    for (let j = i + minArc; j < t.n; j += 2) {
      if (t.n - (j - i) < minArc) break;
      if (nearBridge(i) && nearBridge(j)) continue;
      if (Math.hypot(t.xs[i] - t.xs[j], t.ys[i] - t.ys[j]) < minGap) {
        overlap = { message: 'Deux portions de piste sont trop proches.', at: [t.xs[i], t.ys[i]] };
        break;
      }
    }
  }
  if (overlap) problems.push(overlap);

  for (let i = 0; i < t.n; i++) {
    const k = wrapIdx(t, i + 4);
    const da = Math.abs(wrapAngle(Math.atan2(t.tys[k], t.txs[k]) - Math.atan2(t.tys[i], t.txs[i])));
    if (da > 1e-4 && 32 / da < WALL_DIST * 1.05) {
      problems.push({ message: 'Virage trop serré.', at: [t.xs[i], t.ys[i]] });
      break;
    }
  }
  return problems;
}
