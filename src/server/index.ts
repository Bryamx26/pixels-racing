import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RoomManager } from './rooms/roomManager';
import { attachSocketServer } from './net/socketServer';
import { staticHandler } from './net/staticFiles';
import { startFixedLoop } from './net/gameLoop';

const PORT = Number(process.env.PORT ?? 3000);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../dist');

const rooms = new RoomManager();
const server = createServer(staticHandler(root));
attachSocketServer(server, rooms);
startFixedLoop(() => rooms.tick());

server.listen(PORT, () => {
  console.log(`Pixels Racing : http://localhost:${PORT}`);
});
