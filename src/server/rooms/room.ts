import { MAX_PLAYERS, SNAPSHOT_EVERY } from '../../shared/constants';
import { NO_INPUT, unpackInput, type CarInput } from '../../shared/input';
import { round2 } from '../../shared/math';
import { CARS } from '../../shared/cars/carAtlas';
import { Race, type Entrant, type RaceEvent, type RaceState } from '../../shared/race/race';
import type { LobbyPlayer, RoomInfo, ServerMsg } from '../../shared/net/protocol';
import type { Session } from './session';

/** File d'entrées au-delà de laquelle on rattrape le retard du client. */
const MAX_INPUT_QUEUE = 6;
/** Délai après l'arrivée (écran des résultats) avant le retour au salon. */
const END_DELAY_TICKS = 60 * 8;

const BOT_NAMES = ['Turbo', 'Nitro', 'Drift', 'Pistons', 'Chrome', 'Bolide', 'Rallye', 'Vroum'];

interface Member {
  session: Session;
  order: number;
  carId: number;
  queue: { seq: number; input: CarInput }[];
  input: CarInput;
  ack: number;
}

/**
 * Une salle privée : salon (circuit, tours, bots, choix de voiture) puis course.
 * Le serveur est autoritaire : il fait tourner la Race et diffuse des instantanés.
 */
export class Room {
  members = new Map<string, Member>();
  hostId: string;
  race: Race | null = null;
  bots = 0;
  private events: RaceEvent[] = [];
  private endedAt = -1;
  private joinCounter = 0;

  constructor(
    public readonly code: string,
    public trackId: string,
    public laps: number,
    host: Session,
  ) {
    this.hostId = host.id;
    this.add(host);
  }

  get phase(): RoomInfo['phase'] {
    return this.race ? 'race' : 'lobby';
  }

  get isFull(): boolean {
    return this.members.size >= MAX_PLAYERS;
  }

  get empty(): boolean {
    return this.members.size === 0;
  }

  add(s: Session): void {
    const used = new Set([...this.members.values()].map((m) => m.carId));
    const carId = CARS.findIndex((c) => !used.has(c.id));
    this.members.set(s.id, { session: s, order: this.joinCounter++, carId, queue: [], input: NO_INPUT, ack: 0 });
    this.bots = Math.min(this.bots, MAX_PLAYERS - this.members.size);
    s.roomCode = this.code;
    this.broadcastInfo();
  }

  /** Départ définitif (volontaire ou délai de reconnexion dépassé). */
  remove(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    m.session.roomCode = null;
    // En pleine course, la voiture du joueur parti finit la course en pilote automatique.
    const r = this.race?.state.racers.find((x) => x.id === id);
    if (r) r.bot = true;
    if (this.hostId === id) {
      const next = [...this.members.values()].sort((a, b) => a.order - b.order)[0];
      if (next) this.hostId = next.session.id;
    }
    this.broadcastInfo();
  }

  setConnected(): void {
    this.broadcastInfo();
  }

  configure(by: string, cfg: { trackId?: string; laps?: number; bots?: number }): string | null {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.race) return 'Course en cours.';
    if (cfg.trackId) this.trackId = cfg.trackId;
    if (cfg.laps !== undefined) this.laps = cfg.laps;
    if (cfg.bots !== undefined) this.bots = Math.max(0, Math.min(MAX_PLAYERS - this.members.size, cfg.bots | 0));
    this.broadcastInfo();
    return null;
  }

  setCar(id: string, carId: number): void {
    const m = this.members.get(id);
    if (!m || this.race || !CARS[carId]) return;
    m.carId = carId;
    this.broadcastInfo();
  }

  start(by: string): string | null {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la course.";
    if (this.race) return 'Course déjà en cours.';
    const humans = [...this.members.values()].sort((a, b) => a.order - b.order);
    const used = new Set(humans.map((m) => m.carId));
    const freeCars = CARS.map((c) => c.id).filter((id) => !used.has(id)).sort(() => Math.random() - 0.5);
    const entrants: Entrant[] = humans.map((m) => ({ id: m.session.id, name: m.session.name, carId: m.carId, bot: false }));
    for (let i = 0; i < this.bots; i++) {
      entrants.push({ id: `bot${i}`, name: BOT_NAMES[i % BOT_NAMES.length], carId: freeCars[i % freeCars.length] ?? i, bot: true });
    }
    // Grille mélangée : personne ne part toujours en pole.
    entrants.sort(() => Math.random() - 0.5);
    this.race = new Race(this.trackId, this.laps, entrants, Math.floor(Math.random() * 1e6));
    for (const m of this.members.values()) {
      m.queue = [];
      m.input = NO_INPUT;
      m.ack = 0;
    }
    this.events = [];
    this.endedAt = -1;
    this.broadcastInfo();
    this.broadcastSnapshot();
    return null;
  }

  onInputs(id: string, inputs: unknown[]): void {
    const m = this.members.get(id);
    if (!m || !this.race) return;
    for (const raw of inputs) {
      const p = unpackInput(raw);
      if (!p || p.seq <= m.ack || (m.queue.length && p.seq <= m.queue[m.queue.length - 1].seq)) continue;
      m.queue.push(p);
    }
  }

  tick(): void {
    const race = this.race;
    if (!race) return;
    const inputs = new Map<string, CarInput>();
    const autopilot = new Set<string>();
    for (const m of this.members.values()) {
      const q = m.queue;
      // Client en avance (gigue réseau) : on saute les plus anciennes entrées.
      while (q.length > MAX_INPUT_QUEUE) m.ack = q.shift()!.seq;
      const next = q.shift();
      if (next) {
        m.ack = next.seq;
        m.input = next.input;
      }
      inputs.set(m.session.id, m.input);
      if (!m.session.connected) autopilot.add(m.session.id);
    }
    this.events.push(...race.step(inputs, autopilot));

    if (race.state.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();

    if (race.state.phase === 'done') {
      if (this.endedAt < 0) {
        this.endedAt = race.state.tick;
        this.broadcastSnapshot();
      } else if (race.state.tick - this.endedAt > END_DELAY_TICKS) {
        this.race = null;
        this.broadcastInfo();
      } else race.state.tick++;
    }
  }

  private broadcastSnapshot(): void {
    if (!this.race) return;
    // Sérialisé une seule fois, seul l'ack diffère par joueur.
    const body = `"events":${JSON.stringify(this.events)},"state":${JSON.stringify(compactState(this.race.state))}}`;
    this.events = [];
    for (const m of this.members.values()) m.session.sendRaw(`{"t":"snap","ack":${m.ack},${body}`);
  }

  info(): RoomInfo {
    const players: LobbyPlayer[] = [...this.members.values()]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        id: m.session.id,
        name: m.session.name,
        carId: m.carId,
        connected: m.session.connected,
        host: m.session.id === this.hostId,
      }));
    return { code: this.code, trackId: this.trackId, laps: this.laps, bots: this.bots, phase: this.phase, players };
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) m.session.sendRaw(data);
  }

  broadcastInfo(): void {
    this.broadcast({ t: 'room', room: this.info() });
  }
}

/** Arrondit les flottants pour alléger l'instantané (≈ 1,5 Ko pour 8 voitures). */
function compactState(s: RaceState): RaceState {
  return {
    ...s,
    racers: s.racers.map((r) => ({
      ...r,
      x: round2(r.x),
      y: round2(r.y),
      vx: round2(r.vx),
      vy: round2(r.vy),
      a: Math.round(r.a * 1e4) / 1e4,
    })),
  };
}
