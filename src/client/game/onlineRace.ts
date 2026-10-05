import { COUNTDOWN_TICKS, DT } from '../../shared/constants';
import { packInput, type CarInput, type PackedInput } from '../../shared/input';
import { lerp, lerpAngle, wrapAngle } from '../../shared/math';
import { draftFactor, stepCar, updateProgress, type CarBody } from '../../shared/cars/physics';
import { carStats } from '../../shared/cars/stats';
import type { RaceEvent, RaceState, Racer } from '../../shared/race/race';
import { getTrack, type Track } from '../../shared/track/track';
import type { ServerMsg } from '../../shared/net/protocol';
import type { Connection } from '../net/connection';
import type { Controls } from '../input/controls';
import { FixedClock, quantize, type RaceView } from './raceView';

/** Retard d'affichage des autres voitures : on interpole entre deux instantanés reçus. */
const INTERP_DELAY = 100;

interface Snap {
  at: number;
  state: RaceState;
}

/**
 * Course en ligne. Le serveur fait foi ; notre voiture est prédite localement
 * (commandes rejouées depuis le dernier instantané confirmé) pour répondre sans délai,
 * les autres sont interpolées entre les instantanés.
 */
export class OnlineRace implements RaceView {
  readonly online = true;
  paused = false;
  private snaps: Snap[] = [];
  private events: RaceEvent[] = [];
  private clock = new FixedClock();
  private seq = 0;
  private history: { seq: number; input: CarInput }[] = [];
  private outbox: PackedInput[] = [];
  /** Voiture prédite et tick serveur estimé correspondant. */
  private me: CarBody | null = null;
  private meTick = 0;
  private prevMe: CarBody | null = null;
  /** Écart visuel résiduel après une correction serveur, résorbé en douceur. */
  private fix = { x: 0, y: 0, a: 0 };
  private off: () => void;
  track: Track;

  constructor(
    private conn: Connection,
    private controls: Controls,
    readonly myId: string,
    first: RaceState,
  ) {
    this.track = getTrack(first.trackId);
    this.onSnap(first, 0, []);
    this.off = conn.on((msg: ServerMsg) => {
      if (msg.t === 'snap') this.onSnap(msg.state, msg.ack, msg.events);
    });
  }

  get state(): RaceState {
    return this.snaps[this.snaps.length - 1].state;
  }

  private predicting(r: Racer | undefined, phase: RaceState['phase']): boolean {
    return !!r && r.finishTick < 0 && phase !== 'done';
  }

  private onSnap(state: RaceState, ack: number, events: RaceEvent[]): void {
    const now = performance.now();
    this.snaps.push({ at: now, state });
    while (this.snaps.length > 2 && this.snaps[1].at < now - INTERP_DELAY - 200) this.snaps.shift();
    this.events.push(...events);
    if (state.trackId !== this.track.def.id) this.track = getTrack(state.trackId);

    const r = state.racers.find((x) => x.id === this.myId);
    if (!this.predicting(r, state.phase)) {
      this.me = null;
      return;
    }
    // Réconciliation : on repart de l'état serveur et on rejoue les commandes non confirmées.
    this.history = this.history.filter((h) => h.seq > ack);
    const old = this.me;
    const { x, y, a, vx, vy, w, boost, boostTicks, spin, damage, idx, prog } = r!;
    const body: CarBody = { x, y, a, vx, vy, w, boost, boostTicks, spin, damage, idx, prog };
    let tick = state.tick;
    for (const h of this.history) {
      tick++;
      if (tick > COUNTDOWN_TICKS) this.simulate(body, h.input);
    }
    if (old) {
      this.fix.x += old.x - body.x;
      this.fix.y += old.y - body.y;
      this.fix.a += wrapAngle(old.a - body.a);
      // Gros écart (choc imprévu, téléportation) : on ne lisse pas.
      if (Math.hypot(this.fix.x, this.fix.y) > 80) this.fix = { x: 0, y: 0, a: 0 };
      else if (this.prevMe) {
        this.prevMe.x += body.x - old.x;
        this.prevMe.y += body.y - old.y;
        this.prevMe.a += wrapAngle(body.a - old.a);
      }
    }
    this.me = body;
    this.prevMe = this.prevMe ?? { ...body };
    this.meTick = tick;
  }

  /** Aspiration prédite (les autres voitures sont prises à leur dernière position connue). */
  private draft = 0;

  private simulate(b: CarBody, input: CarInput): void {
    const st = this.state;
    const me = st.racers.find((o) => o.id === this.myId);
    const others = st.racers.filter((o) => o !== me);
    this.draft = draftFactor(b, others, this.track.n);
    stepCar(b, input, this.track, DT, {
      draft: this.draft,
      stats: carStats(me?.carId ?? 0),
      damage: st.options.damage && (me?.shield ?? 0) <= 0,
    });
    updateProgress(b, this.track);
  }

  update(now: number): void {
    const n = this.clock.ticks(now);
    for (let i = 0; i < n; i++) {
      const input = quantize(this.controls.read(DT));
      const seq = ++this.seq;
      this.outbox.push(packInput(seq, input));
      if (this.me) {
        this.history.push({ seq, input });
        if (this.history.length > 240) this.history.shift();
        this.prevMe = { ...this.me };
        this.meTick++;
        if (this.meTick > COUNTDOWN_TICKS) this.simulate(this.me, input);
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

  frame(now: number): RaceState {
    const latest = this.state;
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
    const racers = latest.racers.map((r) => {
      if (r.id === this.myId && this.me && this.prevMe) {
        const al = this.clock.alpha;
        return {
          ...r,
          x: lerp(this.prevMe.x, this.me.x, al) + this.fix.x,
          y: lerp(this.prevMe.y, this.me.y, al) + this.fix.y,
          a: lerpAngle(this.prevMe.a, this.me.a, al) + this.fix.a,
          vx: this.me.vx,
          vy: this.me.vy,
          w: this.me.w,
          boost: this.me.boost,
          boostTicks: this.me.boostTicks,
          spin: this.me.spin,
          damage: this.me.damage,
          draft: this.draft,
          prog: this.me.prog,
        };
      }
      const ra = a.state.racers.find((x) => x.id === r.id);
      const rb = b.state.racers.find((x) => x.id === r.id);
      if (!ra || !rb) return r;
      return { ...rb, x: lerp(ra.x, rb.x, u), y: lerp(ra.y, rb.y, u), a: lerpAngle(ra.a, rb.a, u) };
    });
    return { ...latest, racers };
  }

  drainEvents(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  dispose(): void {
    this.off();
  }
}
