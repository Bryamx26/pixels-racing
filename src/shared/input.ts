import { clamp } from './math';

/** Commandes d'une voiture pour un tick. Analogiques pour la manette, 0/1 au clavier et au tactile. */
export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (frein, puis marche arrière à l'arrêt)
  steer: number; // -1 (gauche) .. 1 (droite)
  /** Déclenche le turbo (si la jauge est assez remplie). */
  boost?: boolean;
  /** Utilise l'objet ramassé. */
  item?: boolean;
}

export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0 };

/** Format réseau compact : [seq, gaz, frein, direction, boutons] (valeurs ×100 ; boutons : 1 turbo, 2 objet). */
export type PackedInput = [seq: number, throttle: number, brake: number, steer: number, buttons: number];

export function packInput(seq: number, i: CarInput): PackedInput {
  return [
    seq,
    Math.round(i.throttle * 100),
    Math.round(i.brake * 100),
    Math.round(i.steer * 100),
    (i.boost ? 1 : 0) | (i.item ? 2 : 0),
  ];
}

/** Décode et valide une commande reçue (les valeurs hors bornes sont ramenées dans les bornes). */
export function unpackInput(p: unknown): { seq: number; input: CarInput } | null {
  if (!Array.isArray(p) || p.length < 4 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const buttons = p[4] ?? 0;
  return {
    seq: p[0],
    input: {
      throttle: clamp(p[1] / 100, 0, 1),
      brake: clamp(p[2] / 100, 0, 1),
      steer: clamp(p[3] / 100, -1, 1),
      boost: (buttons & 1) !== 0,
      item: (buttons & 2) !== 0,
    },
  };
}
