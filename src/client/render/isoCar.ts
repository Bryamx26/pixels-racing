import { CARS, CAR_CELL_H, CAR_CELL_W } from '../../shared/cars/carAtlas';
import atlasUrl from '../assets/voitures.png';
import { ISO, ISO_Z } from './iso';

export const atlas = new Image();
atlas.src = atlasUrl;

/**
 * Voitures en isométrique par empilement de tranches (« sprite stacking ») : chaque voiture
 * de la planche vue de dessus est découpée en tranches (roues, caisse, vitres, toit) que l'on
 * dessine l'une au-dessus de l'autre, tournées selon le cap puis projetées. On obtient une
 * vraie voiture en volume, visible sous tous les angles, qui garde le dessin d'origine.
 */
interface Slice {
  img: HTMLCanvasElement;
  /** Hauteur (unités monde) de la tranche. */
  z: number;
}

/** Hauteur totale d'une voiture (unités monde). */
export const CAR_HEIGHT = 17;
const BODY_LOW = 3;
const BODY_TOP = 10;

const cache = new Map<number, Slice[]>();

function canvas(w = CAR_CELL_W, h = CAR_CELL_H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function fromData(d: ImageData): HTMLCanvasElement {
  const [c, g] = canvas(d.width, d.height);
  g.putImageData(d, 0, 0);
  return c;
}

/** Découpe une voiture de l'atlas en tranches. */
function buildSlices(carId: number): Slice[] {
  const W = CAR_CELL_W, H = CAR_CELL_H;
  const [, g] = canvas();
  g.drawImage(atlas, (carId % 4) * W, Math.floor(carId / 4) * H, W, H, 0, 0, W, H);
  const src = g.getImageData(0, 0, W, H);
  const p = src.data;
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : p[(y * W + x) * 4 + 3]);

  // Habitacle : repéré par les vitres (pixels sombres et bleutés) au centre de la voiture.
  const cy = H / 2;
  let gx0 = W, gx1 = -1;
  for (let y = Math.floor(cy - 5); y <= Math.ceil(cy + 5); y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (p[o + 3] < 200) continue;
      const r = p[o], gg = p[o + 1], b = p[o + 2];
      if (r + gg + b < 150 && b >= r && Math.abs(x - W / 2) < W * 0.32) {
        gx0 = Math.min(gx0, x);
        gx1 = Math.max(gx1, x);
      }
    }
  }
  if (gx1 - gx0 < 8) {
    gx0 = Math.round(W * 0.32);
    gx1 = Math.round(W * 0.66);
  }
  // Largeur de la caisse à hauteur de l'habitacle.
  let y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) {
    if (alpha(Math.round((gx0 + gx1) / 2), y) > 128) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const inCabin = (x: number, y: number) => x >= gx0 && x <= gx1 && y >= y0 + 3 && y <= y1 - 3 && alpha(x, y) > 128;

  const tinted = (k: number, only?: (x: number, y: number) => boolean) => {
    const d = new ImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (p[o + 3] < 100 || (only && !only(x, y))) continue;
        d.data[o] = Math.min(255, p[o] * k);
        d.data[o + 1] = Math.min(255, p[o + 1] * k);
        d.data[o + 2] = Math.min(255, p[o + 2] * k);
        d.data[o + 3] = 255;
      }
    }
    return fromData(d);
  };

  // Roues et soubassement.
  const [wheels, wg] = canvas();
  let bx0 = W, bx1 = -1;
  for (let x = 0; x < W; x++) if (alpha(x, Math.round(cy)) > 128) (bx0 = Math.min(bx0, x)), (bx1 = Math.max(bx1, x));
  const len = bx1 - bx0;
  wg.fillStyle = '#16161c';
  wg.fillRect(bx0 + 3, y0 + 2, len - 6, y1 - y0 - 4);
  for (const fx of [0.2, 0.78]) {
    for (const side of [y0 - 1, y1 - 4]) {
      wg.fillStyle = '#0c0c10';
      wg.fillRect(Math.round(bx0 + len * fx - 5), side, 10, 6);
      wg.fillStyle = '#5c5c66';
      wg.fillRect(Math.round(bx0 + len * fx - 2), side + 2, 4, 2);
    }
  }

  // Vitres latérales de l'habitacle.
  const [glass, gl] = canvas();
  gl.fillStyle = '#1b1f38';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inCabin(x, y)) gl.fillRect(x, y, 1, 1);
  const [glassHi, gh] = canvas();
  gh.drawImage(glass, 0, 0);
  gh.globalCompositeOperation = 'source-atop';
  gh.fillStyle = '#5c7ab8';
  gh.fillRect(0, 0, W, H);

  // Flancs : couleur principale de la caisse, unie, avec un liseré sombre au bord (les
  // tranches tirées du dessin du dessus feraient des rayures sur les côtés).
  const side = (k: number) => {
    const [cr, cg, cb] = mainColor(p);
    const d = new ImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (alpha(x, y) < 100) continue;
        const edge = alpha(x - 1, y) < 100 || alpha(x + 1, y) < 100 || alpha(x, y - 1) < 100 || alpha(x, y + 1) < 100;
        const o = (y * W + x) * 4;
        const e = edge ? 0.55 : 1;
        d.data[o] = cr * k * e;
        d.data[o + 1] = cg * k * e;
        d.data[o + 2] = cb * k * e;
        d.data[o + 3] = 255;
      }
    }
    return fromData(d);
  };

  const slices: Slice[] = [];
  for (let z = 0; z < BODY_LOW; z += 1 / ISO_Z) slices.push({ img: wheels, z });
  const dark = side(0.5), mid = side(0.7), light = tinted(0.85);
  for (let z = BODY_LOW; z < BODY_TOP; z += 1 / ISO_Z) slices.push({ img: z < BODY_TOP - 3 ? dark : mid, z });
  slices.push({ img: light, z: BODY_TOP });
  slices.push({ img: tinted(1), z: BODY_TOP + 1 / ISO_Z });
  for (let z = BODY_TOP + 2 / ISO_Z; z < CAR_HEIGHT - 1; z += 1 / ISO_Z) slices.push({ img: z > CAR_HEIGHT - 3 ? glassHi : glass, z });
  slices.push({ img: tinted(1.12, inCabin), z: CAR_HEIGHT - 1 });
  return slices;
}

