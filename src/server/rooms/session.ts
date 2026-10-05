import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ServerMsg } from '../../shared/net/protocol';

/**
 * Un joueur connecté (ou en attente de reconnexion). Le token, gardé par le
 * client, permet de reprendre sa place après une coupure réseau.
 */
export class Session {
  readonly id = 'p_' + randomBytes(4).toString('hex');
  readonly token = randomBytes(16).toString('hex');
  ws: WebSocket | null = null;
  roomCode: string | null = null;
  disconnectTimer: NodeJS.Timeout | null = null;

  constructor(public name: string) {}

  get connected(): boolean {
    return this.ws !== null;
  }

  send(msg: ServerMsg): void {
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(data: string): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.send(data);
  }
}

export class SessionRegistry {
  private byToken = new Map<string, Session>();

  create(name: string): Session {
    const s = new Session(name);
    this.byToken.set(s.token, s);
    return s;
  }

  resume(token: string | undefined): Session | undefined {
    return token ? this.byToken.get(token) : undefined;
  }

  delete(s: Session): void {
    this.byToken.delete(s.token);
  }
}
