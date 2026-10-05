import type { PackedInput } from '../input';
import type { RaceEvent, RaceState } from '../race/race';

/** Messages client → serveur. */
export type ClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'create'; trackId: string; laps: number }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'config'; trackId?: string; laps?: number; bots?: number }
  | { t: 'car'; carId: number }
  | { t: 'start' }
  | { t: 'input'; inputs: PackedInput[] }
  | { t: 'ping'; c: number };

export interface LobbyPlayer {
  id: string;
  name: string;
  carId: number;
  connected: boolean;
  host: boolean;
}

export interface RoomInfo {
  code: string;
  trackId: string;
  laps: number;
  bots: number;
  phase: 'lobby' | 'race';
  players: LobbyPlayer[];
}

/** Messages serveur → client. */
export type ServerMsg =
  | { t: 'welcome'; playerId: string; token: string; resumed: boolean }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'error'; message: string }
  | { t: 'snap'; state: RaceState; ack: number; events: RaceEvent[] }
  | { t: 'pong'; c: number };