/** Couleur dominante de la carrosserie (pixels saturés les plus fréquents). */
function mainColor(p: Uint8ClampedArray): [number, number, number] {
  const bins = new Map<number, [number, number, number, number]>();
  for (let o = 0; o < p.length; o += 4) {
    if (p[o + 3] < 200) continue;
    const r = p[o], g = p[o + 1], b = p[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 70 || mx - mn < 40) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = bins.get(key) ?? [0, 0, 0, 0];
    e[0] += r;
    e[1] += g;
    e[2] += b;
    e[3]++;
    bins.set(key, e);
  }
  let best: [number, number, number, number] = [150, 150, 160, 1];
  for (const e of bins.values()) if (e[3] > best[3]) best = e;
  return [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
}

function slicesFor(carId: number): Slice[] | null {
  if (!atlas.complete || !atlas.naturalWidth) return null;
  let s = cache.get(carId);
  if (!s) {
    s = buildSlices(carId);
    cache.set(carId, s);
  }
  return s;
}

/**
 * Dessine une voiture. (sx, sy) : position écran du point au sol sous le centre de la voiture,
 * `a` : cap dans le monde, `lean` : roulis (−1..1, la caisse penche vers l'extérieur).
 */
export function drawIsoCar(ctx: CanvasRenderingContext2D, carId: number, a: number, sx: number, sy: number, lean = 0, scale = 1): void {
  const slices = slicesFor(carId);
  const c = Math.cos(a), s = Math.sin(a);
  const A = ISO * (c - s) * scale, B = (ISO / 2) * (c + s) * scale;
  const C = ISO * (-s - c) * scale, D = (ISO / 2) * (c - s) * scale;
  ctx.save();
  if (!slices) {
    ctx.setTransform(A, B, C, D, sx, sy - 8 * scale);
    ctx.fillStyle = CARS[carId]?.color ?? '#f0f';
    ctx.fillRect(-25, -14, 50, 28);
    ctx.restore();
    return;
  }
  const base = ctx.getTransform();
  for (const sl of slices) {
    // Le roulis décale les tranches hautes vers l'extérieur du virage.
    const k = (sl.z / CAR_HEIGHT) * lean * 2.2;
    const ex = sx + C * k, ey = sy + D * k - sl.z * ISO_Z * scale;
    ctx.setTransform(
      base.a * A + base.c * B,
      base.b * A + base.d * B,
      base.a * C + base.c * D,
      base.b * C + base.d * D,
      base.a * ex + base.c * ey + base.e,
      base.b * ex + base.d * ey + base.f,
    );
    ctx.drawImage(sl.img, -CAR_CELL_W / 2, -CAR_CELL_H / 2);
  }
  ctx.restore();
}

// ---------- Vignettes des menus ----------
export const THUMB_W = 72;
export const THUMB_H = 52;
let thumbUrl = '';

/** Planche des 16 voitures en isométrique (4 par ligne), pour les vignettes des menus. */
export function thumbAtlasUrl(): string {
  if (thumbUrl) return thumbUrl;
  if (!atlas.complete || !atlas.naturalWidth) return atlasUrl;
  const [c, g] = canvas(THUMB_W * 4, THUMB_H * 4);
  g.imageSmoothingEnabled = false;
  for (let id = 0; id < CARS.length; id++) {
    const x = (id % 4) * THUMB_W + THUMB_W / 2, y = Math.floor(id / 4) * THUMB_H + THUMB_H / 2 + 7;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x, y + 1, 26, 12, 0, 0, Math.PI * 2);
    g.fill();
    drawIsoCar(g, id, -0.35, x, y);
  }
  thumbUrl = c.toDataURL();
  return thumbUrl;
}

export const isoReady = new Promise<void>((res) => {
  if (atlas.complete && atlas.naturalWidth) res();
  else atlas.addEventListener('load', () => res(), { once: true });
});
