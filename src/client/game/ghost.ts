import type { RaceState } from '../../shared/race/race';

/** Meilleur tour enregistré : une pose (x, y, cap) tous les 2 ticks. */
interface GhostLap {
  ticks: number;
  carId: number;
  poses: number[];
}

const key = (trackId: string) => 'pr.ghost.' + trackId;

/**
 * Fantôme du contre-la-montre : enregistre le tour en cours, garde le meilleur
 * (localStorage) et le rejoue en même temps que le tour suivant.
 */
export class Ghost {
  best: GhostLap | null = null;
  private current: number[] = [];

  constructor(
    private trackId: string,
    private myId: string,
  ) {
    try {
      const raw = localStorage.getItem(key(trackId));
      if (raw) this.best = JSON.parse(raw);
    } catch {
      this.best = null;
    }
  }

  static bestTicks(trackId: string): number {
    try {
      const raw = localStorage.getItem(key(trackId));
      return raw ? (JSON.parse(raw) as GhostLap).ticks : 0;
    } catch {
      return 0;
    }
  }

  /** À appeler après chaque tick de simulation. */
  record(state: RaceState): void {
    const me = state.racers.find((r) => r.id === this.myId);
    if (!me || state.phase !== 'race' || me.finishTick >= 0) return;
    const k = state.tick - me.lapStartTick;
    if (k % 2) return;
    const i = (k / 2) * 3;
    this.current[i] = Math.round(me.x);
    this.current[i + 1] = Math.round(me.y);
    this.current[i + 2] = Math.round(me.a * 100) / 100;
  }

  /** Tour bouclé : renvoie true si c'est un nouveau meilleur tour (le fantôme est remplacé). */
  lapDone(ticks: number, carId: number): boolean {
    const lap = this.current;
    this.current = [];
    if (this.best && this.best.ticks <= ticks) return false;
    this.best = { ticks, carId, poses: lap };
    try {
      localStorage.setItem(key(this.trackId), JSON.stringify(this.best));
    } catch {
      /* stockage plein ou indisponible */
    }
    return true;
  }

  /** Pose du fantôme au même moment du tour en cours. */
  pose(state: RaceState): { x: number; y: number; a: number; carId: number } | null {
    const me = state.racers.find((r) => r.id === this.myId);
    if (!this.best || !me || state.phase !== 'race') return null;
    const k = Math.floor((state.tick - me.lapStartTick) / 2) * 3;
    const p = this.best.poses;
    if (k + 2 >= p.length || p[k] === undefined) return null;
    return { x: p[k], y: p[k + 1], a: p[k + 2], carId: this.best.carId };
  }

  /** Écart avec le fantôme : temps du fantôme au même endroit de la piste (approché). */
  get bestTicks(): number {
    return this.best?.ticks ?? 0;
  }
}
