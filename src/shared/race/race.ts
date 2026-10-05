import { CAR_LENGTH, COUNTDOWN_TICKS, DT, FINISH_GRACE_TICKS, ROAD_WIDTH, TICK_RATE } from '../constants';
import { NO_INPUT, type CarInput } from '../input';
import { collideCars, draftFactor, stepCar, updateProgress, type CarBody } from '../cars/physics';
import { getTrack, pointAt, wrapIdx, type Track } from '../track/track';
import { BotDriver } from './bot';

export interface Racer extends CarBody {
  id: string;
  name: string;
  carId: number;
  bot: boolean;
  /** Tours bouclés (ne redescend jamais). */
  lapsDone: number;
  lapStartTick: number;
  bestLap: number; // en ticks, 0 = aucun
  /** Tick d'arrivée, -1 tant que la course n'est pas finie pour ce pilote. */
  finishTick: number;
  /** Pour les effets : dans l'herbe / en dérapage ce tick-ci. */
  offroad: boolean;
  drift: boolean;
  /** Aspiration reçue (0..1). */
  draft: number;
}

export type RacePhase = 'countdown' | 'race' | 'done';

export interface RaceState {
  trackId: string;
  laps: number;
  tick: number;
  phase: RacePhase;
  firstFinishTick: number;
  racers: Racer[];
}

export type RaceEvent =
  | { type: 'go' }
  | { type: 'lap'; id: string; lap: number; ticks: number }
  | { type: 'finish'; id: string; place: number; ticks: number }
  | { type: 'bump'; x: number; y: number; power: number }
  | { type: 'done' };

export interface Entrant {
  id: string;
  name: string;
  carId: number;
  bot: boolean;
}

/** Position de départ : grille en quinconce, deux voitures de front, derrière la ligne. */
export function gridPose(track: Track, slot: number): CarBody {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? -1 : 1;
  const back = 4 + row * Math.ceil((CAR_LENGTH + 24) / 8) + (side > 0 ? 4 : 0);
  const idx = wrapIdx(track, -back);
  // Voies 1 et 4 (une voiture = une voie).
  const [x, y] = pointAt(track, idx, (side * ROAD_WIDTH * 3) / 8);
  return { x, y, a: Math.atan2(track.tys[idx], track.txs[idx]), vx: 0, vy: 0, w: 0, idx, prog: -back };
}

/** Classement : arrivés dans l'ordre d'arrivée, puis les autres selon leur progression. */
export function standings(state: RaceState): Racer[] {
  return [...state.racers].sort((p, q) => {
    if (p.finishTick >= 0 || q.finishTick >= 0) {
      if (p.finishTick < 0) return 1;
      if (q.finishTick < 0) return -1;
      return p.finishTick - q.finishTick;
    }
    return q.prog - p.prog;
  });
}

/** Chrono d'un pilote en ticks depuis le départ. */
export const raceTicks = (state: RaceState) => Math.max(0, state.tick - COUNTDOWN_TICKS);

export function formatTime(ticks: number): string {
  const ms = Math.round((ticks / TICK_RATE) * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
}

/**
 * Une course complète : feux, physique, collisions, tours, arrivée.
 * Utilisée telle quelle par le serveur (en ligne) et par le client (solo contre les bots).
 */
export class Race {
  readonly track: Track;
  readonly state: RaceState;
  private drivers = new Map<string, BotDriver>();

  constructor(trackId: string, laps: number, entrants: Entrant[], seed = 1) {
    this.track = getTrack(trackId);
    this.state = {
      trackId: this.track.def.id,
      laps,
      tick: 0,
      phase: 'countdown',
      firstFinishTick: -1,
      racers: entrants.map((e, slot) => ({
        ...gridPose(this.track, slot),
        id: e.id,
        name: e.name,
        carId: e.carId,
        bot: e.bot,
        lapsDone: 0,
        lapStartTick: COUNTDOWN_TICKS,
        bestLap: 0,
        finishTick: -1,
        offroad: false,
        drift: false,
        draft: 0,
      })),
    };
    entrants.forEach((e, i) => this.drivers.set(e.id, new BotDriver(seed * 97 + i * 13)));
  }

  /**
   * Un tick de simulation. `inputs` : commandes des humains ; `autopilot` : humains
   * déconnectés, conduits par le bot le temps de revenir.
   */
  step(inputs: ReadonlyMap<string, CarInput>, autopilot: ReadonlySet<string> = new Set()): RaceEvent[] {
    const s = this.state;
    const events: RaceEvent[] = [];
    if (s.phase === 'done') return events;
    s.tick++;
    if (s.phase === 'countdown') {
      if (s.tick >= COUNTDOWN_TICKS) {
        s.phase = 'race';
        events.push({ type: 'go' });
      }
      return events;
    }
    const t = this.track;
    // Aspiration calculée sur les positions de début de tick (même règle pour tout le monde).
    for (const r of s.racers) r.draft = draftFactor(r, s.racers);
    for (const r of s.racers) {
      const auto = r.bot || r.finishTick >= 0 || autopilot.has(r.id);
      const inp = auto ? this.drivers.get(r.id)!.drive(r, t) : (inputs.get(r.id) ?? NO_INPUT);
      const res = stepCar(r, inp, t, DT, r.draft);
      updateProgress(r, t);
      r.offroad = res.offroad;
      r.drift = res.drift;
      const laps = Math.floor(r.prog / t.n);
      if (laps > r.lapsDone && r.finishTick < 0) {
        r.lapsDone = laps;
        const lapTicks = s.tick - r.lapStartTick;
        r.lapStartTick = s.tick;
        if (!r.bestLap || lapTicks < r.bestLap) r.bestLap = lapTicks;
        if (laps >= s.laps) {
          r.finishTick = s.tick;
          if (s.firstFinishTick < 0) s.firstFinishTick = s.tick;
          const place = s.racers.filter((o) => o.finishTick >= 0).length;
          events.push({ type: 'finish', id: r.id, place, ticks: s.tick - COUNTDOWN_TICKS });
        } else {
          events.push({ type: 'lap', id: r.id, lap: laps + 1, ticks: lapTicks });
        }
      }
    }
    for (let i = 0; i < s.racers.length; i++) {
      for (let j = i + 1; j < s.racers.length; j++) {
        const p = s.racers[i], q = s.racers[j];
        const power = collideCars(p, q);
        if (power > 60) events.push({ type: 'bump', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, power });
      }
    }
    const humans = s.racers.filter((r) => !r.bot);
    const allDone = s.racers.every((r) => r.finishTick >= 0);
    const humansDone = humans.length > 0 && humans.every((r) => r.finishTick >= 0);
    const lastHuman = Math.max(...humans.map((r) => r.finishTick));
    if (
      allDone ||
      (humansDone && s.tick - lastHuman > 3 * 60) ||
      (s.firstFinishTick >= 0 && s.tick - s.firstFinishTick > FINISH_GRACE_TICKS)
    ) {
      s.phase = 'done';
      events.push({ type: 'done' });
    }
    return events;
  }
}
