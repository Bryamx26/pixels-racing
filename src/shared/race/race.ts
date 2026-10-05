import { CAR_LENGTH, COUNTDOWN_TICKS, DT, FINISH_GRACE_TICKS, ROAD_WIDTH, TICK_RATE, WALL_DIST } from '../constants';
import { NO_INPUT, type CarInput } from '../input';
import { mulberry32 } from '../math';
import { OFFROAD_DIST, collideCars, draftFactor, newBody, samePortion, stepCar, updateProgress, type CarBody } from '../cars/physics';
import { carStats } from '../cars/stats';
import { BRIDGE_RADIUS, getTrack, lateralOffset, pointAt, wrapIdx, type Track } from '../track/track';
import { BotDriver } from './bot';

export type ItemKind = 'nitro' | 'oil' | 'shield';
export const ITEM_NAMES: Record<ItemKind, string> = { nitro: 'Nitro', oil: 'Huile', shield: 'Bouclier' };

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
  /** Objet ramassé, prêt à être utilisé. */
  item: ItemKind | null;
  /** Ticks de bouclier restants. */
  shield: number;
  /** En réparation aux stands ce tick-ci. */
  repairing: boolean;
  /** Bouton objet tenu au tick précédent (on n'utilise l'objet qu'à l'appui). */
  itemHeld: boolean;
}

export interface Pickup {
  x: number;
  y: number;
  /** Tick de réapparition ; 0 = disponible. */
  respawn: number;
}

export interface OilSlick {
  x: number;
  y: number;
  owner: string;
  /** Tick à partir duquel la flaque piège aussi celui qui l'a posée. */
  armed: number;
  until: number;
}

export interface RaceOptions {
  /** Boîtes d'objets sur la piste. */
  items: boolean;
  /** Les chocs abîment les voitures (réparation aux stands). */
  damage: boolean;
}

export const DEFAULT_OPTIONS: RaceOptions = { items: true, damage: true };

export type RacePhase = 'countdown' | 'race' | 'done';

export interface RaceState {
  trackId: string;
  laps: number;
  tick: number;
  phase: RacePhase;
  firstFinishTick: number;
  options: RaceOptions;
  racers: Racer[];
  pickups: Pickup[];
  oils: OilSlick[];
}

export type RaceEvent =
  | { type: 'go' }
  | { type: 'lap'; id: string; lap: number; ticks: number }
  | { type: 'finish'; id: string; place: number; ticks: number; lapTicks: number }
  | { type: 'bump'; x: number; y: number; power: number }
  | { type: 'pickup'; id: string; item: ItemKind; x: number; y: number }
  | { type: 'item'; id: string; item: ItemKind }
  | { type: 'spin'; id: string; x: number; y: number }
  | { type: 'boost'; id: string }
  | { type: 'done' };

export interface Entrant {
  id: string;
  name: string;
  carId: number;
  bot: boolean;
}

/** Stands : bande sur le bas-côté droit, juste avant la ligne d'arrivée. */
export const PIT = { from: -44, to: -14, minLat: OFFROAD_DIST + 2, maxLat: WALL_DIST, maxSpeed: 90, repairPerSec: 0.6 };

export function inPit(t: Track, b: CarBody): boolean {
  const rel = b.idx - t.n;
  if (rel < PIT.from || rel > PIT.to) return false;
  const lat = lateralOffset(t, b.idx, b.x, b.y);
  return lat > PIT.minLat && lat < PIT.maxLat;
}

/** Position de départ : grille en quinconce, deux voitures de front, derrière la ligne. */
export function gridPose(track: Track, slot: number): CarBody {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? -1 : 1;
  const back = 4 + row * Math.ceil((CAR_LENGTH + 24) / 8) + (side > 0 ? 4 : 0);
  const idx = wrapIdx(track, -back);
  // Voies 1 et 4 (une voiture = une voie).
  const [x, y] = pointAt(track, idx, (side * ROAD_WIDTH * 3) / 8);
  return newBody(x, y, Math.atan2(track.tys[idx], track.txs[idx]), idx, -back);
}

