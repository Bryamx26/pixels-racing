import { defineConfig } from 'vite';

// Le client est servi par Vite en dev (port 5173) et le WebSocket est proxifié
// vers le serveur de jeu (port 3000). En prod, le serveur sert directement dist/.
export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    host: true, // accessible depuis un téléphone sur le même réseau
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
