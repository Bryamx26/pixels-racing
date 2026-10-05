import { TICK_RATE } from '../../shared/constants';

/** Boucle à pas fixe (60 Hz) avec rattrapage borné. */
export function startFixedLoop(tick: () => void): () => void {
  const stepMs = 1000 / TICK_RATE;
  let next = performance.now();
  let timer: NodeJS.Timeout;
  let running = true;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    let n = 0;
    while (now >= next && n < 5) {
      tick();
      next += stepMs;
      n++;
    }
    if (now - next > 250) next = now; // serveur gelé : on ne rattrape pas indéfiniment
    timer = setTimeout(loop, Math.max(0, next - performance.now()));
  };
  loop();
  return () => {
    running = false;
    clearTimeout(timer);
  };
}
