import { getTrackDef, type TrackDef } from './tracks';

/** Espacement des échantillons de l'axe de la piste (unités monde). */
export const SAMPLE_SPACING = 8;

/** Circuit prêt pour la simulation : axe échantillonné à pas régulier. */
export interface Track {
  def: TrackDef;
  /** Nombre d'échantillons (un tour). */
  n: number;
  length: number;
  xs: Float64Array;
  ys: Float64Array;
  /** Tangente unitaire (sens de la course). La normale « droite » vaut (-ty, tx). */
  txs: Float64Array;
  tys: Float64Array;
  /** Échantillons du passage en hauteur (pont), inclusifs ; null sans pont. */
  bridge: [number, number] | null;
  /** Échantillons du passage du dessous. */
  under: [number, number] | null;
}

/** Rayon autour du croisement couvert par le pont. */
export const BRIDGE_RADIUS = 230;

/** Spline de Catmull-Rom centripète (passe par les points, sans boucles parasites). */
function catmullRom(pts: [number, number][], perSeg: number): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  const tj = (ti: number, a: [number, number], b: [number, number]) =>
    ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let s = 0; s < perSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / perSeg;
      const mix = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
        const u = (tb - t) / (tb - ta), v = (t - ta) / (tb - ta);
        return [a[0] * u + b[0] * v, a[1] * u + b[1] * v];
      };
      const a1 = mix(p0, p1, t0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
      const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
      out.push(mix(b1, b2, t1, t2));
    }
  }
  return out;
}

const cache = new Map<string, Track>();

/** Vrai si l'échantillon i est sur le pont. */
export const onBridge = (t: Track, i: number) => !!t.bridge && i >= t.bridge[0] && i <= t.bridge[1];

export function getTrack(id: string): Track {
  const def = getTrackDef(id);
  let t = cache.get(def.id);
  if (!t) cache.set(def.id, (t = buildTrack(def)));
  return t;
}

export function buildTrack(def: TrackDef): Track {
  const fine = catmullRom(def.points, 64);
  // Longueur cumulée de la polyligne fine, puis rééchantillonnage à pas constant.
  const cum = [0];
  for (let i = 1; i <= fine.length; i++) {
    const a = fine[i - 1], b = fine[i % fine.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[fine.length];
  const n = Math.round(total / SAMPLE_SPACING);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (i * total) / n;
    while (cum[j + 1] < d) j++;
    const a = fine[j], b = fine[(j + 1) % fine.length];
    const u = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    xs[i] = a[0] + (b[0] - a[0]) * u;
    ys[i] = a[1] + (b[1] - a[1]) * u;
  }
  const txs = new Float64Array(n), tys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = xs[(i + 1) % n] - xs[(i - 1 + n) % n];
    const dy = ys[(i + 1) % n] - ys[(i - 1 + n) % n];
    const l = Math.hypot(dx, dy) || 1;
    txs[i] = dx / l;
    tys[i] = dy / l;
  }
  // Pont : parmi les échantillons proches du croisement, le second passage est en hauteur.
  let bridge: [number, number] | null = null;
  let under: [number, number] | null = null;
  if (def.bridge) {
    const [bx, by] = def.bridge;
    const near: number[] = [];
    for (let i = 0; i < n; i++) if (Math.hypot(xs[i] - bx, ys[i] - by) < BRIDGE_RADIUS) near.push(i);
    const runs: [number, number][] = [];
    for (const i of near) {
      const last = runs[runs.length - 1];
      if (last && i === last[1] + 1) last[1] = i;
      else runs.push([i, i]);
    }
    if (runs.length >= 2) {
      bridge = runs[runs.length - 1];
      under = runs[0];
    }
  }
  return { def, n, length: total, xs, ys, txs, tys, bridge, under };
}

export const wrapIdx = (t: Track, i: number) => ((i % t.n) + t.n) % t.n;

/**
 * Échantillon le plus proche de (x, y). Avec un indice de départ, ne cherche que dans une
 * fenêtre autour (rapide, et évite de « sauter » sur une portion voisine de la piste).
 */
export function nearestSample(t: Track, x: number, y: number, hint = -1, window = 40): number {
  let best = 0, bestD = Infinity;
  const from = hint < 0 ? 0 : hint - window;
  const to = hint < 0 ? t.n - 1 : hint + window;
  for (let k = from; k <= to; k++) {
    const i = hint < 0 ? k : wrapIdx(t, k);
    const dx = t.xs[i] - x, dy = t.ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Décalage latéral signé de (x, y) par rapport à l'axe à l'échantillon i (positif = à droite). */
export function lateralOffset(t: Track, i: number, x: number, y: number): number {
  return (x - t.xs[i]) * -t.tys[i] + (y - t.ys[i]) * t.txs[i];
}

/** Point de l'axe à l'échantillon i décalé latéralement. */
export function pointAt(t: Track, i: number, offset = 0): [number, number] {
  const k = wrapIdx(t, Math.round(i));
  return [t.xs[k] - t.tys[k] * offset, t.ys[k] + t.txs[k] * offset];
}
