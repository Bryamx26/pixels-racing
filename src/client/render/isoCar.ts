import { CARS, CAR_CELL_H, CAR_CELL_W } from '../../shared/cars/carAtlas';
import { CAR_WIDTH } from '../../shared/constants';
import { carClass } from '../../shared/cars/stats';
import atlasUrl from '../assets/voitures.png';
import { ISO, ISO_Z } from './iso';

/**
 * Voitures en voxels : chaque voiture est un modèle 3D en petits cubes (caisse, habitacle
 * vitré, roues, phares, aileron…), dont la silhouette dépend de sa famille (coupé, bolide
 * bas, citadine nerveuse, gros 4×4) et les couleurs viennent de son dessin sur la planche.
 * Le modèle est rendu (tampon de profondeur + éclairage) sous 48 angles, à la demande.
 */

export const atlas = new Image();
atlas.src = atlasUrl;

export const CAR_HEIGHT = 17;
const ANGLES = 48;
const SW = 76, SH = 64;
/** Point au sol sous le centre de la voiture, dans le sprite. */
const AX = SW / 2, AY = 42;

type RGB = [number, number, number];
interface Voxel {
  u: number;
  v: number;
  z: number;
  c: RGB;
  /** Normale (somme des faces à l'air libre), repère voiture. */
  n: [number, number, number];
}

// ---------- Couleurs tirées du dessin de la voiture ----------
function spritePixels(carId: number): Uint8ClampedArray | null {
  if (!atlas.complete || !atlas.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = CAR_CELL_W;
  c.height = CAR_CELL_H;
  const g = c.getContext('2d')!;
  g.drawImage(atlas, (carId % 4) * CAR_CELL_W, Math.floor(carId / 4) * CAR_CELL_H, CAR_CELL_W, CAR_CELL_H, 0, 0, CAR_CELL_W, CAR_CELL_H);
  return g.getImageData(0, 0, CAR_CELL_W, CAR_CELL_H).data;
}

/** Les deux couleurs saturées les plus présentes (carrosserie, puis accent). */
function palette(carId: number): [RGB, RGB] {
  const fallback = parseHex(CARS[carId]?.color ?? '#888');
  const p = spritePixels(carId);
  if (!p) return [fallback, [240, 240, 240]];
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
  const sorted = [...bins.values()].sort((a, b) => b[3] - a[3]).map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3]] as RGB);
  const main = sorted[0] ?? fallback;
  const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const accent = sorted.find((c) => dist(c, main) > 120) ?? [240, 240, 240];
  return [main, accent];
}

function parseHex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------- Modèle ----------
interface Shape {
  len: number;
  /** Haut de la caisse, avant (capot) et arrière. */
  body: number;
  /** Habitacle : arrière, avant (à la base), hauteur du toit, pentes du pare-brise et de la lunette. */
  cabRear: number;
  cabFront: number;
  roof: number;
  slopeF: number;
  slopeR: number;
  wheelR: number;
  clearance: number;
  spoiler: boolean;
}

function shapeFor(carId: number): Shape {
  if (carId === 12) {
    // Titan : le monster truck de la planche.
    return { len: 46, body: 13, cabRear: -12, cabFront: 6, roof: 19, slopeF: 0.8, slopeR: 0.3, wheelR: 7, clearance: 7, spoiler: false };
  }
  switch (carClass(carId).id) {
    case 'vitesse':
      return { len: 50, body: 7, cabRear: -9, cabFront: 5, roof: 12, slopeF: 1.6, slopeR: 1.4, wheelR: 4.5, clearance: 2, spoiler: true };
    case 'agile':
      return { len: 44, body: 8, cabRear: -12, cabFront: 7, roof: 14, slopeF: 1.2, slopeR: 0.7, wheelR: 4.5, clearance: 2, spoiler: false };
    case 'lourde':
      return { len: 50, body: 10, cabRear: -21, cabFront: 9, roof: 17, slopeF: 1.0, slopeR: 0.15, wheelR: 5.5, clearance: 3, spoiler: false };
    default:
      return { len: 50, body: 8, cabRear: -12, cabFront: 7, roof: 14, slopeF: 1.3, slopeR: 0.9, wheelR: 4.5, clearance: 2, spoiler: carId % 2 === 0 };
  }
}

