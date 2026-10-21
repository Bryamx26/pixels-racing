import { CAR_CELL_H, CAR_CELL_W } from '../../shared/cars/carAtlas';
import { ATLAS_COUNT, CARS } from '../../shared/cars/roster';
import { CAR_WIDTH } from '../../shared/constants';
import atlasUrl from '../assets/voitures.png';
import { ISO, ISO_Z } from './iso';

/**
 * Voitures en voxels inspirées de vrais modèles : muscle car américaine, sportive à moteur
 * arrière, compacte sportive, berline, gros 4×4, monster truck et japonaises de drift (larges
 * ailes, grand aileron). Les couleurs ET la déco du dessus (bandes, flammes, damiers, logos)
 * reprennent le dessin de chaque voiture sur la planche d'origine, plaqué sur le capot, le
 * toit et le coffre. Rendu en tampon de profondeur avec éclairage, sous 48 angles, à la demande.
 */

export const atlas = new Image();
atlas.src = atlasUrl;

/** Échelle d'affichage (les voitures sont un peu plus petites que leur zone de choc). */
export const CAR_SCALE = 0.7;
export const CAR_HEIGHT = 12;
const ANGLES = 48;
const SW = 68, SH = 58;
/** Point au sol sous le centre de la voiture, dans le sprite. */
const AX = SW / 2, AY = 38;
/**
 * Taille d'un pixel de la voiture en pixels de jeu : le sprite est rendu en basse
 * définition puis agrandi sans lissage, pour des voitures en gros pixels.
 */
const PIX = 2;
const LW = SW / PIX, LH = SH / PIX;

type RGB = [number, number, number];
type Kind = 'body' | 'other';
interface Voxel {
  u: number;
  v: number;
  z: number;
  c: RGB;
  /** Normale (somme des faces à l'air libre), repère voiture. */
  n: [number, number, number];
}

function parseHex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------- Dessin d'origine (vu de dessus) ----------
interface Art {
  px: Uint8ClampedArray;
  /** Emprise de la voiture dans la case. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function spriteArt(carId: number): Art | null {
  if (carId >= ATLAS_COUNT || !atlas.complete || !atlas.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = CAR_CELL_W;
  c.height = CAR_CELL_H;
  const g = c.getContext('2d')!;
  g.drawImage(atlas, (carId % 4) * CAR_CELL_W, Math.floor(carId / 4) * CAR_CELL_H, CAR_CELL_W, CAR_CELL_H, 0, 0, CAR_CELL_W, CAR_CELL_H);
  const px = g.getImageData(0, 0, CAR_CELL_W, CAR_CELL_H).data;
  let x0 = CAR_CELL_W, x1 = 0, y0 = CAR_CELL_H, y1 = 0;
  for (let y = 0; y < CAR_CELL_H; y++) {
    for (let x = 0; x < CAR_CELL_W; x++) {
      if (px[(y * CAR_CELL_W + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { px, x0, x1, y0, y1 };
}

/** Les deux couleurs saturées les plus présentes du dessin (carrosserie, accent). */
function palette(carId: number, art: Art | null): [RGB, RGB] {
  const def = CARS[carId];
  const fallback = parseHex(def?.color ?? '#888888');
  if (!art) return [fallback, parseHex(def?.accent ?? '#f0f0f0')];
  const p = art.px;
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
  return [main, sorted.find((c) => dist(c, main) > 120) ?? [240, 240, 240]];
}

/**
 * Déco du dessin d'origine au-dessus du point (u, v) : seulement les pixels de la couleur
 * d'accent (bandes, flammes, damiers), pour une livrée nette en deux tons.
 */
function decal(art: Art | null, u: number, v: number, half: number, accent: RGB): RGB | null {
  if (!art) return null;
  // Lu par blocs de la taille d'un gros pixel, pour une déco nette sans pixels isolés.
  u = Math.floor(u / PIX) * PIX + PIX / 2;
  v = Math.floor(v / PIX) * PIX + PIX / 2;
  const x = Math.round(art.x0 + ((u + half) / (2 * half)) * (art.x1 - art.x0));
  const y = Math.round(art.y0 + ((v + CAR_WIDTH / 2) / CAR_WIDTH) * (art.y1 - art.y0));
  const p = art.px;
  const isAccent = (X: number, Y: number) => {
    if (X < 0 || Y < 0 || X >= CAR_CELL_W || Y >= CAR_CELL_H) return false;
    const o = (Y * CAR_CELL_W + X) * 4;
    return p[o + 3] >= 200 && Math.abs(p[o] - accent[0]) + Math.abs(p[o + 1] - accent[1]) + Math.abs(p[o + 2] - accent[2]) < 80;
  };
  if (!isAccent(x, y)) return null;
  // Zone d'accent assez grande (pas un reflet isolé).
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isAccent(x + dx, y + dy)) n++;
  return n >= 8 ? accent : null;
}

