/** Effets plein écran liés à la vitesse : traits de vitesse et halo du turbo. */
export const fxPrefs = { on: true };

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function drawSpeedFx(ctx: CanvasRenderingContext2D, W: number, H: number, speed01: number, boost: boolean, focusX: number, focusY: number): void {
  if (!fxPrefs.on) return;
  const k = Math.max(0, (speed01 - 0.72) / 0.4) + (boost ? 0.6 : 0);
  if (k <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  seed = (performance.now() * 7) | 1;
  const n = Math.round(Math.min(26, k * 16));
  ctx.fillStyle = boost ? 'rgba(160,220,255,0.55)' : 'rgba(255,255,255,0.4)';
  for (let i = 0; i < n; i++) {
    // Traits qui partent du bord de l'écran vers la voiture.
    const a = rnd() * Math.PI * 2;
    const r0 = Math.max(W, H) * (0.42 + rnd() * 0.25);
    const len = 14 + rnd() * 30 * Math.min(1.5, k);
    const x0 = focusX + Math.cos(a) * r0, y0 = focusY + Math.sin(a) * r0 * 0.7;
    const steps = Math.round(len / 2);
    for (let s = 0; s < steps; s++) ctx.fillRect(Math.round(x0 - Math.cos(a) * s * 2), Math.round(y0 - Math.sin(a) * s * 1.4), 1, 1);
  }
  if (boost) {
    const g = ctx.createRadialGradient(focusX, focusY, Math.min(W, H) * 0.35, focusX, focusY, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(79,195,255,0)');
    g.addColorStop(1, 'rgba(79,195,255,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
