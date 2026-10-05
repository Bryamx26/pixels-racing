import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { ClientMsg } from '../../shared/net/protocol';
import type { RoomManager } from '../rooms/roomManager';
import type { Session } from '../rooms/session';

const MAX_NAME = 12;

/** Point d'entrée WebSocket : authentification légère (token) puis routage des messages. */
export function attachSocketServer(server: Server, rooms: RoomManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    let session: Session | null = null;

    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!session) {
        if (msg.t !== 'hello') return;
        const name = String(msg.name ?? '').trim().slice(0, MAX_NAME) || 'Pilote';
        const resumed = rooms.sessions.resume(msg.token);
        if (resumed) {
          resumed.ws?.close(4000, 'replaced');
          session = resumed;
          session.ws = ws;
          session.send({ t: 'welcome', playerId: session.id, token: session.token, resumed: true });
          rooms.onReconnect(session);
        } else {
          session = rooms.sessions.create(name);
          session.ws = ws;
          session.send({ t: 'welcome', playerId: session.id, token: session.token, resumed: false });
          session.send({ t: 'room', room: null });
        }
        return;
      }
      rooms.handle(session, msg);
    });

    ws.on('close', () => {
      // Une connexion remplacée par une reconnexion ne compte pas comme un départ.
      if (session && session.ws === ws) rooms.onDisconnect(session);
    });
  });

  return wss;
}