/** Emplacements des boîtes d'objets : trois rangées de trois, loin du départ et du pont. */
export function pickupSpots(t: Track): Pickup[] {
  const spots: Pickup[] = [];
  for (const f of [0.24, 0.52, 0.78]) {
    let i = Math.round(t.n * f);
    if (t.def.bridge) {
      for (let k = 0; k < 80; k++) {
        if (Math.hypot(t.xs[i] - t.def.bridge[0], t.ys[i] - t.def.bridge[1]) > BRIDGE_RADIUS + 140) break;
        i = wrapIdx(t, i + 6);
      }
    }
    for (const lane of [-0.3, 0, 0.3]) {
      const [x, y] = pointAt(t, i, lane * ROAD_WIDTH);
      spots.push({ x, y, respawn: 0 });
    }
  }
  return spots;
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

const PICKUP_RADIUS = 24;
const PICKUP_RESPAWN = 6 * TICK_RATE;
const OIL_RADIUS = 20;
const OIL_TICKS = 18 * TICK_RATE;
const SPIN_TICKS = 55;
const SHIELD_TICKS = 6 * TICK_RATE;
const NITRO_TICKS = 130;

/**
 * Une course complète : feux, physique, collisions, objets, dégâts, tours, arrivée.
 * Utilisée telle quelle par le serveur (en ligne) et par le client (solo contre les bots).
 */
export class Race {
  readonly track: Track;
  readonly state: RaceState;
  private drivers = new Map<string, BotDriver>();
  private rand: () => number;

  constructor(trackId: string, laps: number, entrants: Entrant[], seed = 1, options: RaceOptions = DEFAULT_OPTIONS) {
    this.track = getTrack(trackId);
    this.rand = mulberry32(seed);
    this.state = {
      trackId: this.track.def.id,
      laps,
      tick: 0,
      phase: 'countdown',
      firstFinishTick: -1,
      options: { ...options },
      pickups: options.items ? pickupSpots(this.track) : [],
      oils: [],
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
        item: null,
        shield: 0,
        repairing: false,
        itemHeld: false,
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
    for (const r of s.racers) r.draft = draftFactor(r, s.racers, t.n);
    for (const r of s.racers) {
      const auto = r.bot || r.finishTick >= 0 || autopilot.has(r.id);
      const inp = auto ? this.botInput(r) : (inputs.get(r.id) ?? NO_INPUT);
      const res = stepCar(r, inp, t, DT, { draft: r.draft, stats: carStats(r.carId), damage: s.options.damage && r.shield <= 0 });
      updateProgress(r, t);
      r.offroad = res.offroad;
      r.drift = res.drift;
      if (res.boostStarted) events.push({ type: 'boost', id: r.id });
      if (r.shield > 0) r.shield--;

      // Objet : utilisé à l'appui du bouton.
      if (inp.item && !r.itemHeld && r.item) this.useItem(r, events);
      r.itemHeld = !!inp.item;

      // Stands : à l'arrêt (ou presque) sur la bande des stands, la voiture se répare.
      r.repairing = s.options.damage && r.damage > 0 && inPit(t, r) && Math.hypot(r.vx, r.vy) < PIT.maxSpeed;
      if (r.repairing) r.damage = Math.max(0, r.damage - PIT.repairPerSec * DT);

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
          events.push({ type: 'finish', id: r.id, place, ticks: s.tick - COUNTDOWN_TICKS, lapTicks });
        } else {
          events.push({ type: 'lap', id: r.id, lap: laps + 1, ticks: lapTicks });
        }
      }
    }
    for (let i = 0; i < s.racers.length; i++) {
      for (let j = i + 1; j < s.racers.length; j++) {
        const p = s.racers[i], q = s.racers[j];
        const mp = carStats(p.carId).mass, mq = carStats(q.carId).mass;
        const power = collideCars(p, q, t.n, mp, mq);
        if (power > 60) {
          events.push({ type: 'bump', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, power });
          if (s.options.damage) {
            // La voiture la plus légère encaisse davantage.
            if (p.shield <= 0) p.damage = Math.min(1, p.damage + (power / 3800) * (mq / mp));
            if (q.shield <= 0) q.damage = Math.min(1, q.damage + (power / 3800) * (mp / mq));
          }
        }
      }
    }
    this.updateItems(events);

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

  private botInput(r: Racer): CarInput {
    const driver = this.drivers.get(r.id)!;
    const inp = driver.drive(r, this.track);
    if (r.item) {
      const s = this.state;
      const behind = s.racers.some(
        (o) => o !== r && samePortion(r, o, this.track.n) && r.prog - o.prog > 2 && r.prog - o.prog < 30,
      );
      const use =
        r.item === 'shield' ? this.rand() < 0.01 : r.item === 'oil' ? behind && this.rand() < 0.08 : driver.straight;
      inp.item = use && !r.itemHeld;
    }
    return inp;
  }

  private useItem(r: Racer, events: RaceEvent[]): void {
    const item = r.item!;
    r.item = null;
    if (item === 'nitro') {
      r.boostTicks = Math.max(r.boostTicks, NITRO_TICKS);
    } else if (item === 'shield') {
      r.shield = SHIELD_TICKS;
      r.spin = 0;
    } else {
      const back = CAR_LENGTH * 0.9;
      this.state.oils.push({
        x: r.x - Math.cos(r.a) * back,
        y: r.y - Math.sin(r.a) * back,
        owner: r.id,
        armed: this.state.tick + TICK_RATE,
        until: this.state.tick + OIL_TICKS,
      });
    }
    events.push({ type: 'item', id: r.id, item });
  }

  /** Boîtes d'objets (ramassage, réapparition) et flaques d'huile (tête-à-queue). */
  private updateItems(events: RaceEvent[]): void {
    const s = this.state;
    for (const p of s.pickups) {
      if (p.respawn && s.tick >= p.respawn) p.respawn = 0;
      if (p.respawn) continue;
      for (const r of s.racers) {
        if (r.item || r.finishTick >= 0) continue;
        if (Math.hypot(r.x - p.x, r.y - p.y) > PICKUP_RADIUS + 6) continue;
        // Les derniers ont plus de chances d'avoir du nitro.
        const behind = standings(s).indexOf(r) / Math.max(1, s.racers.length - 1);
        const roll = this.rand();
        r.item = roll < 0.3 + behind * 0.3 ? 'nitro' : roll < 0.7 + behind * 0.1 ? 'oil' : 'shield';
        p.respawn = s.tick + PICKUP_RESPAWN;
        events.push({ type: 'pickup', id: r.id, item: r.item, x: p.x, y: p.y });
        break;
      }
    }
    s.oils = s.oils.filter((o) => o.until > s.tick);
    for (const o of s.oils) {
      for (const r of s.racers) {
        if (r.spin > 0 || (r.id === o.owner && s.tick < o.armed)) continue;
        if (Math.hypot(r.x - o.x, r.y - o.y) > OIL_RADIUS) continue;
        o.until = s.tick; // la flaque est dispersée
        if (r.shield > 0) continue;
        r.spin = SPIN_TICKS;
        r.w = (this.rand() < 0.5 ? -1 : 1) * 6;
        r.boostTicks = 0;
        events.push({ type: 'spin', id: r.id, x: r.x, y: r.y });
      }
    }
  }
}
