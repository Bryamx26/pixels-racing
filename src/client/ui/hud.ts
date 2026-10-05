import { COUNTDOWN_TICKS, TICK_RATE } from '../../shared/constants';
import { formatTime, raceTicks, standings, type RaceEvent, type RaceState } from '../../shared/race/race';
import type { Track } from '../../shared/track/track';
import { Minimap } from '../render/minimap';

/** Interface pendant la course : place, tour, chrono, vitesse, minicarte, feux de départ. */
export class Hud {
  private minimap: Minimap;
  private els: Record<'pos' | 'lap' | 'time' | 'speed' | 'center' | 'net', HTMLElement>;
  private flash: { text: string; until: number; small: boolean } | null = null;
  private wrongWay = 0;
  onMenu: () => void = () => {};

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-tl">
        <div class="hud-pos"></div>
        <div class="hud-lap"></div>
        <div class="hud-time"></div>
      </div>
      <canvas id="minimap"></canvas>
      <button class="hud-menu secondary" aria-label="Menu">II</button>
      <div class="hud-center"></div>
      <div class="hud-speed"></div>
      <div class="hud-net"></div>`;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    this.els = { pos: q('.hud-pos'), lap: q('.hud-lap'), time: q('.hud-time'), speed: q('.hud-speed'), center: q('.hud-center'), net: q('.hud-net') };
    this.minimap = new Minimap(q('#minimap') as HTMLCanvasElement);
    q('.hud-menu').addEventListener('click', () => this.onMenu());
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.flash = null;
  }

  message(text: string, ms = 1600, small = false): void {
    this.flash = { text, until: performance.now() + ms, small };
  }

  onEvents(events: RaceEvent[], state: RaceState, myId: string): void {
    for (const e of events) {
      if (e.type === 'go') this.message('GO !', 1000);
      if (e.type === 'lap' && e.id === myId) {
        this.message(e.lap === state.laps ? 'DERNIER TOUR !' : `TOUR ${e.lap}/${state.laps}`, 1600);
      }
      if (e.type === 'finish' && e.id === myId) this.message(`ARRIVÉE ! ${e.place}${e.place === 1 ? 'er' : 'e'}`, 3000);
    }
  }

  update(track: Track, state: RaceState, myId: string, dt: number, net?: { rtt: number }): void {
    const me = state.racers.find((r) => r.id === myId);
    const order = standings(state);
    const place = order.findIndex((r) => r.id === myId) + 1;
    this.els.pos.innerHTML = `${place}<small>${place === 1 ? 'er' : 'e'}/${state.racers.length}</small>`;
    if (me) {
      const lap = Math.min(state.laps, me.lapsDone + 1);
      this.els.lap.textContent = `TOUR ${lap}/${state.laps}`;
      const t = me.finishTick >= 0 ? me.finishTick - COUNTDOWN_TICKS : raceTicks(state);
      const best = me.bestLap ? formatTime(me.bestLap) : '--';
      this.els.time.innerHTML = `${formatTime(t)}<br><span class="best">MT ${best}</span>`;
      const kmh = Math.round(Math.hypot(me.vx, me.vy) * 0.5);
      this.els.speed.innerHTML = `${kmh} <small>KM/H</small>`;
      // Mauvais sens : la vitesse va contre le sens de la piste.
      const dot = me.vx * track.txs[me.idx] + me.vy * track.tys[me.idx];
      this.wrongWay = dot < -40 && state.phase === 'race' ? this.wrongWay + dt : 0;
    }
    this.minimap.draw(track, state, myId);

    const c = this.els.center;
    const now = performance.now();
    if (state.phase === 'countdown') {
      const left = COUNTDOWN_TICKS - state.tick;
      const lit = 3 - Math.ceil(left / TICK_RATE) + 1;
      c.className = 'hud-center';
      c.innerHTML = `<div class="lights">${[0, 1, 2].map((i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</div>${Math.ceil(left / TICK_RATE)}`;
    } else if (this.flash && now < this.flash.until) {
      c.className = 'hud-center' + (this.flash.small ? ' small' : '');
      c.innerHTML =
        (this.flash.text === 'GO !' ? '<div class="lights go"><i></i><i></i><i></i></div>' : '') + this.flash.text;
    } else if (this.wrongWay > 0.8) {
      c.className = 'hud-center';
      c.textContent = 'MAUVAIS SENS !';
    } else {
      c.textContent = '';
    }
    if (net) {
      this.els.net.textContent = `${Math.round(net.rtt)} ms`;
      this.els.net.classList.toggle('bad', net.rtt > 150);
    } else this.els.net.textContent = '';
  }
}
