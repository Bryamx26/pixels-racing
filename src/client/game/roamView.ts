import { DT } from '../../shared/constants';
import { packInput, type CarInput, type PackedInput } from '../../shared/input';
import { lerp, lerpAngle, wrapAngle } from '../../shared/math';
import { draftFactor, type CarBody } from '../../shared/cars/physics';
import type { ServerMsg } from '../../shared/net/protocol';
import { Roam, stepRoamCar, type RoamCar, type RoamEvent, type RoamState } from '../../shared/world/roam';
import { getWorld } from '../../shared/world/world';
import type { Controls } from '../input/controls';
import type { Connection } from '../net/connection';
import { FixedClock, quantize } from './raceView';

/** Monde ouvert vu par le client, en solo ou en ligne. */
export interface RoamView {
  readonly myId: string;
  readonly online: boolean;
  paused: boolean;
  update(now: number): void;
  /** Voitures à dessiner (positions lissées). */
  frame(now: number): RoamCar[];
  /** Notre voiture, telle que simulée (pour les défis). */
  me(): RoamCar | undefined;
  drainEvents(): RoamEvent[];
  warp(x: number, y: number, a: number): void;
  setCar(carId: number): void;
  /** Appelé à chaque pas de simulation de notre voiture (défis, panneaux). */
  onTick: ((me: RoamCar, events: RoamEvent[]) => void) | null;
  dispose(): void;
}

type Pose = { x: number; y: number; a: number };

/** Balade en solo : le monde tourne dans le navigateur. */
export class LocalRoam implements RoamView {
  readonly online = false;
  readonly myId = 'me';
  paused = false;
  private roam = new Roam();
  private clock = new FixedClock();
  private prev = new Map<string, Pose>();
  private events: RoamEvent[] = [];
  /** Appelé à chaque pas de simulation (défis). */
  onTick: ((me: RoamCar, events: RoamEvent[]) => void) | null = null;

  constructor(name: string, carId: number, private controls: Controls, spawn = 'festival') {
    this.roam.add(this.myId, name, carId, spawn);
  }

  update(now: number): void {
    if (this.paused) {
      this.clock.reset();
      return;
    }
    const n = this.clock.ticks(now);
    for (let i = 0; i < n; i++) {
      for (const c of this.roam.state.cars) this.prev.set(c.id, { x: c.x, y: c.y, a: c.a });
      const ev = this.roam.step(new Map([[this.myId, quantize(this.controls.read(DT))]]));
      this.events.push(...ev);
      const me = this.me();
      if (me) this.onTick?.(me, ev);
    }
  }

  frame(): RoamCar[] {
    const al = this.paused ? 1 : this.clock.alpha;
    return this.roam.state.cars.map((c) => {
      const p = this.prev.get(c.id);
      return p ? { ...c, x: lerp(p.x, c.x, al), y: lerp(p.y, c.y, al), a: lerpAngle(p.a, c.a, al) } : c;
    });
  }

  me(): RoamCar | undefined {
    return this.roam.get(this.myId);
  }

  drainEvents(): RoamEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  warp(x: number, y: number, a: number): void {
    if (this.roam.warp(this.myId, x, y, a)) this.prev.delete(this.myId);
  }

  setCar(carId: number): void {
    const me = this.me();
    if (me) me.carId = carId;
  }

  dispose(): void {}
}

const INTERP_DELAY = 100;

/**
 * Monde ouvert en ligne : le serveur fait foi, notre voiture est prédite (commandes rejouées
 * depuis le dernier instantané), les autres sont interpolées.
 */
export class OnlineRoam implements RoamView {
  readonly online = true;
  paused = false;
  private world = getWorld();
  private snaps: { at: number; state: RoamState }[] = [];
  private events: RoamEvent[] = [];
  private clock = new FixedClock();
  private seq = 0;
  private history: { seq: number; input: CarInput }[] = [];
  private outbox: PackedInput[] = [];
  private body: RoamCar | null = null;
  private prevBody: CarBody | null = null;
  private fix = { x: 0, y: 0, a: 0 };
  private off: () => void;
  private pendingWarp: { x: number; y: number; until: number } | null = null;
  onTick: ((me: RoamCar, events: RoamEvent[]) => void) | null = null;

  constructor(
    private conn: Connection,
    private controls: Controls,
    readonly myId: string,
    first: RoamState,
  ) {
    this.onSnap(first, 0, []);
    this.off = conn.on((msg: ServerMsg) => {
      if (msg.t === 'rsnap') this.onSnap(msg.state, msg.ack, msg.events);
    });
  }

  private get latest(): RoamState {
    return this.snaps[this.snaps.length - 1].state;
  }

