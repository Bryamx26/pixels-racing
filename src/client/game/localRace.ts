import { DT } from '../../shared/constants';
import { Race, type Entrant, type RaceEvent, type RaceState } from '../../shared/race/race';
import type { Controls } from '../input/controls';
import { FixedClock, lerpRacers, quantize, type Pose, type RaceView } from './raceView';

/** Course solo contre les bots, simulée entièrement dans le navigateur. */
export class LocalRace implements RaceView {
  readonly online = false;
  private race: Race;
  private clock = new FixedClock();
  private prev = new Map<string, Pose>();
  private events: RaceEvent[] = [];
  private _paused = false;

  constructor(
    trackId: string,
    laps: number,
    entrants: Entrant[],
    readonly myId: string,
    private controls: Controls,
  ) {
    this.race = new Race(trackId, laps, entrants, Math.floor(Math.random() * 1e6));
  }

  get track() {
    return this.race.track;
  }

  get state(): RaceState {
    return this.race.state;
  }

  get paused() {
    return this._paused;
  }

  set paused(p: boolean) {
    this._paused = p;
    this.clock.reset();
  }

  update(now: number): void {
    if (this._paused) return;
    const n = this.clock.ticks(now);
    for (let i = 0; i < n; i++) {
      this.prev.clear();
      for (const r of this.race.state.racers) this.prev.set(r.id, { x: r.x, y: r.y, a: r.a });
      const input = quantize(this.controls.read(DT));
      this.events.push(...this.race.step(new Map([[this.myId, input]])));
    }
  }

  frame(): RaceState {
    const s = this.race.state;
    return { ...s, racers: lerpRacers(this.prev, s.racers, this._paused ? 1 : this.clock.alpha) };
  }

  drainEvents(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  dispose(): void {}
}
