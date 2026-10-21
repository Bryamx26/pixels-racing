import type { CarBody } from '../cars/physics';
import { DriftScore, type DriftEvent } from '../race/driftScore';
import type { Challenge, Pt } from './world';

/** Conversion unités monde/s → km/h affichés (comme le compteur). */
export const KMH = 0.5;

export type ChallengeEvent =
  | { type: 'start'; ch: Challenge }
  | { type: 'checkpoint'; ch: Challenge; i: number; n: number }
  | { type: 'drift'; ev: DriftEvent }
  | { type: 'end'; ch: Challenge; value: number; stars: number }
  | { type: 'fail'; ch: Challenge; reason: string };

/** Étoiles obtenues (0 à 3). Pour un sprint, la valeur est un temps : plus bas = mieux. */
export function starsFor(ch: Challenge, value: number): number {
  const lower = ch.kind === 'sprint';
  let n = 0;
  for (const s of ch.stars) if (lower ? value <= s : value >= s) n++;
  return n;
}

/** Unité et mise en forme de la valeur d'un défi. */
export function formatValue(ch: Challenge, v: number): string {
  if (ch.kind === 'sprint') return `${v.toFixed(2).replace('.', ',')} s`;
  if (ch.kind === 'speedtrap' || ch.kind === 'speedzone') return `${Math.round(v)} km/h`;
  return Math.round(v).toLocaleString('fr-FR') + ' pts';
}

export const CHALLENGE_LABEL: Record<Challenge['kind'], string> = {
  drift: 'Zone de drift',
  driftArea: 'Arène de drift',
  speedtrap: 'Radar',
  speedzone: 'Zone de vitesse',
  sprint: 'Sprint',
};

interface Gate {
  x: number;
  y: number;
  dx: number;
  dy: number;
  half: number;
}

function gate(path: Pt[], end: boolean, half: number): Gate {
  const n = path.length;
  const [a, b] = end ? [path[n - 2], path[n - 1]] : [path[0], path[1]];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const p = end ? b : a;
  return { x: p[0], y: p[1], dx: (b[0] - a[0]) / l, dy: (b[1] - a[1]) / l, half };
}

/** Franchissement d'une ligne de départ ou d'arrivée entre deux positions (dans le sens du tracé, sauf `both`). */
function crossed(g: Gate, px: number, py: number, x: number, y: number, both = false): boolean {
  const a0 = (px - g.x) * g.dx + (py - g.y) * g.dy;
  const a1 = (x - g.x) * g.dx + (y - g.y) * g.dy;
  const lat = Math.abs(-(x - g.x) * g.dy + (y - g.y) * g.dx);
  if (lat > g.half) return false;
  return (a0 < 0 && a1 >= 0) || (both && a0 >= 0 && a1 < 0);
}

const inRect = (r: [number, number, number, number], x: number, y: number) => x > r[0] && x < r[2] && y > r[1] && y < r[3];

export const pathLen = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

interface Active {
  ch: Challenge;
  time: number;
  /** Indice du tracé le plus proche (zones) ou prochain point de passage (sprint). */
  idx: number;
  out: number;
  drift: DriftScore | null;
}

/**
 * Défis du monde ouvert pour un joueur : départs automatiques en franchissant une ligne
 * (ou en entrant dans l'arène), suivi du couloir, chrono et score, puis résultat en étoiles.
 */
export class ChallengeTracker {
  active: Active | null = null;
  private prev: { x: number; y: number } | null = null;
  /** Après un défi, on ne relance pas le même tout de suite (on est encore sur sa ligne). */
  private cooldown = new Map<string, number>();

  constructor(private list: Challenge[]) {}

  get drift(): DriftScore | null {
    return this.active?.drift ?? null;
  }

  /** Abandon (voyage rapide, remise sur la route). */
  cancel(): ChallengeEvent | null {
    const a = this.active;
    this.active = null;
    this.prev = null;
    return a ? { type: 'fail', ch: a.ch, reason: 'Défi abandonné' } : null;
  }

  /** Temps restant (arène) ou écoulé, en secondes. */
  clock(): number {
    const a = this.active;
    if (!a) return 0;
    return a.ch.kind === 'driftArea' ? Math.max(0, (a.ch.seconds ?? 60) - a.time) : a.time;
  }

