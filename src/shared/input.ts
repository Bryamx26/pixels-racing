import { clamp } from './math';

/** Commandes d'une voiture pour un tick. Analogiques pour la manette, 0/1 au clavier et au tactile. */
export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (frein, puis marche arrière à l'arrêt)
  steer: number; // -1 (gauche) .. 1 (droite)
  handbrake: boolean; // frein à main : dérapage
}

export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/** Format réseau compact : [seq, gaz, frein, direction, frein à main] (valeurs ×100). */
export type PackedInput = [seq: number, throttle: number, brake: number, steer: number, handbrake: 0 | 1];

export function packInput(seq: number, i: CarInput): PackedInput {
  return [seq, Math.round(i.throttle * 100), Math.round(i.brake * 100), Math.round(i.steer * 100), i.handbrake ? 1 : 0];
}

/** Décode et valide une commande reçue (les valeurs hors bornes sont ramenées dans les bornes). */
export function unpackInput(p: unknown): { seq: number; input: CarInput } | null {
  if (!Array.isArray(p) || p.length < 5 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return {
    seq: p[0],
    input: {
      throttle: clamp(p[1] / 100, 0, 1),
      brake: clamp(p[2] / 100, 0, 1),
      steer: clamp(p[3] / 100, -1, 1),
      handbrake: p[4] === 1,
    },
  };
}
