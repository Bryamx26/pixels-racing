import type { Track } from '../../shared/track/track';

/**
 * Projection isométrique 2:1. Le monde de la simulation reste vu de dessus (x, y) ; on le
 * projette à l'écran : sx = (x − y)·ISO, sy = (x + y)·ISO/2 − z·ISO_Z.
 */
export const ISO = 0.75;
export const ISO_Z = 0.8;

export const isoX = (x: number, y: number) => (x - y) * ISO;
export const isoY = (x: number, y: number, z = 0) => (x + y) * (ISO / 2) - z * ISO_Z;

/** Matrice (pour setTransform) qui dessine le sol du monde en isométrique, décalée de (ox, oy). */
export function groundMatrix(ox: number, oy: number): [number, number, number, number, number, number] {
  return [ISO, ISO / 2, -ISO, ISO / 2, ox, oy];
}

/** Hauteur du tablier du pont. */
export const BRIDGE_H = 40;
/** Longueur des rampes, en échantillons de piste. */
export const RAMP = 46;

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Hauteur de la chaussée à l'échantillon `i` (0 partout sauf sur le pont et ses rampes). */
export function zAt(t: Track, i: number): number {
  if (!t.bridge) return 0;
  const [from, to] = t.bridge;
  const k = ((Math.round(i) % t.n) + t.n) % t.n;
  if (k >= from && k <= to) return BRIDGE_H;
  const before = (((from - k) % t.n) + t.n) % t.n;
  const after = (((k - to) % t.n) + t.n) % t.n;
  const d = Math.min(before, after);
  return d < RAMP ? BRIDGE_H * smooth(1 - d / RAMP) : 0;
}

/** Échantillons (de/à, à lire modulo n) de la portion surélevée, rampes comprises. */
export function elevatedRange(t: Track): [number, number] | null {
  return t.bridge ? [t.bridge[0] - RAMP, t.bridge[1] + RAMP] : null;
}