// ---------- Modèles ----------
type ModelKind = 'muscle' | 'sport' | 'hatch' | 'sedan' | 'suv' | 'monster' | 'drift' | 'gtr';

interface Shape {
  kind: ModelKind;
  len: number;
  /** Bas de caisse (garde au sol), hauteur de caisse au-dessus. */
  clearance: number;
  body: number;
  /** Habitacle : arrière et avant à la base, hauteur du toit, pentes du pare-brise et de la lunette. */
  cabRear: number;
  cabFront: number;
  roof: number;
  slopeF: number;
  slopeR: number;
  wheelR: number;
  /** Arrondi des coins de caisse. */
  round: number;
  wing: 'none' | 'lip' | 'ducktail' | 'gt';
}

/** Modèle de chaque voiture (selon sa famille et son dessin d'origine). */
const MODEL: ModelKind[] = [
  'sport', 'suv', 'hatch', 'muscle',
  'hatch', 'sedan', 'sport', 'hatch',
  'muscle', 'hatch', 'sport', 'sedan',
  'monster', 'suv', 'sport', 'suv',
  'drift', 'drift', 'drift', 'drift',
  'gtr',
];

function shapeFor(carId: number): Shape {
  const kind = MODEL[carId] ?? 'sedan';
  switch (kind) {
    case 'muscle': // grosse américaine : long capot, prise d'air, lunette fuyante
      return { kind, len: 50, clearance: 2, body: 8, cabRear: -15, cabFront: 2, roof: 13, slopeF: 1.5, slopeR: 1.6, wheelR: 4.5, round: 1.2, wing: 'lip' };
    case 'sport': // sportive à moteur arrière : basse, arrondie, becquet
      return { kind, len: 48, clearance: 2, body: 7, cabRear: -12, cabFront: 4, roof: 12, slopeF: 1.8, slopeR: 2.2, wheelR: 4.5, round: 2.2, wing: 'ducktail' };
    case 'hatch': // compacte sportive : courte, hayon droit
      return { kind, len: 42, clearance: 2, body: 8, cabRear: -18, cabFront: 5, roof: 14, slopeF: 1.3, slopeR: 0.25, wheelR: 4.5, round: 1.6, wing: 'none' };
    case 'sedan': // berline sportive allemande : trois volumes
      return { kind, len: 50, clearance: 2, body: 8, cabRear: -13, cabFront: 6, roof: 14, slopeF: 1.3, slopeR: 1.0, wheelR: 4.5, round: 1.2, wing: 'lip' };
    case 'suv': // gros 4×4 carré
      return { kind, len: 48, clearance: 4, body: 9, cabRear: -21, cabFront: 7, roof: 17, slopeF: 0.6, slopeR: 0.1, wheelR: 5.5, round: 1, wing: 'none' };
    case 'monster':
      return { kind, len: 44, clearance: 8, body: 7, cabRear: -12, cabFront: 5, roof: 19, slopeF: 0.8, slopeR: 0.3, wheelR: 7.5, round: 1, wing: 'none' };
    case 'gtr': // coupé japonais musclé : caisse carrée, ailes larges, capot ajouré, grand aileron
      return { kind, len: 50, clearance: 2, body: 8, cabRear: -12, cabFront: 4, roof: 13, slopeF: 1.5, slopeR: 1.2, wheelR: 4.5, round: 0.8, wing: 'gt' };
    case 'drift': // japonaise de drift : basse, ailes larges, grand aileron
      return { kind, len: 50, clearance: 2, body: 7, cabRear: -12, cabFront: 5, roof: 12.5, slopeF: 1.5, slopeR: 1.2, wheelR: 4.5, round: 1.4, wing: 'gt' };
  }
}

