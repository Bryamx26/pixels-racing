import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RoomManager } from './rooms/roomManager';
import { attachSocketServer } from './net/socketServer';
import { staticHandler } from './net/staticFiles';
import { startFixedLoop } from './net/gameLoop';
import { Records } from './records/records';
import { getWorld } from '../shared/world/world';

const PORT = Number(process.env.PORT ?? 3000);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../dist');

const records = new Records(process.env.RECORDS_FILE ?? join(dirname(fileURLToPath(import.meta.url)), '../../data/records.json'));
const rooms = new RoomManager(records);
const files = staticHandler(root);
const server = createServer((req, res) => {
  if (!records.handle(req, res)) files(req, res);
});
attachSocketServer(server, rooms);
startFixedLoop(() => rooms.tick());

server.listen(PORT, () => {
  console.log(`Pixels Racing : http://localhost:${PORT}`);
});

// Le monde ouvert est généré une fois au démarrage (pas pendant la partie).
const t0 = performance.now();
getWorld();
console.log(`Monde ouvert prêt (${Math.round(performance.now() - t0)} ms)`);