function buildModel(carId: number): Voxel[] {
  const s = shapeFor(carId);
  const [main, accent] = palette(carId);
  const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const stripes = carId % 3 === 0 && Math.abs(lum(accent) - lum(main)) > 60;
  const half = s.len / 2;
  const hw = CAR_WIDTH / 2 - 2;
  const dark: RGB = [26, 26, 32];
  const glass: RGB = [34, 46, 82];
  const glassHi: RGB = [96, 132, 196];
  const tyre: RGB = [20, 20, 24];
  const rim: RGB = [184, 188, 200];
  const wheelU = [half - 9, -half + 9];

  const bodyTop = (u: number) => s.clearance + s.body - (u > half - 9 ? (u - (half - 9)) * 0.45 : 0) - (u < -half + 3 ? 1 : 0);
  const bodyHalf = (u: number) => hw - Math.max(0, Math.abs(u) - (half - 4)) * 1.6;

  const at = (u: number, v: number, z: number): RGB | null => {
    // Roues (dépassent légèrement de la caisse).
    for (const wu of wheelU) {
      const d2 = (u - wu) ** 2 + (z - s.wheelR) ** 2;
      if (d2 <= s.wheelR * s.wheelR && Math.abs(v) >= hw - 3 && Math.abs(v) <= hw + 1) {
        return Math.abs(v) === hw + 1 && d2 <= (s.wheelR * 0.5) ** 2 ? rim : tyre;
      }
    }
    if (Math.abs(u) > half) return null;
    const top = bodyTop(u);
    const bh = bodyHalf(u);
    // Caisse.
    if (z >= s.clearance && z <= top && Math.abs(v) <= bh) {
      const front = u >= half - 1, rear = u <= -half;
      if ((front || rear) && Math.abs(v) >= 6 && Math.abs(v) <= 10 && z >= top - 3 && z <= top - 2) return front ? [255, 243, 176] : [232, 51, 58];
      if (front && Math.abs(v) <= 5 && z <= s.clearance + 2) return dark;
      if (z === s.clearance) return dark;
      // Passages de roue.
      for (const wu of wheelU) if ((u - wu) ** 2 + (z - s.wheelR) ** 2 <= (s.wheelR + 1) ** 2 && Math.abs(v) >= hw - 4) return null;
      return main;
    }
    // Habitacle.
    const base = s.clearance + s.body;
    if (z > top && z <= s.clearance + s.roof) {
      const h = z - base;
      const uf = s.cabFront - h * s.slopeF, ur = s.cabRear + h * s.slopeR;
      const cw = hw - 2 - h * 0.35;
      if (u > uf || u < ur || Math.abs(v) > cw) return null;
      const roofZ = s.clearance + s.roof;
      if (z >= roofZ) return stripes && Math.abs(v) <= 3 && Math.abs(v) >= 1 ? accent : main;
      const mid = (s.cabFront + s.cabRear) / 2 - 1;
      if (Math.abs(u - mid) < 1.2 && Math.abs(v) > cw - 1.5) return main; // montant central
      return z >= roofZ - 1 ? glassHi : glass;
    }
    // Aileron.
    if (s.spoiler) {
      const zs = s.clearance + s.body + 3;
      if (u >= -half + 1 && u <= -half + 4 && Math.abs(v) <= hw && z >= zs && z <= zs + 1) return accent;
      if (Math.abs(u - (-half + 2.5)) <= 1 && Math.abs(Math.abs(v) - 8) <= 0.5 && z > top && z < zs) return dark;
    }
    return null;
  };

  // Grille de voxels puis on ne garde que la surface.
  const U0 = -26, V0 = -16, Z0 = 0, NU = 53, NV = 33, NZ = 22;
  const grid: (RGB | null)[] = new Array(NU * NV * NZ);
  const idx = (i: number, j: number, k: number) => (k * NV + j) * NU + i;
  for (let k = 0; k < NZ; k++)
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) grid[idx(i, j, k)] = at(i + U0, j + V0, k + Z0);
  const filled = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < NU && j < NV && k < NZ && !!grid[idx(i, j, k)];
  const out: Voxel[] = [];
  for (let k = 0; k < NZ; k++) {
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const c = grid[idx(i, j, k)];
        if (!c) continue;
        const n: [number, number, number] = [0, 0, 0];
        if (!filled(i + 1, j, k)) n[0]++;
        if (!filled(i - 1, j, k)) n[0]--;
        if (!filled(i, j + 1, k)) n[1]++;
        if (!filled(i, j - 1, k)) n[1]--;
        if (!filled(i, j, k + 1)) n[2]++;
        if (!filled(i, j, k - 1)) n[2]--;
        if (n[0] === 0 && n[1] === 0 && n[2] === 0 && filled(i + 1, j, k) && filled(i, j + 1, k) && filled(i, j, k + 1)) continue;
        out.push({ u: i + U0 + 0.5, v: j + V0 + 0.5, z: k + Z0, c, n });
      }
    }
  }
  return out;
}

// ---------- Rendu d'un angle ----------
const L = (() => {
  const l = [-0.35, 0.55, 1];
  const m = Math.hypot(...l);
  return l.map((x) => x / m);
})();

