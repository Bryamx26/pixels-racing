import { KERB_WIDTH, ROAD_WIDTH, WALL_DIST } from '../../shared/constants';
import { mulberry32 } from '../../shared/math';
import { PIT, gridPose } from '../../shared/race/race';
import { pointAt, wrapIdx, type Track } from '../../shared/track/track';
import { ISO, ISO_Z, elevatedRange, groundMatrix, isoX, isoY, zAt } from './iso';

/**
 * Décor isométrique d'un circuit :
 * - le sol (herbe, chaussée, vibreurs, stands, murs de pneus et décor qui ne peut jamais
 *   cacher une voiture) est cuit une fois dans une grande image ;
 * - les bâtiments et arbres qui peuvent passer devant une voiture sont des sprites triés
 *   avec les voitures à chaque image ;
 * - le pont (tablier et rampes) est une image à part, dessinée entre les voitures du
 *   dessous et celles du dessus.
 */

const PAD = 80;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Position de l'image dans l'espace écran du sol. */
  x: number;
  y: number;
  /** Profondeur (x + y monde) pour le tri avec les voitures. */
  depth: number;
}

export interface IsoArt {
  ground: HTMLCanvasElement;
  /** Décalage écran : sx_sol = isoX + ox, sy_sol = isoY + oy. */
  ox: number;
  oy: number;
  sprites: Sprite[];
  bridge: (Sprite & { key: number }) | null;
}

// ---------- Couleurs ----------
function hex(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function shade(h: string, k: number): string {
  const [r, g, b] = hex(h);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Motif de bitume granuleux. */
function asphaltPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(5);
  g.fillStyle = '#44464f';
  g.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rnd() < 0.5 ? '#3c3e46' : '#4c4e58';
    g.fillRect((rnd() * 32) | 0, (rnd() * 32) | 0, 1 + (rnd() < 0.3 ? 1 : 0), 1);
  }
  return ctx.createPattern(c, 'repeat')!;
}