const GLASS: RGB = [74, 168, 216];
const GLARE: RGB = [226, 244, 255];
const DARK: RGB = [24, 24, 30];
const CHROME: RGB = [200, 204, 214];
const TYRE: RGB = [22, 22, 26];
const RIM: RGB = [190, 194, 206];
const DARK_RIM: RGB = [92, 96, 110];
const HEAD: RGB = [255, 240, 170];
const TAIL: RGB = [230, 48, 54];

function buildModel(carId: number): Voxel[] {
  const s = shapeFor(carId);
  const art = spriteArt(carId);
  const [main, accent] = palette(carId, art);
  const def = CARS[carId];
  const contrast = Math.abs(main[0] - accent[0]) + Math.abs(main[1] - accent[1]) + Math.abs(main[2] - accent[2]) > 200;
  const half = s.len / 2;
  const hw = CAR_WIDTH / 2 - 2;
  const wheelU = [half - 9, -half + 9];
  const base = s.clearance + s.body;
  const flare = s.kind === 'drift' || s.kind === 'gtr' ? 1 : 0;
  const rim = s.kind === 'gtr' ? DARK_RIM : RIM;
  // Vitres foncées sur les voitures bleues (sinon elles se confondent avec la caisse).
  const glass: RGB = s.kind === 'gtr' ? [16, 17, 24] : main[2] > main[0] + 30 && main[2] > main[1] ? [36, 44, 78] : GLASS;
  // Voitures de drift : une sur deux bicolore (bas de caisse de la couleur d'accent).
  const twoTone = !!def?.drift && carId % 2 === 1;

  const bodyTop = (u: number) => base - (u > half - 10 ? (u - (half - 10)) * 0.4 : 0) - (u < -half + 3 ? 1 : 0);
  const bodyHalf = (u: number) => {
    let w = hw - Math.max(0, Math.abs(u) - (half - 4)) * s.round;
    // Ailes élargies au droit des roues.
    if (flare && wheelU.some((wu) => Math.abs(u - wu) < s.wheelR + 2)) w += flare;
    return w;
  };

  const at = (u: number, v: number, z: number): [RGB, Kind] | null => {
    const av = Math.abs(v);
    // Roues.
    for (const wu of wheelU) {
      const d2 = (u - wu) ** 2 + (z - s.wheelR) ** 2;
      if (d2 <= s.wheelR * s.wheelR && av >= hw - 3 + flare && av <= hw + 1 + flare) {
        return [av >= hw + 1 + flare && d2 <= (s.wheelR * 0.55) ** 2 ? rim : TYRE, 'other'];
      }
    }
    const top = bodyTop(u);
    // Grand aileron sur montants (drift) et becquet de coffre.
    if (s.wing === 'gt') {
      const zw = base + 5;
      if (u >= -half && u <= -half + 4 && av <= hw + 1 && z >= zw && z <= zw + 1) return [z === zw + 1 ? accent : DARK, 'other'];
      if (u >= -half + 1 && u <= -half + 3 && Math.abs(av - 7) <= 0.5 && z > top && z < zw) return [DARK, 'other'];
    }
    if (s.wing === 'ducktail' && u >= -half + 1 && u <= -half + 5 && av <= hw - 2 && z === Math.floor(top) + 1) return [main, 'body'];
    if (Math.abs(u) > half + 0.5) return null;
    const bh = bodyHalf(u);
    // Caisse.
    if (z >= s.clearance && z <= top && av <= bh) {
      const front = u >= half - 1, rear = u <= -half + 0.5;
      // Pare-chocs chromés (américaine, berline) ou noirs.
      if ((front || rear) && z <= s.clearance + 1) return [s.kind === 'muscle' || s.kind === 'sedan' ? CHROME : DARK, 'other'];
      if (front && av <= 6 && z <= s.clearance + 3) return [DARK, 'other']; // calandre
      if (front && av >= 6 && av <= hw - 1 && z >= top - 3 && z <= top - 2) return [HEAD, 'other'];
      // Coupé japonais : deux paires de feux ronds séparées par un trait noir.
      if (rear && s.kind === 'gtr' && Math.abs(av - 8) < 1 && z >= top - 3 && z <= top - 2) return [DARK, 'other'];
      if (rear && av >= 5 && av <= hw - 1 && z >= top - 3 && z <= top - 2) return [TAIL, 'other'];
      // Passages de roue.
      for (const wu of wheelU) if ((u - wu) ** 2 + (z - s.wheelR) ** 2 <= (s.wheelR + 1) ** 2 && av >= hw - 4 + flare) return null;
      if (z === s.clearance) return [DARK, 'other'];
      if (twoTone && z <= s.clearance + 3) return [accent, 'other'];
      // Prise d'air du capot, d'un ton plus sombre.
      if (s.kind === 'gtr' && z >= top - 0.5 && u > 7 && u < 16 && av <= 5) return [[main[0] * 0.55, main[1] * 0.55, main[2] * 0.55], 'other'];
      return [main, 'body'];
    }
    // Prise d'air sur le capot des américaines.
    if (s.kind === 'muscle' && u > 4 && u < 12 && av <= 3 && z === Math.floor(top) + 1) return [DARK, 'other'];
    // Roue de secours à l'arrière du 4×4.
    if (s.kind === 'suv' && u < -half && u > -half - 2 && av <= 4 && z >= base - 6 && z <= base - 1) return [TYRE, 'other'];
    // Habitacle.
    const roofZ = s.clearance + s.roof;
    if (z > top && z <= roofZ + (s.kind === 'suv' ? 1 : 0)) {
      const h = z - base;
      const uf = s.cabFront - h * s.slopeF, ur = s.cabRear + h * s.slopeR;
      const cw = hw - 2 - h * 0.35;
      if (u > uf || u < ur || av > cw) return null;
      // Barres de toit du 4×4.
      if (z > roofZ) return Math.abs(av - cw + 1) < 1 ? [DARK, 'other'] : null;
      if (z >= roofZ) return [main, 'body'];
      const mid = (s.cabFront + s.cabRear) / 2 - 1;
      if (Math.abs(u - mid) < 1.2 && av > cw - 1.5) return [main, 'other']; // montant central
      // Vitres en aplat, avec une seule bande de reflet sous le toit.
      return [z >= roofZ - 1 ? GLARE : glass, 'other'];
    }
    return null;
  };

  const U0 = -27, V0 = -17, NU = 55, NV = 35, NZ = 24;
  const grid: ([RGB, Kind] | null)[] = new Array(NU * NV * NZ);
  const idx = (i: number, j: number, k: number) => (k * NV + j) * NU + i;
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) grid[idx(i, j, k)] = at(i + U0, j + V0, k);
  const filled = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < NU && j < NV && k < NZ && !!grid[idx(i, j, k)];
  const out: Voxel[] = [];
  for (let k = 0; k < NZ; k++) {
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const cell = grid[idx(i, j, k)];
        if (!cell) continue;
        const n: [number, number, number] = [
          (filled(i + 1, j, k) ? 0 : 1) - (filled(i - 1, j, k) ? 0 : 1),
          (filled(i, j + 1, k) ? 0 : 1) - (filled(i, j - 1, k) ? 0 : 1),
          (filled(i, j, k + 1) ? 0 : 1) - (filled(i, j, k - 1) ? 0 : 1),
        ];
        const exposed =
          !filled(i + 1, j, k) || !filled(i - 1, j, k) || !filled(i, j + 1, k) || !filled(i, j - 1, k) || !filled(i, j, k + 1) || !filled(i, j, k - 1);
        if (!exposed) continue;
        let c = cell[0];
        // Déco d'origine plaquée sur les surfaces du dessus (capot, toit, coffre).
        if (cell[1] === 'body' && !filled(i, j, k + 1) && contrast) c = decal(art, i + U0, j + V0, half, accent) ?? c;
        out.push({ u: i + U0 + 0.5, v: j + V0 + 0.5, z: k, c, n });
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

/** Ombrage en paliers francs (pas de dégradé), comme une palette de pixel art. */
function shade(lit: number): number {
  if (lit > 0.85) return 1.12;
  if (lit > 0.55) return 0.92;
  if (lit > 0.25) return 0.74;
  return 0.56;
}

function renderAngle(model: Voxel[], a: number): HTMLCanvasElement {
  const img = new ImageData(LW, LH);
  const zb = new Float32Array(LW * LH).fill(-1e9);
  const ca = Math.cos(a), sa = Math.sin(a);
  const f = CAR_SCALE / PIX;
  for (const vx of model) {
    const x = (vx.u * ca - vx.v * sa) * f, y = (vx.u * sa + vx.v * ca) * f, z = vx.z * f;
    const nx = vx.n[0] * ca - vx.n[1] * sa, ny = vx.n[0] * sa + vx.n[1] * ca, nz = vx.n[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const k = shade(Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl));
    const sx = (x - y) * ISO + AX / PIX, sy = (x + y) * (ISO / 2) - z * ISO_Z + AY / PIX;
    const depth = x + y + z * 1.6;
    const X = Math.round(sx), Y = Math.round(sy);
    if (X < 0 || Y < 0 || X >= LW || Y >= LH) continue;
    const o = Y * LW + X;
    if (depth <= zb[o]) continue;
    zb[o] = depth;
    img.data[o * 4] = Math.min(255, vx.c[0] * k);
    img.data[o * 4 + 1] = Math.min(255, vx.c[1] * k);
    img.data[o * 4 + 2] = Math.min(255, vx.c[2] * k);
    img.data[o * 4 + 3] = 255;
  }
  // Contour sombre d'un gros pixel, pour que la voiture se détache du décor.
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  const solid = (X: number, Y: number) => X >= 0 && Y >= 0 && X < LW && Y < LH && d[(Y * LW + X) * 4 + 3] > 0;
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const o = (y * LW + x) * 4;
      if (d[o + 3]) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        out[o] = 14;
        out[o + 1] = 12;
        out[o + 2] = 22;
        out[o + 3] = 255;
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = LW;
  c.height = LH;
  c.getContext('2d')!.putImageData(new ImageData(out, LW, LH), 0, 0);
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
    ctx.fillRect(sx - 12, sy - 14, 24, 14);
    return;
  }
  const ox = Math.round(-Math.sin(a) * lean * 1.5 * ISO);
  ctx.drawImage(s, Math.round(sx - AX * scale) + ox, Math.round(sy - AY * scale), SW * scale, SH * scale);
}

// ---------- Vignettes des menus ----------
export const THUMB_W = 72;
export const THUMB_H = 52;
/** Nombre de lignes de la planche des vignettes. */
export const THUMB_ROWS = Math.ceil(CARS.length / 4);
let thumbUrl = '';

/** Planche des voitures en isométrique (4 par ligne), pour les vignettes des menus. */
export function thumbAtlasUrl(): string {
  if (thumbUrl) return thumbUrl;
  if (!atlas.complete || !atlas.naturalWidth) return atlasUrl;
  const c = document.createElement('canvas');
  c.width = THUMB_W * 4;
  c.height = THUMB_H * THUMB_ROWS;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  for (let id = 0; id < CARS.length; id++) {
    const x = (id % 4) * THUMB_W + THUMB_W / 2, y = Math.floor(id / 4) * THUMB_H + THUMB_H / 2 + 10;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x, y, 20, 8, 0, 0, Math.PI * 2);
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