  step(b: CarBody, wallPower: number, dt: number): ChallengeEvent[] {
    const ev: ChallengeEvent[] = [];
    const prev = this.prev;
    this.prev = { x: b.x, y: b.y };
    for (const [id, t] of this.cooldown) if (t - dt <= 0) this.cooldown.delete(id);
    else this.cooldown.set(id, t - dt);
    if (!prev || Math.hypot(b.x - prev.x, b.y - prev.y) > 120) {
      // Téléportation : le défi en cours est abandonné.
      if (this.active) ev.push({ type: 'fail', ch: this.active.ch, reason: 'Défi abandonné' });
      this.active = null;
      return ev;
    }
    const speed = Math.hypot(b.vx, b.vy);

    if (!this.active) {
      for (const ch of this.list) {
        if (this.cooldown.has(ch.id)) continue;
        const go =
          ch.kind === 'driftArea'
            ? !inRect(ch.rect!, prev.x, prev.y) && inRect(ch.rect!, b.x, b.y)
            : crossed(gate(ch.path, false, ch.half), prev.x, prev.y, b.x, b.y, ch.kind === 'speedtrap');
        if (!go) continue;
        if (ch.kind === 'speedtrap') {
          const v = speed * KMH;
          ev.push({ type: 'end', ch, value: v, stars: starsFor(ch, v) });
          this.cooldown.set(ch.id, 2);
          break;
        }
        this.active = { ch, time: 0, idx: ch.kind === 'sprint' ? 1 : 0, out: 0, drift: ch.kind === 'drift' || ch.kind === 'driftArea' ? new DriftScore() : null };
        ev.push({ type: 'start', ch });
        break;
      }
      return ev;
    }

    const a = this.active;
    const ch = a.ch;
    a.time += dt;
    if (a.drift) {
      const d = a.drift.step(b, wallPower, dt);
      if (d) ev.push({ type: 'drift', ev: d });
    }
    const finish = (value: number) => {
      ev.push({ type: 'end', ch, value, stars: starsFor(ch, value) });
      this.active = null;
      this.cooldown.set(ch.id, 4);
    };
    const fail = (reason: string) => {
      ev.push({ type: 'fail', ch, reason });
      this.active = null;
      this.cooldown.set(ch.id, 4);
    };

    if (ch.kind === 'driftArea') {
      if (a.time >= (ch.seconds ?? 60) || !inRect(ch.rect!, b.x, b.y)) {
        const e = a.drift!.bank();
        if (e) ev.push({ type: 'drift', ev: e });
        finish(a.drift!.total);
      }
      return ev;
    }
    if (ch.kind === 'sprint') {
      const [cx, cy] = ch.path[a.idx];
      if (Math.hypot(b.x - cx, b.y - cy) < ch.half + 40) {
        a.idx++;
        if (a.idx >= ch.path.length) finish(a.time);
        else ev.push({ type: 'checkpoint', ch, i: a.idx - 1, n: ch.path.length - 1 });
      } else if (a.time > ch.stars[0] * 2) fail('Trop lent');
      return ev;
    }
    // Zones (drift, vitesse) : il faut rester dans le couloir jusqu'à la ligne d'arrivée.
    const p = ch.path;
    let best = a.idx, bd = Infinity;
    for (let i = Math.max(0, a.idx - 20); i < Math.min(p.length, a.idx + 40); i++) {
      const d = (p[i][0] - b.x) ** 2 + (p[i][1] - b.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    a.idx = best;
    a.out = Math.sqrt(bd) > ch.half + 40 ? a.out + dt : 0;
    if (crossed(gate(p, true, ch.half), prev.x, prev.y, b.x, b.y)) {
      if (a.drift) {
        const e = a.drift.bank();
        if (e) ev.push({ type: 'drift', ev: e });
        finish(a.drift.total);
      } else finish((pathLen(p) / a.time) * KMH);
    } else if (a.out > 1.2) fail('Hors de la zone');
    else if (a.time > 120) fail('Trop lent');
    return ev;
  }
}
