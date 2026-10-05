import { DEFAULT_LAPS, MAX_LAPS, MIN_LAPS, RECONNECT_GRACE_MS } from '../../shared/constants';
import { TRACKS } from '../../shared/track/tracks';
import type { ClientMsg } from '../../shared/net/protocol';
import { Room } from './room';
import { SessionRegistry, type Session } from './session';

/** Alphabet sans caractères ambigus (0/O, 1/I…). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

const validTrack = (id: unknown) => (TRACKS.some((t) => t.id === id) ? (id as string) : undefined);
const validLaps = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(MIN_LAPS, Math.min(MAX_LAPS, Math.round(n))) : undefined;

/** Création / connexion aux salles privées par code, reconnexion, départs. */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly sessions = new SessionRegistry();

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  roomOf(s: Session): Room | undefined {
    return s.roomCode ? this.rooms.get(s.roomCode) : undefined;
  }

  handle(s: Session, msg: ClientMsg): void {
    const room = this.roomOf(s);
    const fail = (message: string) => s.send({ t: 'error', message });

    switch (msg.t) {
      case 'create': {
        if (room) room.remove(s.id);
        this.cleanup(room);
        const r = new Room(this.newCode(), validTrack(msg.trackId) ?? TRACKS[0].id, validLaps(msg.laps) ?? DEFAULT_LAPS, s);
        this.rooms.set(r.code, r);
        console.log(`[salle ${r.code}] créée par ${s.name}`);
        return;
      }
      case 'join': {
        const code = String(msg.code ?? '').trim().toUpperCase();
        const r = this.rooms.get(code);
        if (!r) return fail('Aucune salle avec ce code.');
        if (r === room) return;
        if (r.phase !== 'lobby') return fail('La course a déjà commencé dans cette salle.');
        if (r.isFull) return fail('La salle est pleine.');
        if (room) {
          room.remove(s.id);
          this.cleanup(room);
        }
        r.add(s);
        console.log(`[salle ${r.code}] ${s.name} a rejoint (${r.members.size} joueurs)`);
        return;
      }
      case 'leave':
        if (room) {
          room.remove(s.id);
          this.cleanup(room);
        }
        s.send({ t: 'room', room: null });
        return;
      case 'config': {
        if (!room) return;
        const err = room.configure(s.id, {
          trackId: validTrack(msg.trackId),
          laps: validLaps(msg.laps),
          bots: typeof msg.bots === 'number' && Number.isFinite(msg.bots) ? msg.bots : undefined,
        });
        if (err) fail(err);
        return;
      }
      case 'car':
        if (typeof msg.carId === 'number') room?.setCar(s.id, msg.carId);
        return;
      case 'start': {
        if (!room) return;
        const err = room.start(s.id);
        if (err) fail(err);
        else console.log(`[salle ${room.code}] course lancée`);
        return;
      }
      case 'input':
        if (Array.isArray(msg.inputs)) room?.onInputs(s.id, msg.inputs.slice(0, 30));
        return;
      case 'ping':
        s.send({ t: 'pong', c: msg.c });
        return;
    }
  }

  /** Connexion coupée : on garde la place du joueur pendant RECONNECT_GRACE_MS (pilote auto en course). */
  onDisconnect(s: Session): void {
    s.ws = null;
    const room = this.roomOf(s);
    if (!room) {
      this.sessions.delete(s);
      return;
    }
    room.setConnected();
    s.disconnectTimer = setTimeout(() => {
      console.log(`[salle ${room.code}] ${s.name} n'est pas revenu, retiré`);
      room.remove(s.id);
      this.cleanup(room);
      this.sessions.delete(s);
    }, RECONNECT_GRACE_MS);
  }

  onReconnect(s: Session): void {
    if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
    s.disconnectTimer = null;
    const room = this.roomOf(s);
    if (room) {
      room.setConnected();
      console.log(`[salle ${room.code}] ${s.name} s'est reconnecté`);
    }
    s.send({ t: 'room', room: room ? room.info() : null });
  }

  private cleanup(room: Room | undefined): void {
    if (room && room.empty) {
      this.rooms.delete(room.code);
      console.log(`[salle ${room.code}] fermée`);
    }
  }

  tick(): void {
    for (const r of this.rooms.values()) r.tick();
  }
}