  private onSnap(state: RoamState, ack: number, events: RoamEvent[]): void {
    const now = performance.now();
    this.snaps.push({ at: now, state });
    while (this.snaps.length > 2 && this.snaps[1].at < now - INTERP_DELAY - 200) this.snaps.shift();
    this.events.push(...events);
    const r = state.cars.find((c) => c.id === this.myId);
    if (!r) {
      this.body = null;
      return;
    }
    // Téléportation pas encore prise en compte par le serveur : on garde notre prédiction.
    const w = this.pendingWarp;
    if (w && now < w.until && Math.hypot(r.x - w.x, r.y - w.y) > 300) return;
    this.pendingWarp = null;
    this.history = this.history.filter((h) => h.seq > ack);
    const old = this.body;
    const body: RoamCar = { ...r };
    for (const h of this.history) this.simulate(body, h.input);
    if (old) {
      this.fix.x += old.x - body.x;
      this.fix.y += old.y - body.y;
      this.fix.a += wrapAngle(old.a - body.a);
      if (Math.hypot(this.fix.x, this.fix.y) > 80) {
        this.fix = { x: 0, y: 0, a: 0 };
        this.prevBody = null;
      } else if (this.prevBody) {
        this.prevBody.x += body.x - old.x;
        this.prevBody.y += body.y - old.y;
        this.prevBody.a += wrapAngle(body.a - old.a);
      }
    }
    this.body = body;
    this.prevBody ??= { ...body };
  }

  private simulate(b: RoamCar, input: CarInput): RoamEvent[] {
    const others = this.latest.cars.filter((c) => c.id !== this.myId);
    b.draft = draftFactor(b, others, 1);
    const res = stepRoamCar(this.world, b, input, b.carId, b.draft);
    b.drift = res.drift;
    b.offroad = res.offroad;
    return res.wall > 60 ? [{ type: 'wall', id: b.id, power: res.wall, x: b.x, y: b.y }] : [];
  }

  update(now: number): void {
    const n = this.clock.ticks(now);
    for (let i = 0; i < n; i++) {
      const input = quantize(this.controls.read(DT));
      const seq = ++this.seq;
      this.outbox.push(packInput(seq, input));
      if (this.body) {
        this.history.push({ seq, input });
        if (this.history.length > 240) this.history.shift();
        this.prevBody = { ...this.body };
        const ev = this.simulate(this.body, input);
        this.onTick?.(this.body, ev);
      }
    }
    if (this.outbox.length) {
      this.conn.send({ t: 'input', inputs: this.outbox });
      this.outbox = [];
    }
    const k = Math.exp(-n * DT * 8);
    this.fix.x *= k;
    this.fix.y *= k;
    this.fix.a *= k;
  }

  frame(now: number): RoamCar[] {
    const t = now - INTERP_DELAY;
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i].at <= t && this.snaps[i + 1].at >= t) {
        a = this.snaps[i];
        b = this.snaps[i + 1];
        break;
      }
    }
    const u = b.at > a.at ? Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at))) : 1;
    return this.latest.cars.map((c) => {
      if (c.id === this.myId && this.body && this.prevBody) {
        const al = this.clock.alpha;
        return {
          ...this.body,
          x: lerp(this.prevBody.x, this.body.x, al) + this.fix.x,
          y: lerp(this.prevBody.y, this.body.y, al) + this.fix.y,
          a: lerpAngle(this.prevBody.a, this.body.a, al) + this.fix.a,
        };
      }
      const ca = a.state.cars.find((x) => x.id === c.id), cb = b.state.cars.find((x) => x.id === c.id);
      if (!ca || !cb) return c;
      return { ...cb, x: lerp(ca.x, cb.x, u), y: lerp(ca.y, cb.y, u), a: lerpAngle(ca.a, cb.a, u) };
    });
  }

  me(): RoamCar | undefined {
    return this.body ?? undefined;
  }

  drainEvents(): RoamEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  warp(x: number, y: number, a: number): void {
    this.conn.send({ t: 'warp', x, y, a });
    this.pendingWarp = { x, y, until: performance.now() + 1500 };
    // Prédiction immédiate ; le serveur confirmera (ou refusera) au prochain instantané.
    if (this.body && this.world.isFree(x, y, 20)) {
      Object.assign(this.body, { x, y, a, vx: 0, vy: 0, w: 0 });
      this.prevBody = { ...this.body };
      this.fix = { x: 0, y: 0, a: 0 };
    }
  }

  setCar(carId: number): void {
    this.conn.send({ t: 'car', carId });
    if (this.body) this.body.carId = carId;
  }

  dispose(): void {
    this.off();
  }
}