function renderAngle(model: Voxel[], a: number): HTMLCanvasElement {
  const img = new ImageData(SW, SH);
  const zb = new Float32Array(SW * SH).fill(-1e9);
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const vx of model) {
    const x = vx.u * ca - vx.v * sa, y = vx.u * sa + vx.v * ca;
    const nx = vx.n[0] * ca - vx.n[1] * sa, ny = vx.n[0] * sa + vx.n[1] * ca, nz = vx.n[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lit = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
    const k = 0.5 + 0.62 * lit;
    const sx = (x - y) * ISO + AX, sy = (x + y) * (ISO / 2) - vx.z * ISO_Z + AY;
    const depth = x + y + vx.z * 1.6;
    const px = Math.round(sx) - 1, py = Math.round(sy) - 1;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const X = px + dx, Y = py + dy;
        if (X < 0 || Y < 0 || X >= SW || Y >= SH) continue;
        const o = Y * SW + X;
        if (depth <= zb[o]) continue;
        zb[o] = depth;
        img.data[o * 4] = Math.min(255, vx.c[0] * k);
        img.data[o * 4 + 1] = Math.min(255, vx.c[1] * k);
        img.data[o * 4 + 2] = Math.min(255, vx.c[2] * k);
        img.data[o * 4 + 3] = 255;
      }
    }
  }
  // Contour sombre d'un pixel, pour que la voiture se détache du décor.
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const o = (y * SW + x) * 4;
      if (d[o + 3]) continue;
      const n = (X: number, Y: number) => X >= 0 && Y >= 0 && X < SW && Y < SH && d[(Y * SW + X) * 4 + 3] > 0;
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) {
        out[o] = 14;
        out[o + 1] = 12;
        out[o + 2] = 22;
        out[o + 3] = 230;
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  c.getContext('2d')!.putImageData(new ImageData(out, SW, SH), 0, 0);
  return c;
}

const models = new Map<number, Voxel[]>();
const sprites = new Map<number, HTMLCanvasElement>();

function spriteFor(carId: number, a: number): HTMLCanvasElement | null {
  if (!atlas.complete || !atlas.naturalWidth) return null;
  const b = ((Math.round((a / (Math.PI * 2)) * ANGLES) % ANGLES) + ANGLES) % ANGLES;
  const key = carId * ANGLES + b;
  let s = sprites.get(key);
  if (!s) {
    let m = models.get(carId);
    if (!m) {
      m = buildModel(carId);
      models.set(carId, m);
    }
    s = renderAngle(m, (b / ANGLES) * Math.PI * 2);
    sprites.set(key, s);
  }
  return s;
}

/**
 * Dessine une voiture. (sx, sy) : position écran du point au sol sous le centre de la voiture,
 * `a` : cap dans le monde, `lean` : roulis (−1..1, la caisse penche vers l'extérieur).
 */
export function drawIsoCar(ctx: CanvasRenderingContext2D, carId: number, a: number, sx: number, sy: number, lean = 0, scale = 1): void {
  const s = spriteFor(carId, a);
  if (!s) {
    ctx.fillStyle = CARS[carId]?.color ?? '#f0f';
    ctx.fillRect(sx - 14, sy - 16, 28, 16);
    return;
  }
  // Le roulis décale légèrement la voiture vers l'extérieur du virage.
  const ox = Math.round(-Math.sin(a) * lean * 1.5 * ISO), oy = 0;
  ctx.drawImage(s, Math.round(sx - AX * scale) + ox, Math.round(sy - AY * scale) + oy, SW * scale, SH * scale);
}

// ---------- Vignettes des menus ----------
export const THUMB_W = 72;
export const THUMB_H = 52;
let thumbUrl = '';

/** Planche des 16 voitures en isométrique (4 par ligne), pour les vignettes des menus. */
export function thumbAtlasUrl(): string {
  if (thumbUrl) return thumbUrl;
  if (!atlas.complete || !atlas.naturalWidth) return atlasUrl;
  const c = document.createElement('canvas');
  c.width = THUMB_W * 4;
  c.height = THUMB_H * 4;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  for (let id = 0; id < CARS.length; id++) {
    const x = (id % 4) * THUMB_W + THUMB_W / 2, y = Math.floor(id / 4) * THUMB_H + THUMB_H / 2 + 12;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x, y, 26, 11, 0, 0, Math.PI * 2);
    g.fill();
    drawIsoCar(g, id, -0.45, x, y);
  }
  thumbUrl = c.toDataURL();
  return thumbUrl;
}

export const isoReady = new Promise<void>((res) => {
  if (atlas.complete && atlas.naturalWidth) res();
  else atlas.addEventListener('load', () => res(), { once: true });
});

