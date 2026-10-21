import { SNAPSHOT_EVERY } from '../../shared/constants';
import { CARS } from '../../shared/cars/roster';
import { NO_INPUT, unpackInput, type CarInput } from '../../shared/input';
import { round2 } from '../../shared/math';
import type { ServerMsg } from '../../shared/net/protocol';
import { Roam, type RoamEvent, type RoamState } from '../../shared/world/roam';
import type { Session } from './session';

/** Nombre de joueurs par monde ouvert ; au-delà, un autre monde est ouvert. */
export const ROAM_MAX = 16;
const MAX_INPUT_QUEUE = 6;

interface Member {
  session: Session;
  queue: { seq: number; input: CarInput }[];
  input: CarInput;
  ack: number;
}

/** Un monde ouvert partagé : on y entre et on en sort quand on veut, sans salon ni départ. */
export class RoamRoom {
  readonly roam = new Roam();
  members = new Map<string, Member>();
  private events: RoamEvent[] = [];

  constructor(readonly id: string) {}

  get isFull(): boolean {
    return this.members.size >= ROAM_MAX;
  }

  get empty(): boolean {
    return this.members.size === 0;
  }

  add(s: Session, carId: number, spawn?: string): void {
    const car = CARS[carId] ? carId : 0;
    this.members.set(s.id, { session: s, queue: [], input: NO_INPUT, ack: 0 });
    this.roam.remove(s.id);
    this.roam.add(s.id, s.name, car, typeof spawn === 'string' ? spawn : 'festival');
    s.roamId = this.id;
    this.broadcast({ t: 'info', message: `${s.name} arrive dans le monde ouvert` }, s.id);
    this.snapshot();
  }

  remove(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.roam.remove(id);
    m.session.roamId = null;
  }

  setCar(id: string, carId: number): void {
    const c = this.roam.get(id);
    if (c && CARS[carId]) c.carId = carId;
  }

  warp(id: string, x: number, y: number, a: number): void {
    if (typeof x === 'number' && typeof y === 'number' && typeof a === 'number') this.roam.warp(id, x, y, a);
  }

  brag(id: string, text: string): void {
    const m = this.members.get(id);
    if (!m) return;
    const clean = String(text ?? '').replace(/[<>]/g, '').slice(0, 90);
    if (clean) this.broadcast({ t: 'info', message: `${m.session.name} : ${clean}` }, id);
  }

  onInputs(id: string, inputs: unknown[]): void {
    const m = this.members.get(id);
    if (!m) return;
    for (const raw of inputs) {
      const p = unpackInput(raw);
      if (!p || p.seq <= m.ack || (m.queue.length && p.seq <= m.queue[m.queue.length - 1].seq)) continue;
      m.queue.push(p);
    }
  }

  tick(): void {
    const inputs = new Map<string, CarInput>();
    for (const m of this.members.values()) {
      const q = m.queue;
      while (q.length > MAX_INPUT_QUEUE) m.ack = q.shift()!.seq;
      const next = q.shift();
      if (next) {
        m.ack = next.seq;
        m.input = next.input;
      }
      // Joueur déconnecté : sa voiture s'arrête en attendant son retour.
      inputs.set(m.session.id, m.session.connected ? m.input : NO_INPUT);
    }
    this.events.push(...this.roam.step(inputs));
    if (this.roam.state.tick % SNAPSHOT_EVERY === 0) this.snapshot();
  }

  private snapshot(): void {
    const body = `"events":${JSON.stringify(this.events)},"state":${JSON.stringify(compact(this.roam.state))}}`;
    this.events = [];
    for (const m of this.members.values()) m.session.sendRaw(`{"t":"rsnap","ack":${m.ack},${body}`);
  }

  private broadcast(msg: ServerMsg, except?: string): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) if (m.session.id !== except) m.session.sendRaw(data);
  }
}

function compact(s: RoamState): RoamState {
  return {
    tick: s.tick,
    cars: s.cars.map((c) => ({
      ...c,
      x: round2(c.x),
      y: round2(c.y),
      vx: round2(c.vx),
      vy: round2(c.vy),
      a: Math.round(c.a * 1e4) / 1e4,
      w: Math.round(c.w * 1e4) / 1e4,
      boost: round2(c.boost),
      draft: round2(c.draft),
    })),
  };
}