// ---------- Tracés de l'axe (en coordonnées monde, sous la matrice du sol) ----------
function segPath(ctx: CanvasRenderingContext2D, t: Track, from: number, to: number, offset = 0): void {
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const [x, y] = pointAt(t, wrapIdx(t, i), offset);
    if (i === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Parties de la piste posées au sol (tout sauf le pont et ses rampes). */
function groundRuns(t: Track): [number, number, boolean][] {
  const e = elevatedRange(t);
  if (!e) return [[0, t.n, true]];
  return [[e[1], e[0] + t.n, false]];
}

function roadOnGround(ctx: CanvasRenderingContext2D, t: Track): void {
  const asphalt = asphaltPattern(ctx);
  for (const [from, to, closed] of groundRuns(t)) {
    const path = (off = 0) => {
      segPath(ctx, t, from, to, off);
      if (closed) ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.lineWidth = ROAD_WIDTH + KERB_WIDTH * 2;
    ctx.strokeStyle = '#f2f2f2';
    path();
    ctx.stroke();
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = '#d8262e';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = ROAD_WIDTH;
    ctx.strokeStyle = asphalt;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240, 240, 240, 0.6)';
    ctx.setLineDash([14, 18]);
    for (const side of [-1, 0, 1]) {
      path((side * ROAD_WIDTH) / 4);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

// ---------- Volumes ----------
type Pt = [number, number];

interface BoxOpts {
  windows?: { rnd: () => number; glass: string; lit: number };
  roof?: string;
  roofDetails?: () => number;
  seats?: () => number;
}

/** Point écran (dans le repère du canevas courant, décalé de ox, oy). */
const P = (ox: number, oy: number, x: number, y: number, z: number): Pt => [isoX(x, y) + ox, isoY(x, y, z) + oy];

function poly(g: CanvasRenderingContext2D, pts: Pt[], fill: string): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

/** Pavé orienté posé en (cx, cy), de cap `ang`, w × d au sol, de z0 à z0 + h. */
function box(
  g: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cx: number,
  cy: number,
  ang: number,
  w: number,
  d: number,
  z0: number,
  h: number,
  col: string,
  o: BoxOpts = {},
): void {
  const c = Math.cos(ang), s = Math.sin(ang);
  const corners: Pt[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([u, v]) => [cx + c * u - s * v, cy + s * u + c * v]);
  const faces: { i: number; n: Pt; depth: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
    const l = Math.hypot(mx, my) || 1;
    const n: Pt = [mx / l, my / l];
    if (n[0] + n[1] > 0.01) faces.push({ i, n, depth: a[0] + a[1] + b[0] + b[1] });
  }
  faces.sort((p, q) => p.depth - q.depth);
  for (const f of faces) {
    const a = corners[f.i], b = corners[(f.i + 1) % 4];
    const k = f.n[1] > f.n[0] ? 0.92 : 0.7;
    poly(g, [P(ox, oy, a[0], a[1], z0), P(ox, oy, b[0], b[1], z0), P(ox, oy, b[0], b[1], z0 + h), P(ox, oy, a[0], a[1], z0 + h)], shade(col, k));
    if (o.windows && h > 14) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ex = (b[0] - a[0]) / len, ey = (b[1] - a[1]) / len;
      const [px, py] = P(ox, oy, a[0], a[1], z0);
      g.save();
      g.setTransform(g.getTransform().multiply(new DOMMatrix([ISO * (ex - ey), (ISO / 2) * (ex + ey), 0, -ISO_Z, px, py])));
      const { rnd, glass, lit } = o.windows;
      for (let z = 6; z + 7 < h - 3; z += 11) {
        for (let u = 5; u + 5 < len - 3; u += 9) {
          g.fillStyle = rnd() < lit ? '#ffe7a3' : shade(glass, k);
          g.fillRect(u, z, 5, 7);
        }
      }
      g.restore();
    }
  }
  const top = corners.map(([x, y]) => P(ox, oy, x, y, z0 + h));
  poly(g, top, o.roof ?? shade(col, 1.12));
  if (o.roof) {
    // Rebord du toit.
    g.strokeStyle = shade(o.roof, 0.75);
    g.lineWidth = 1;
    g.beginPath();
    const inset = corners.map(([x, y]) => P(ox, oy, cx + (x - cx) * 0.86, cy + (y - cy) * 0.86, z0 + h));
    inset.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
  }
  if (o.seats) {
    const rnd = o.seats;
    const seat = ['#e34b4b', '#3f8ef0', '#f2c230', '#f2f2f2', '#5ad06a'];
    for (let u = -w / 2 + 4; u < w / 2 - 3; u += 5) {
      for (let v = -d / 2 + 3; v < d / 2 - 2; v += 6) {
        const [x, y] = P(ox, oy, cx + c * u - s * v, cy + s * u + c * v, z0 + h);
        g.fillStyle = rnd() < 0.75 ? seat[Math.floor(rnd() * seat.length)] : '#5a5f70';
        g.fillRect(Math.round(x), Math.round(y) - 1, 2, 2);
      }
    }
  }
  if (o.roofDetails) {
    const rnd = o.roofDetails;
    if (rnd() < 0.6) box(g, ox, oy, cx + (rnd() - 0.5) * w * 0.4, cy + (rnd() - 0.5) * d * 0.4, ang, 12, 10, z0 + h, 6, '#b9bcc6');
    if (rnd() < 0.2) {
      // Château d'eau rayé, comme sur les toits des grandes villes.
      const [x, y] = P(ox, oy, cx - c * w * 0.2, cy - s * w * 0.2, z0 + h);
      g.fillStyle = '#6b4a2e';
      g.fillRect(x - 5, y - 10, 2, 10);
      g.fillRect(x + 3, y - 10, 2, 10);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? '#f2f2f2' : '#d8483a';
        g.fillRect(x - 6, y - 22 + k * 3, 12, 3);
      }
      g.fillStyle = '#f2f2f2';
      g.beginPath();
      g.ellipse(x, y - 23, 6, 3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function tree(g: CanvasRenderingContext2D, sx: number, sy: number, r: number, rnd: () => number): void {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(sx + 4, sy + 1, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5a3b22';
  g.fillRect(Math.round(sx) - 1, Math.round(sy) - 7, 3, 7);
  const shades = ['#1f5a26', '#2b7330', '#3a8c3a', '#56a84a'];
  const cy = sy - 6 - r * 0.8;
  for (let k = 0; k < 4; k++) {
    g.fillStyle = shades[k];
    g.beginPath();
    g.ellipse(sx - k * r * 0.1, cy - k * r * 0.16, r * (1 - k * 0.2), r * (0.85 - k * 0.17), 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#7cc45f';
  for (let k = 0; k < 4; k++) g.fillRect(Math.round(sx - r * 0.5 + rnd() * r * 0.6), Math.round(cy - r * 0.5 + rnd() * r * 0.5), 2, 2);
}

function tyreStack(g: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
  for (let k = 0; k < 2; k++) {
    const y = Math.round(sy) - k * 3;
    g.fillStyle = '#0d0d10';
    g.fillRect(Math.round(sx) - 4, y - 2, 8, 4);
    g.fillStyle = col;
    g.fillRect(Math.round(sx) - 3, y - 2, 6, 2);
  }
  g.fillStyle = '#0d0d10';
  g.fillRect(Math.round(sx) - 1, Math.round(sy) - 6, 2, 1);
}

// ---------- Décor : bâtiments, arbres, tribune ----------
const FACADES = ['#c9a865', '#b5523b', '#d9d6cf', '#3fa3a8', '#d9b44a', '#7fb3d5', '#a8a6b8', '#c27c4e'];
const ROOFS = ['#7d7d85', '#55565e', '#9a9aa2', '#c0583a'];

/** Taille d'un îlot de ville et largeur des rues. */
const BLOCK = 270;
const STREET = 46;

function segDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l));
  return Math.hypot(a[0] + dx * u - x, a[1] + dy * u - y);
}

/** Ligne médiane de la rivière, lissée. */
function riverLine(def: Track['def']): Pt[] {
  const pts = def.river?.points ?? [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 12; k++) {
      const u = k / 12, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

const riverCache = new WeakMap<object, Pt[]>();
function riverDist(def: Track['def'], x: number, y: number): number {
  let line = riverCache.get(def);
  if (!line) riverCache.set(def, (line = riverLine(def)));
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, segDist(x, y, line[i], line[i + 1]));
  return best;
}

/** < 1 : dans l'étang (agrandi de r). */
function pondDist(def: Track['def'], x: number, y: number, r = 0): number {
  if (!def.pond) return Infinity;
  const [cx, cy, rx, ry] = def.pond;
  return Math.hypot((x - cx) / (rx + r + 12), (y - cy) / (ry + r + 12));
}

function inPoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Deco {
  depth: number;
  /** Boîte englobante écran (repère du sol). */
  bb: [number, number, number, number];
  draw: (g: CanvasRenderingContext2D, ox: number, oy: number) => void;
}

function decorations(t: Track, ox: number, oy: number, gw: number, gh: number): Deco[] {
  const def = t.def;
  const rnd = mulberry32(def.seed * 31 + 7);
  const out: Deco[] = [];
  // Distance au tracé (approchée, sur un échantillon sur deux).
  const dist = (x: number, y: number) => {
    let best = Infinity;
    for (let i = 0; i < t.n; i += 2) {
      const d = (t.xs[i] - x) ** 2 + (t.ys[i] - y) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const inCanvas = (x: number, y: number) => {
    const sx = isoX(x, y) + ox, sy = isoY(x, y) + oy;
    return sx > -40 && sx < gw + 40 && sy > 0 && sy < gh + 120;
  };

  // Tribune face à la ligne de départ, du côté où il y a de la place.
  const k0 = wrapIdx(t, Math.round(t.n * 0.985));
  const ang = Math.atan2(t.tys[k0], t.txs[k0]);
  for (const side of [-1, 1]) {
    const [sx, sy] = pointAt(t, k0, side * (WALL_DIST + 46));
    if (dist(sx, sy) < WALL_DIST + 36) continue;
    const nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side;
    const srnd = mulberry32(def.seed + 99);
    const tiers = [0, 1, 2].map((i) => ({ x: sx + nx * i * 18, y: sy + ny * i * 18, h: 8 + i * 10 }));
    const minX = Math.min(...tiers.map((p) => p.x)) - 160, maxX = Math.max(...tiers.map((p) => p.x)) + 160;
    const minY = Math.min(...tiers.map((p) => p.y)) - 160, maxY = Math.max(...tiers.map((p) => p.y)) + 160;
    out.push({
      depth: sx + sy,
      bb: [isoX(minX, maxY) + ox, isoY(minX, minY, 60) + oy, isoX(maxX, minY) + ox, isoY(maxX, maxY) + oy],
      draw: (g, dx, dy) => {
        const order = [...tiers].sort((p, q) => p.x + p.y - (q.x + q.y));
        for (const p of order) box(g, dx, dy, p.x, p.y, ang, 290, 20, 0, p.h, '#8a8fa3', { seats: srnd });
        // Toit de la tribune sur poteaux.
        const back = tiers[2];
        box(g, dx, dy, back.x + nx * 10, back.y + ny * 10, ang, 300, 70, 46, 4, '#d8d8de', { roof: '#e8e8ee' });
      },
    });
    break;
  }

  const addBuilding = (x: number, y: number, w: number, dd: number, h: number, pavement: boolean) => {
    const col = FACADES[Math.floor(rnd() * FACADES.length)];
    const roof = h < 30 && rnd() < 0.6 ? '#c0583a' : ROOFS[Math.floor(rnd() * 3)];
    const seed = Math.floor(rnd() * 1e9);
    const lit = rnd() * 0.25;
    const glass = rnd() < 0.5 ? '#2e3d5c' : '#3b6f8f';
    const r = Math.hypot(w, dd) / 2 + 8;
    out.push({
      depth: x + y,
      bb: [isoX(x - r, y + r) + ox, isoY(x - r, y - r, h + 30) + oy, isoX(x + r, y - r) + ox, isoY(x + r, y + r) + oy],
      draw: (g, dx, dy) => {
        const br = mulberry32(seed);
        if (pavement) {
          // Trottoir autour du bâtiment.
          const pav: Pt[] = [
            [x - w / 2 - 8, y - dd / 2 - 8],
            [x + w / 2 + 8, y - dd / 2 - 8],
            [x + w / 2 + 8, y + dd / 2 + 8],
            [x - w / 2 - 8, y + dd / 2 + 8],
          ];
          poly(g, pav.map(([px, py]) => P(dx, dy, px, py, 0)), '#a7a7ad');
        }
        box(g, dx, dy, x, y, 0, w, dd, 0, h, col, { windows: { rnd: br, glass, lit }, roof, roofDetails: br });
      },
    });
  };
  const addTree = (tx: number, ty: number, r: number) => {
    const seed = Math.floor(rnd() * 1e9);
    const sx = isoX(tx, ty) + ox, sy = isoY(tx, ty) + oy;
    out.push({
      depth: tx + ty,
      bb: [sx - r - 2, sy - 8 - r * 2.2, sx + r + 6, sy + 4],
      draw: (g, dx, dy) => tree(g, isoX(tx, ty) + dx, isoY(tx, ty) + dy, r, mulberry32(seed)),
    });
  };
  /** Rien ne pousse ni ne se construit dans l'eau. */
  const wet = (x: number, y: number, r: number) => (def.river && riverDist(def, x, y) < def.river.width / 2 + r + 22) || pondDist(def, x, y, r) < 1;
  const trees = (x: number, y: number, n: number, spread: number) => {
    for (let k = 0; k < n; k++) {
      const tx = x + (rnd() - 0.5) * spread, ty = y + (rnd() - 0.5) * spread;
      const r = 9 + rnd() * 7;
      if (dist(tx, ty) < WALL_DIST + r + 16 || wet(tx, ty, r)) continue;
      addTree(tx, ty, r);
    }
  };

  if (def.theme === 'city') {
    // Ville : îlots entre les rues, découpés en 1 grand ou 4 petits immeubles ; le parc a ses arbres.
    for (let by = -BLOCK * 4; by < def.height + BLOCK * 4; by += BLOCK) {
      for (let bx = -BLOCK * 4; bx < def.width + BLOCK * 4; bx += BLOCK) {
        const cx = bx + BLOCK / 2, cy = by + BLOCK / 2;
        const inner = BLOCK - STREET;
        const lots: [number, number, number][] =
          rnd() < 0.35
            ? [[cx, cy, inner - 30]]
            : [-1, 1].flatMap((i) => [-1, 1].map((j) => [cx + (i * inner) / 4, cy + (j * inner) / 4, inner / 2 - 22] as [number, number, number]));
        for (const [x, y, size] of lots) {
          if (!inCanvas(x, y)) continue;
          const d = dist(x, y);
          const parkHere = def.park && inPoly(def.park, x, y);
          if (parkHere) {
            if (d > WALL_DIST + 30) trees(x, y, 2 + Math.floor(rnd() * 2), size + 20);
            continue;
          }
          const w = size * (0.8 + rnd() * 0.2), dd = size * (0.8 + rnd() * 0.2);
          if (d < WALL_DIST + 30 + Math.hypot(w, dd) / 2 || wet(x, y, Math.hypot(w, dd) / 2)) {
            if (d > WALL_DIST + 40 && !wet(x, y, 10) && rnd() < 0.5) trees(x, y, 1, 30);
            continue;
          }
          const far = Math.min(1, (d - WALL_DIST - 100) / 700);
          const h = 22 + Math.round(rnd() * rnd() * (70 + far * 210));
          addBuilding(x, y, w, dd, h, false);
        }
      }
    }
    return out;
  }

  // Campagne : grille de cases, arbres près de la piste, ville plus loin.
  const cell = 96;
  for (let gy = -900; gy < def.height + 900; gy += cell) {
    for (let gx = -900; gx < def.width + 900; gx += cell) {
      const x = gx + (rnd() - 0.5) * cell * 0.3, y = gy + (rnd() - 0.5) * cell * 0.3;
      const roll = rnd();
      if (!inCanvas(x, y)) continue;
      const d = dist(x, y);
      const inside = x > 0 && y > 0 && x < def.width && y < def.height;
      if (d > WALL_DIST + 190 && roll < (inside ? 0.45 : 0.85)) {
        const w = 44 + rnd() * 40, dd = 44 + rnd() * 40;
        if (d < WALL_DIST + 40 + Math.hypot(w, dd) / 2 || wet(x, y, Math.hypot(w, dd) / 2)) continue;
        const far = Math.min(1, (d - WALL_DIST - 190) / 500);
        addBuilding(x, y, w, dd, 18 + Math.round(rnd() * rnd() * (40 + far * 150)), true);
      } else if (d > WALL_DIST + 34 && roll < 0.95) {
        trees(x, y, 1 + Math.floor(rnd() * 3), 50);
      }
    }
  }
  return out;
}

/** Points écran (sol) où une voiture peut se trouver, avec leur profondeur. */
function carSpots(t: Track, ox: number, oy: number): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < t.n; i += 2) {
    const z = zAt(t, i);
    for (const lat of [-WALL_DIST, 0, WALL_DIST]) {
      const [x, y] = pointAt(t, i, lat);
      out.push(isoX(x, y) + ox, isoY(x, y, z) + oy, x + y);
    }
  }
  return Float64Array.from(out);
}

/** Une voiture (n'importe où sur la piste) pourrait-elle se trouver derrière ce décor ? */
function canHideCar(spots: Float64Array, d: Deco): boolean {
  const [x0, y0, x1, y1] = d.bb;
  const m = 26;
  for (let k = 0; k < spots.length; k += 3) {
    const sx = spots[k], sy = spots[k + 1];
    if (spots[k + 2] < d.depth && sx > x0 - m && sx < x1 + m && sy > y0 - m && sy - 20 < y1 + m) return true;
  }
  return false;
}

// ---------- Pont ----------
function renderBridge(t: Track): (Sprite & { key: number }) | null {
  const e = elevatedRange(t);
  if (!e || !t.def.bridge) return null;
  const [from, to] = e;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = from; i <= to; i++) {
    const k = wrapIdx(t, i);
    for (const lat of [-WALL_DIST - 10, WALL_DIST + 10]) {
      const [x, y] = pointAt(t, k, lat);
      const sx = isoX(x, y), sy = isoY(x, y, zAt(t, k) + 10);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, isoY(x, y));
    }
  }
  const ox = -Math.floor(minX) + 4, oy = -Math.floor(minY) + 4;
  const c = document.createElement('canvas');
  c.width = Math.ceil(maxX - minX) + 8;
  c.height = Math.ceil(maxY - minY) + 8;
  const g = c.getContext('2d')!;
  const at = (i: number, lat: number, dz = 0): Pt => {
    const k = wrapIdx(t, i);
    const [x, y] = pointAt(t, k, lat);
    return P(ox, oy, x, y, zAt(t, k) + dz);
  };
  const ribbon = (l1: number, l2: number, fill: string | CanvasPattern, dz = 0) => {
    g.beginPath();
    for (let i = from; i <= to; i++) {
      const [x, y] = at(i, l1, dz);
      if (i === from) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    for (let i = to; i >= from; i--) g.lineTo(...at(i, l2, dz));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const line = (lat: number, dz = 0) => {
    g.beginPath();
    for (let i = from; i <= to; i++) {
      const [x, y] = at(i, lat, dz);
      if (i === from) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  };
  // Piliers.
  for (let i = from + 6; i <= to - 6; i += 12) {
    const k = wrapIdx(t, i);
    const z = zAt(t, k);
    if (z < 14) continue;
    const a = Math.atan2(t.tys[k], t.txs[k]);
    for (const lat of [-WALL_DIST + 18, WALL_DIST - 18]) {
      const [x, y] = pointAt(t, k, lat);
      box(g, ox, oy, x, y, a, 12, 12, 0, z - 6, '#9a9fae');
    }
  }
  // Flancs du tablier (épaisseur 6), seulement ceux tournés vers nous.
  for (const side of [-1, 1]) {
    for (let i = from; i < to; i++) {
      const k = wrapIdx(t, i);
      const nx = -t.tys[k] * side, ny = t.txs[k] * side;
      if (nx + ny <= 0) continue;
      const lat = side * WALL_DIST;
      poly(g, [at(i, lat), at(i + 1, lat), at(i + 1, lat, -6), at(i, lat, -6)], nx > ny ? '#666b7a' : '#7d8293');
    }
  }
  ribbon(-WALL_DIST, WALL_DIST, '#8e93a3');
  ribbon(-ROAD_WIDTH / 2 - KERB_WIDTH, ROAD_WIDTH / 2 + KERB_WIDTH, '#f2f2f2');
  g.lineWidth = KERB_WIDTH * ISO * 1.2;
  g.strokeStyle = '#d8262e';
  g.setLineDash([9, 9]);
  for (const side of [-1, 1]) {
    line(side * (ROAD_WIDTH / 2 + KERB_WIDTH / 2));
    g.stroke();
  }
  g.setLineDash([]);
  ribbon(-ROAD_WIDTH / 2, ROAD_WIDTH / 2, asphaltPattern(g));
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(240, 240, 240, 0.6)';
  g.setLineDash([10, 14]);
  for (const side of [-1, 0, 1]) {
    line((side * ROAD_WIDTH) / 4);
    g.stroke();
  }
  g.setLineDash([]);
  // Garde-corps en béton.
  for (const side of [-1, 1]) {
    for (let i = from; i < to; i++) {
      const lat = side * WALL_DIST;
      poly(g, [at(i, lat), at(i + 1, lat), at(i + 1, lat, 7), at(i, lat, 7)], '#b4b8c4');
    }
    g.lineWidth = 1;
    g.strokeStyle = '#d9dce4';
    line(side * WALL_DIST, 7);
    g.stroke();
  }
  const [bx, by] = t.def.bridge;
  return { canvas: c, x: -ox, y: -oy, depth: bx + by, key: bx + by };
}

// ---------- Ville, parc et rivière ----------
/** Portions de piste (échantillons de/à) qui franchissent la rivière. */
function riverSpans(t: Track): [number, number][] {
  const def = t.def;
  if (!def.river) return [];
  const lim = def.river.width / 2 + 34;
  const wet: boolean[] = [];
  for (let i = 0; i < t.n; i++) wet.push(riverDist(def, t.xs[i], t.ys[i]) < lim + WALL_DIST * 0.6);
  const spans: [number, number][] = [];
  for (let i = 0; i < t.n; i++) {
    if (!wet[i] || wet[(i - 1 + t.n) % t.n]) continue;
    let j = i;
    while (wet[(j + 1) % t.n] && j - i < t.n) j++;
    spans.push([i - 3, j + 3]);
  }
  return spans;
}

/** Rues de la ville : chaussées entre les îlots, avec lignes médianes. */
function cityGround(ctx: CanvasRenderingContext2D, t: Track, rnd: () => number): void {
  const def = t.def;
  const x0 = -BLOCK * 4, x1 = def.width + BLOCK * 4, y0 = -BLOCK * 4, y1 = def.height + BLOCK * 4;
  ctx.fillStyle = '#4b4c54';
  for (let y = y0; y <= y1; y += BLOCK) ctx.fillRect(x0, y - STREET / 2, x1 - x0, STREET);
  for (let x = x0; x <= x1; x += BLOCK) ctx.fillRect(x - STREET / 2, y0, STREET, y1 - y0);
  ctx.strokeStyle = 'rgba(240, 220, 120, 0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  for (let y = y0; y <= y1; y += BLOCK) (ctx.moveTo(x0, y), ctx.lineTo(x1, y));
  for (let x = x0; x <= x1; x += BLOCK) (ctx.moveTo(x, y0), ctx.lineTo(x, y1));
  ctx.stroke();
  ctx.setLineDash([]);
  // Passages piétons aux carrefours.
  ctx.fillStyle = 'rgba(240, 240, 240, 0.75)';
  for (let y = y0; y <= y1; y += BLOCK) {
    for (let x = x0; x <= x1; x += BLOCK) {
      if (rnd() < 0.5) continue;
      for (let k = -STREET / 2 + 4; k < STREET / 2 - 4; k += 8) {
        ctx.fillRect(x + STREET / 2 + 4, y + k, 12, 4);
        ctx.fillRect(x + k, y + STREET / 2 + 4, 4, 12);
      }
    }
  }
}

/** Parc (pelouse, allées, massifs de fleurs, étang) et rivière avec ses quais. */
function waterAndPark(ctx: CanvasRenderingContext2D, t: Track, rnd: () => number): void {
  const def = t.def;
  if (def.park) {
    const path = () => {
      ctx.beginPath();
      def.park!.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    path();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#a7a7ad';
    ctx.stroke();
    ctx.fillStyle = def.grass;
    ctx.fill();
    ctx.save();
    path();
    ctx.clip();
    for (let k = 0; k < 2600; k++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
      ctx.fillRect(-200 + rnd() * (def.width + 400), -200 + rnd() * (def.height + 400), 3, 3);
    }
    // Allées en terre battue.
    ctx.strokeStyle = '#cdb98a';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    if (def.pond) {
      const [cx, cy, rx, ry] = def.pond;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 46, ry + 40, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const ring = def.park;
    for (let k = 0; k < 3; k++) {
      const a = ring[Math.floor(rnd() * ring.length)], b = def.pond ? [def.pond[0], def.pond[1]] : ring[Math.floor(rnd() * ring.length)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo((a[0] + b[0]) / 2 + (rnd() - 0.5) * 300, (a[1] + b[1]) / 2 + (rnd() - 0.5) * 300, b[0], b[1]);
      ctx.stroke();
    }
    // Massifs de fleurs.
    const flowers = ['#f2c230', '#e34b4b', '#f2f2f2', '#c06bd8', '#ff8fb1'];
    for (let k = 0; k < 40; k++) {
      const x = rnd() * def.width, y = rnd() * def.height;
      const col = flowers[Math.floor(rnd() * flowers.length)];
      ctx.fillStyle = '#2f6e2c';
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      for (let f = 0; f < 14; f++) ctx.fillRect(x + (rnd() - 0.5) * 34, y + (rnd() - 0.5) * 20, 3, 3);
    }
    ctx.restore();
  }
  const water = (draw: (extra: number) => void) => {
    ctx.strokeStyle = ctx.fillStyle = '#9c968a';
    draw(16);
    ctx.strokeStyle = ctx.fillStyle = '#6f6a60';
    draw(6);
    ctx.strokeStyle = ctx.fillStyle = '#2f6fb3';
    draw(0);
  };
  if (def.pond) {
    const [cx, cy, rx, ry] = def.pond;
    water((e) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + e, ry + e, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.8;
      ctx.fillRect(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, 8, 2);
    }
  }
  if (def.river) {
    const line = riverLine(def);
    const w = def.river.width;
    water((e) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = w + e * 2;
      ctx.beginPath();
      line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    });
    // Reflets.
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let k = 0; k < line.length - 1; k++) {
      const [x, y] = line[k], [x2, y2] = line[k + 1];
      const l = Math.hypot(x2 - x, y2 - y) || 1;
      for (let m = 0; m < 3; m++) {
        const off = (rnd() - 0.5) * w * 0.8, u = rnd();
        const px = x + (x2 - x) * u - ((y2 - y) / l) * off, py = y + (y2 - y) * u + ((x2 - x) / l) * off;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(y2 - y, x2 - x));
        ctx.fillRect(0, 0, 10 + rnd() * 10, 2);
        ctx.restore();
      }
    }
  }
}

// ---------- Image du sol ----------
export function renderIsoTrack(t: Track): IsoArt {
  const def = t.def;
  const ox = def.height * ISO + PAD, oy = PAD;
  const gw = Math.ceil((def.width + def.height) * ISO + PAD * 2);
  const gh = Math.ceil((def.width + def.height) * (ISO / 2) + PAD * 2);
  const c = document.createElement('canvas');
  c.width = gw;
  c.height = gh;
  const ctx = c.getContext('2d')!;

  const city = def.theme === 'city';
  // Herbe (ou trottoirs en ville) : grain pixel en espace écran.
  const img = ctx.createImageData(gw, gh);
  const [gr, gg, gb] = hex(city ? '#8d8d94' : def.grass);
  const px = new Uint32Array(img.data.buffer);
  const tone = (n: number) => (255 << 24) | ((gb + n * 0.5) << 16) | ((gg + n) << 8) | (gr + n);
  const base = tone(0), hi = tone(12), lo = tone(-12);
  for (let y = 0, o = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++, o++) {
      const h = (Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0) & 15;
      px[o] = h === 0 ? hi : h === 1 ? lo : base;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.setTransform(...groundMatrix(ox, oy));
  const rnd = mulberry32(def.seed * 7 + 3);
  if (city) cityGround(ctx, t, rnd);
  else {
    // Bandes de tonte.
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = -1000; y < def.height + 1000; y += 96) ctx.fillRect(-1000, y, def.width + 2000, 48);
  }
  waterAndPark(ctx, t, rnd);
  // Bas-côté plus sombre (zone lente entre la piste et le mur).
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = city ? 'rgba(20, 20, 30, 0.16)' : 'rgba(30, 60, 20, 0.22)';
  ctx.lineWidth = WALL_DIST * 2;
  segPath(ctx, t, 0, t.n);
  ctx.stroke();
  // Ponts sur la rivière : tablier en béton sous la chaussée.
  const spans = riverSpans(t);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#a9a9b1';
  ctx.lineWidth = WALL_DIST * 2 + 12;
  for (const [a, b] of spans) {
    segPath(ctx, t, a, b);
    ctx.stroke();
  }

  roadOnGround(ctx, t);

  // Épaisseur des tablier des ponts au-dessus de l'eau.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const [a, b] of spans) {
    for (const side of [-1, 1]) {
      for (let i = a; i < b; i++) {
        const k = wrapIdx(t, i);
        const nx = -t.tys[k] * side, ny = t.txs[k] * side;
        if (nx + ny <= 0) continue;
        const lat = side * (WALL_DIST + 6);
        const [x1, y1] = pointAt(t, k, lat), [x2, y2] = pointAt(t, wrapIdx(t, i + 1), lat);
        poly(ctx, [P(ox, oy, x1, y1, 0), P(ox, oy, x2, y2, 0), P(ox, oy, x2, y2, -9), P(ox, oy, x1, y1, -9)], nx > ny ? '#5e5e68' : '#74747e');
      }
    }
  }
  ctx.setTransform(...groundMatrix(ox, oy));

  // Ombre du pont sur le sol (la lumière vient de la gauche), pour sentir la hauteur.
  const el = elevatedRange(t);
  if (el) {
    const sh = (i: number, lat: number): Pt => {
      const k = wrapIdx(t, i);
      const z = zAt(t, k);
      const [x, y] = pointAt(t, k, lat);
      return [x + z * 0.8, y - z * 0.2];
    };
    ctx.beginPath();
    for (let i = el[0]; i <= el[1]; i++) ctx.lineTo(...sh(i, -WALL_DIST));
    for (let i = el[1]; i >= el[0]; i--) ctx.lineTo(...sh(i, WALL_DIST));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fill();
  }

  // Stands : bande hachurée jaune sur le bas-côté droit avant la ligne.
  {
    const mid = (PIT.minLat + PIT.maxLat) / 2;
    ctx.lineCap = 'butt';
    ctx.lineWidth = PIT.maxLat - PIT.minLat - 6;
    ctx.strokeStyle = '#5b5e68';
    segPath(ctx, t, t.n + PIT.from, t.n + PIT.to, mid);
    ctx.stroke();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255, 204, 51, 0.55)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffcc33';
    for (const off of [PIT.minLat + 3, PIT.maxLat - 3]) {
      segPath(ctx, t, t.n + PIT.from, t.n + PIT.to, off);
      ctx.stroke();
    }
    const k = wrapIdx(t, t.n + Math.round((PIT.from + PIT.to) / 2));
    const [px, py] = pointAt(t, k, mid);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(t.tys[k], t.txs[k]));
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111';
    ctx.fillText('STANDS', 1, 1);
    ctx.fillStyle = '#ffcc33';
    ctx.fillText('STANDS', 0, 0);
    ctx.restore();
  }

  // Damier de la ligne d'arrivée et cases de la grille.
  const ang = Math.atan2(t.tys[0], t.txs[0]);
  ctx.save();
  ctx.translate(t.xs[0], t.ys[0]);
  ctx.rotate(ang);
  const sq = 7;
  for (let i = 0; i < 2; i++) {
    for (let j = -ROAD_WIDTH / 2; j < ROAD_WIDTH / 2; j += sq) {
      ctx.fillStyle = (i + Math.round(j / sq)) % 2 ? '#111' : '#fafafa';
      ctx.fillRect(-sq + i * sq, j, sq, Math.min(sq, ROAD_WIDTH / 2 - j));
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  for (let slot = 0; slot < 8; slot++) {
    const p = gridPose(t, slot);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.beginPath();
    ctx.moveTo(30, -15);
    ctx.lineTo(34, -15);
    ctx.lineTo(34, 15);
    ctx.lineTo(30, 15);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Murs de pneus et décor cuit dans le sol, triés par profondeur.
  const flat: { depth: number; draw: () => void }[] = [];
  const tyreColors = city ? ['#dcdce2', '#dcdce2', '#c0392b', '#dcdce2'] : ['#ececec', '#d8262e', '#ececec', '#26262b'];
  const onSpan = (i: number) => spans.some(([a, b]) => wrapIdx(t, i - a) <= b - a);
  for (const side of [-1, 1]) {
    let k = 0;
    let last: Pt | null = null;
    let lastRail: Pt | null = null;
    for (let i = 0; i < t.n; i++) {
      if (zAt(t, i) > 0) continue;
      if (onSpan(i)) {
        // Garde-corps du pont : poteaux et lisse.
        const p = pointAt(t, i, side * (WALL_DIST + 3));
        if (lastRail && Math.hypot(p[0] - lastRail[0], p[1] - lastRail[1]) < 12) continue;
        const prev = lastRail;
        lastRail = p;
        const [sx, sy] = P(ox, oy, p[0], p[1], 0);
        const q = prev ? P(ox, oy, prev[0], prev[1], 0) : null;
        flat.push({
          depth: p[0] + p[1],
          draw: () => {
            ctx.fillStyle = '#3d4a66';
            ctx.fillRect(Math.round(sx), Math.round(sy) - 7, 2, 7);
            if (q) {
              ctx.strokeStyle = '#e8ecf4';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(q[0], q[1] - 7);
              ctx.lineTo(sx, sy - 7);
              ctx.stroke();
            }
          },
        });
        continue;
      }
      lastRail = null;
      const p = pointAt(t, i, side * (WALL_DIST + 3));
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 9) continue;
      last = p;
      const col = tyreColors[k++ % 4];
      const sx = isoX(p[0], p[1]) + ox, sy = isoY(p[0], p[1]) + oy;
      flat.push({ depth: p[0] + p[1], draw: () => tyreStack(ctx, sx, sy, col) });
    }
  }
  const sprites: Sprite[] = [];
  const spots = carSpots(t, ox, oy);
  for (const dec of decorations(t, ox, oy, gw, gh)) {
    if (!canHideCar(spots, dec)) {
      flat.push({ depth: dec.depth, draw: () => dec.draw(ctx, ox, oy) });
      continue;
    }
    const [x0, y0, x1, y1] = dec.bb;
    const sc = document.createElement('canvas');
    sc.width = Math.max(1, Math.ceil(x1 - x0) + 8);
    sc.height = Math.max(1, Math.ceil(y1 - y0) + 8);
    dec.draw(sc.getContext('2d')!, ox - x0 + 4, oy - y0 + 4);
    sprites.push({ canvas: sc, x: x0 - 4, y: y0 - 4, depth: dec.depth });
  }
  flat.sort((p, q) => p.depth - q.depth);
  for (const f of flat) f.draw();
  sprites.sort((p, q) => p.depth - q.depth);

  const bridge = renderBridge(t);
  if (bridge) {
    bridge.x += ox;
    bridge.y += oy;
  }
  return { ground: c, ox, oy, sprites, bridge };
}

