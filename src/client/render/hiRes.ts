/**
 * Le jeu est composé en « pixels de jeu » (environ 550 × 330 visibles), mais le canevas est à
 * la résolution réelle de l'écran : chaque transformation est multipliée par `scale`. Le décor
 * reste en pixel art (dessiné sans lissage), tandis que les voitures, rendues en haute
 * définition, profitent de tous les pixels de l'écran.
 */
type Ctx = CanvasRenderingContext2D & { hiScale?: number };

const baseSetTransform = CanvasRenderingContext2D.prototype.setTransform as (this: CanvasRenderingContext2D, ...m: unknown[]) => void;

/** Dimensionne le canevas pour l'écran ; renvoie la taille de la vue en pixels de jeu. */
export function fitCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { W: number; H: number; scale: number } {
  const w = innerWidth, h = innerHeight;
  const zoom = Math.max(0.6, Math.min(h / 330, w / 550));
  // Au-delà de 4 pixels d'écran par pixel de jeu, on ne voit plus la différence.
  const scale = Math.min(4, zoom * (devicePixelRatio || 1));
  const W = Math.ceil(w / zoom), H = Math.ceil(h / zoom);
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const c = ctx as Ctx;
  c.hiScale = scale;
  if (!Object.prototype.hasOwnProperty.call(c, 'setTransform')) {
    c.setTransform = function (this: Ctx, a?: number | DOMMatrix2DInit, b?: number, cc?: number, d?: number, e?: number, f?: number) {
      const s = this.hiScale ?? 1;
      if (typeof a === 'number') return baseSetTransform.call(this, a * s, b! * s, cc! * s, d! * s, e! * s, f! * s);
      const m = new DOMMatrix([a?.a ?? 1, a?.b ?? 0, a?.c ?? 0, a?.d ?? 1, a?.e ?? 0, a?.f ?? 0]);
      return baseSetTransform.call(this, new DOMMatrix([s, 0, 0, s, 0, 0]).multiply(m));
    } as Ctx['setTransform'];
  }
  ctx.imageSmoothingEnabled = false;
  return { W, H, scale };
}
