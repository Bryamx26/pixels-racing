import { mulberry32 } from '../math';
import type { Area, Block, BlockKind, Board, Challenge, Layout, Prop, Pt, Road, RoadKind, Spawn, Surf, Tree, TreeKind } from './world';

/**
 * Plan du monde ouvert (20 000 × 20 000) :
 *
 *   ┌──────────────────────────── autoroute périphérique ───────────────────────────┐
 *   │  AÉRODROME (piste, hangars,            │  PIXEL CITY (rues en damier, tours,   │
 *   │  tour de contrôle)       FESTIVAL ─────┼─ parc central)                        │
 *   │──────────── autoroute transversale ────┼──────────────────────────────────────│
 *   │  GRAND PARC (lac, pont, chemins)       │  DOCKS (arène de drift, conteneurs)   │
 *   │  COLLINES (route de montagne en lacets)│  CAMPAGNE (champs)  ·  PORT-JOLI      │
 *   └──────────────────────────────────── plage ─────────────────────────── mer ────┘
 */

const STEP = 16;
const W = { highway: 168, road: 112, street: 112, dirt: 88, runway: 300, taxi: 120, bridge: 104 } satisfies Record<RoadKind, number>;

// ---------- Tracés ----------
/** Rééchantillonne une polyligne à pas constant. */
function resample(pts: Pt[], closed: boolean): Pt[] {
  const src = closed ? [...pts, pts[0]] : pts;
  const out: Pt[] = [src[0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const [ax, ay] = src[i - 1], [bx, by] = src[i];
    const len = Math.hypot(bx - ax, by - ay);
    let d = STEP - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
      d += STEP;
    }
    carry = len - (d - STEP);
  }
  if (closed) out.pop();
  else {
    const last = src[src.length - 1], o = out[out.length - 1];
    if (Math.hypot(last[0] - o[0], last[1] - o[1]) > 2) out.push(last);
  }
  return out;
}

/** Spline de Catmull-Rom centripète passant par les points de contrôle. */
function spline(ctrl: Pt[], closed: boolean): Pt[] {
  const n = ctrl.length;
  const P = closed
    ? ctrl
    : [[2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]] as Pt, ...ctrl, [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]] as Pt];
  const m = P.length;
  const at = (i: number) => P[((i % m) + m) % m];
  const fine: Pt[] = [];
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const i = closed ? s : s + 1;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const tj = (t: number, a: Pt, b: Pt) => t + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-3, 0.5);
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    const per = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 40));
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const mix = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
        const u = (tb - t) / (tb - ta), v = (t - ta) / (tb - ta);
        return [a[0] * u + b[0] * v, a[1] * u + b[1] * v];
      };
      const a1 = mix(p0, p1, t0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
      fine.push(mix(mix(a1, a2, t0, t2), mix(a2, a3, t1, t3), t1, t2));
    }
  }
  if (!closed) fine.push(ctrl[n - 1]);
  return resample(fine, closed);
}

function rect(x1: number, y1: number, x2: number, y2: number): Pt[] {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 64, wobble = 0, seed = 1): Pt[] {
  const rnd = mulberry32(seed);
  const ph = [rnd() * 6, rnd() * 6];
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wobble * (Math.sin(a * 3 + ph[0]) * 0.6 + Math.sin(a * 5 + ph[1]) * 0.4);
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as Pt;
  });
}

/** Rectangle aux coins arrondis (polyligne fermée). */
function roundRect(x1: number, y1: number, x2: number, y2: number, r: number): Pt[] {
  const out: Pt[] = [];
  const corners: [number, number, number][] = [
    [x2 - r, y1 + r, -Math.PI / 2],
    [x2 - r, y2 - r, 0],
    [x1 + r, y2 - r, Math.PI / 2],
    [x1 + r, y1 + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 8; k++) {
    const a = a0 + (k / 8) * (Math.PI / 2);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

const pathLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Sous-tracé d'une route entre deux fractions de sa longueur. */
const slice = (r: Road, from: number, to: number): Pt[] => r.pts.slice(Math.round(r.pts.length * from), Math.round(r.pts.length * to) + 1);

// ---------- Couleurs ----------
const FACADES = ['#c9a865', '#b5523b', '#d9d6cf', '#3fa3a8', '#d9b44a', '#7fb3d5', '#a8a6b8', '#c27c4e', '#e0c9a6', '#8fa66b'];
const GLASS = ['#5f8fb8', '#4a7090', '#8fb0c8', '#6a7f9a', '#3f6f8f', '#7a9cb0'];
const ROOFS = ['#7d7d85', '#55565e', '#9a9aa2', '#c0583a', '#6b6f78'];
const HOUSE_ROOFS = ['#b5452f', '#8c3a2a', '#5a4a42', '#c0583a', '#3f5f7a'];
const HOUSES = ['#f2e6c9', '#e9d1b0', '#f4f1ea', '#cfe0e8', '#f0d5d0', '#e2ead0'];
const CONTAINERS = ['#c0392b', '#2e86c1', '#d68910', '#27ae60', '#7d3c98', '#839192', '#1f618d', '#b9770e'];
const TENTS = ['#e34b4b', '#3f8ef0', '#f2c230', '#f2f2f2', '#5ad06a', '#ff7a1a'];

export function buildLayout(surfAt: (x: number, y: number) => Surf, rasterize: (l: Pick<Layout, 'areas' | 'roads'>) => void): Layout {
  const rnd = mulberry32(2026);
  const roads: Road[] = [];
  const areas: Area[] = [];
  const blocks: Block[] = [];
  const trees: Tree[] = [];
  const props: Prop[] = [];
  let seed = 1;

  const road = (kind: RoadKind, pts: Pt[], closed = false, smooth = true, name?: string): Road => {
    const r: Road = { kind, w: W[kind], pts: smooth && pts.length > 2 ? spline(pts, closed) : resample(pts, closed), closed, name };
    roads.push(r);
    return r;
  };
  const area = (kind: Area['kind'], poly: Pt[], v?: number) => areas.push({ kind, poly, v });
  const block = (kind: BlockKind, x1: number, y1: number, x2: number, y2: number, h: number, color: string, roof?: string) =>
    blocks.push({ kind, x1, y1, x2, y2, h, color, roof, seed: seed++ });
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  // ================= Autoroutes =================
  const ring = road(
    'highway',
    [
      [1600, 900], [10200, 800], [18300, 900], [19000, 1600], [19050, 4500], [18950, 8600], [19000, 13000], [18950, 17100],
      [18300, 17750], [14000, 17950], [10200, 17900], [5000, 17950], [1600, 17800], [900, 17200], [750, 13000], [850, 8600],
      [750, 4500], [900, 1600],
    ],
    true,
    true,
    'Périphérique',
  );
  road('highway', [[10200, 800], [10200, 17900]], false, false, 'Transversale Nord-Sud');
  road('highway', [[850, 8600], [5000, 8300], [10200, 8300], [15000, 8300], [18950, 8600]], false, true, 'Transversale Est-Ouest');
  const ringY = (x: number, top: boolean) => {
    // y du périphérique au nord (top) ou au sud pour une abscisse donnée.
    let best = 0, bd = Infinity;
    for (const [px, py] of ring.pts) if ((top ? py < 5000 : py > 15000) && Math.abs(px - x) < bd) {
      bd = Math.abs(px - x);
      best = py;
    }
    return best;
  };
  const ringX = (y: number, east: boolean) => {
    let best = 0, bd = Infinity;
    for (const [px, py] of ring.pts) if ((east ? px > 15000 : px < 5000) && Math.abs(py - y) < bd) {
      bd = Math.abs(py - y);
      best = px;
    }
    return best;
  };

  // ================= Pixel City =================
  const XS = [10200, ...Array.from({ length: 11 }, (_, i) => 11000 + 720 * i), 19000];
  const YS = [800, ...Array.from({ length: 11 }, (_, j) => 1400 + 620 * j), 8300];
  for (let i = 1; i < XS.length - 1; i++) road('street', [[XS[i], ringY(XS[i], true)], [XS[i], 8300]], false, false);
  for (let j = 1; j < YS.length - 1; j++) road('street', [[10200, YS[j]], [ringX(YS[j], true), YS[j]]], false, false);
  const CX = 14600, CY = 4500;
  for (let c = 0; c < XS.length - 1; c++) {
    for (let r = 0; r < YS.length - 1; r++) {
      const hw = (k: number, n: number) => (k === 0 || k === n - 1 ? W.highway / 2 + (k === 0 && n === YS.length ? 40 : 0) : W.street / 2);
      const sx1 = XS[c] + hw(c, XS.length), sx2 = XS[c + 1] - hw(c + 1, XS.length);
      const sy1 = YS[r] + hw(r, YS.length) + (r === 0 ? 60 : 0), sy2 = YS[r + 1] - hw(r + 1, YS.length);
      area('plaza', rect(sx1, sy1, sx2, sy2));
      const x1 = sx1 + 22, y1 = sy1 + 22, x2 = sx2 - 22, y2 = sy2 - 22;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const dist = Math.hypot(mx - CX, my - CY);
      // Lampadaires sur le trottoir.
      for (let x = sx1 + 60; x < sx2 - 40; x += 240) props.push({ kind: 'lamp', x, y: sy1 + 8 }, { kind: 'lamp', x, y: sy2 - 8 });
      if ((c === 7 || c === 8) && (r === 7 || r === 8)) {
        // Parc central.
        area('park', rect(x1, y1, x2, y2));
        for (let k = 0; k < 14; k++) trees.push({ kind: 'tree', x: x1 + 40 + rnd() * (x2 - x1 - 80), y: y1 + 40 + rnd() * (y2 - y1 - 80), r: 16 + rnd() * 8 });
        continue;
      }
      if (c === 5 && r === 5) {
        // Place de l'hôtel de ville et sa fontaine.
        block('fountain', mx - 50, my - 50, mx + 50, my + 50, 12, '#9fb7c9');
        block('building', x1, y1, x2, y1 + 140, 70, '#e0c9a6', '#8c3a2a');
        continue;
      }
      if (rnd() < 0.08 && dist > 1200) {
        area('lot', rect(x1, y1, x2, y2), 1);
        continue;
      }
      if (dist < 1700) {
        // Centre : une ou deux tours vitrées.
        if (rnd() < 0.5) block('tower', x1 + 30, y1 + 30, x2 - 30, y2 - 30, 140 + rnd() * 90, pick(GLASS), pick(ROOFS));
        else {
          block('tower', x1, y1, mx - 15, y2, 120 + rnd() * 90, pick(GLASS), pick(ROOFS));
          block('tower', mx + 15, y1, x2, y2, 100 + rnd() * 90, pick(GLASS), pick(ROOFS));
        }
        continue;
      }
      const tall = dist < 3200;
      const cols = tall ? 2 : rnd() < 0.5 ? 2 : 3, rows = 2;
      const gap = tall ? 16 : 34;
      const bw = (x2 - x1 - gap * (cols - 1)) / cols, bh = (y2 - y1 - gap * (rows - 1)) / rows;
      for (let u = 0; u < cols; u++) for (let v = 0; v < rows; v++) {
        if (!tall && rnd() < 0.15) {
          trees.push({ kind: 'tree', x: x1 + u * (bw + gap) + bw / 2, y: y1 + v * (bh + gap) + bh / 2, r: 18 });
          continue;
        }
        const bx = x1 + u * (bw + gap), by = y1 + v * (bh + gap);
        const shrink = tall ? 0 : rnd() * 30;
        block('building', bx + shrink, by + shrink, bx + bw - shrink, by + bh, tall ? 60 + rnd() * 70 : 28 + rnd() * 34, pick(FACADES), pick(ROOFS));
      }
    }
  }
  // Passages piétons aux carrefours.
  for (let i = 1; i < XS.length - 1; i++) for (let j = 1; j < YS.length - 1; j++) props.push({ kind: 'crosswalk', x: XS[i], y: YS[j] });

  // ================= Aérodrome =================
  const runway = road('runway', [[1800, 3000], [8800, 3000]], false, false, "Piste d'envol");
  road('taxi', [[2200, 3720], [8400, 3720]], false, false);
  for (const x of [2200, 4400, 6400, 8400]) road('taxi', [[x, 3000], [x, 3720]], false, false);
  area('apron', rect(3000, 3780, 7600, 5000));
  road('road', [[10200, 4800], [7500, 4800]], false, false, "Route de l'aérodrome");
  for (const [i, x] of [3600, 4700, 5800, 6900].entries()) block('hangar', x - 400, 5040, x + 400, 5600, 80, i % 2 ? '#a9b3bd' : '#b9c0b0', '#7f8c99');
  block('terminal', 7700, 3820, 9000, 4380, 46, '#d9d6cf', '#9aa4ae');
  area('lot', rect(7700, 4440, 9300, 4720), 1);
  block('control', 9300, 3880, 9460, 4040, 150, '#e8e4dc', '#4a7090');
  for (const x of [4200, 5300, 6400]) block('plane', x - 150, 4290, x + 150, 4340, 26, '#f4f4f4', '#3f8ef0');
  props.push({ kind: 'helipad', x: 7300, y: 4700 });

  // ================= Festival =================
  area('festival', rect(8700, 7300, 10080, 8180));
  for (let k = 0; k < 6; k++) block('tent', 8780 + k * 210, 7360, 8780 + k * 210 + 150, 7500, 44, TENTS[k], shadeHex(TENTS[k]));
  for (let k = 0; k < 9; k++) props.push({ kind: 'flag', x: 8760 + k * 150, y: 8120, v: k });

  // ================= Grand Parc =================
  area('park', roundRect(1300, 9100, 9600, 13050, 300));
  area('water', ellipse(5200, 11050, 1500, 850, 72, 0.06, 4));
  road('road', roundRect(1500, 9300, 9400, 12800, 420), true, false, 'Allée du Parc');
  road('road', [[5000, 8300], [5000, 9300]], false, false);
  road('road', [[ringX(11000, false), 11000], [1500, 11000]], false, false);
  road('road', [[9400, 11000], [10200, 11000]], false, false);
  const lakeLoop = road('dirt', ellipse(5200, 11050, 1900, 1250, 72), true, true, 'Chemin du Lac');
  road('dirt', [[5200, 9300], [5200, 9800]], false, false);
  road('dirt', [[5200, 12300], [5200, 12800]], false, false);
  road('dirt', [[1500, 11050], [3300, 11050]], false, false);
  road('dirt', [[7100, 11050], [9400, 11050]], false, false);
  road('bridge', [[5200, 9800], [5200, 12300]], false, false, 'Pont du Lac');
  area('plaza', ellipse(8300, 10150, 260, 260, 32));
  block('fountain', 8240, 10090, 8360, 10210, 14, '#9fb7c9');

  // ================= Collines =================
  area('forest', rect(1300, 13300, 9700, 17400));
  const touge = road(
    'road',
    [
      [10200, 13650], [9100, 13700], [8300, 13950], [7950, 14500], [8550, 15000], [8100, 15550], [7000, 15350],
      [6300, 14650], [5400, 14300], [4550, 14800], [5150, 15400], [4650, 16050], [3650, 15850], [3000, 15150],
      [2200, 14600], [1500, 15200], [1850, 16000], [1350, 16750], [ringX(17000, false), 17000],
    ],
    false,
    true,
    'Route des Collines',
  );

  // ================= Docks =================
  road('road', [[10200, 9200], [ringX(9200, true), 9200]], false, false, 'Quai Nord');
  road('road', [[10200, 13400], [ringX(13400, true), 13400]], false, false, 'Quai Sud');
  road('road', [[12200, 8300], [12200, 13400]], false, false);
  road('road', [[16500, 8300], [16500, 13400]], false, false);
  area('lot', rect(10290, 9262, 12140, 13340), 0);
  area('lot', rect(12262, 9262, 16440, 13340), 2);
  area('lot', rect(16560, 9262, 18860, 13340), 0);
  block('warehouse', 10420, 9420, 12020, 10560, 72, '#8a8f99', '#6b6f78');
  block('warehouse', 10420, 10860, 12020, 11960, 60, '#a7684a', '#7d7d85');
  block('warehouse', 10420, 12260, 12020, 13200, 72, '#6f7f8f', '#55565e');
  for (let y = 9460; y < 13150; y += 300) {
    let x = 16680 + rnd() * 120;
    while (x < 18600) {
      const n = 2 + Math.floor(rnd() * 3);
      const len = Math.min(n * 240, 18680 - x);
      if (len > 200) block('container', x, y, x + len, y + 72, rnd() < 0.4 ? 92 : 46, pick(CONTAINERS));
      x += len + 180 + rnd() * 120;
    }
  }
  // Arène : cônes en slalom et en cercles, marques de donuts.
  for (let k = 0; k < 10; k++) props.push({ kind: 'cone', x: 12700 + k * 220, y: 9700 });
  for (const [cx, cy, r] of [[13600, 11300, 380], [15300, 11300, 380], [14450, 12500, 300]]) {
    for (let k = 0; k < 14; k++) props.push({ kind: 'cone', x: cx + Math.cos((k / 14) * Math.PI * 2) * r, y: cy + Math.sin((k / 14) * Math.PI * 2) * r });
    props.push({ kind: 'donut', x: cx, y: cy, v: r });
  }
  for (let x = 12400; x < 16440; x += 400) props.push({ kind: 'lamp', x, y: 9290 }, { kind: 'lamp', x, y: 13310 });

  // ================= Campagne et Port-Joli =================
  road('road', [[10200, 15600], [ringX(15600, true), 15600]], false, false, 'Route de Port-Joli');
  const southY = ringY(12600, false);
  road('dirt', [[12600, 13400], [12600, southY]], false, false);
  road('dirt', [[14600, 13400], [14600, ringY(14600, false)]], false, false);
  road('dirt', [[10200, 14500], [16000, 14500]], false, false);
  road('dirt', [[10200, 16800], [16000, 16800]], false, false);
  const FX = [10200, 12600, 14600, 16000], FY = [13400, 14500, 15600, 16800, 17850];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 4; r++) {
    const x1 = FX[c] + 130, x2 = FX[c + 1] - 70, y1 = FY[r] + 90, y2 = FY[r + 1] - 90;
    area('field', rect(x1, y1, x2, y2), Math.floor(rnd() * 4));
    if (rnd() < 0.55) {
      // Ferme : maison, grange et bottes de foin.
      const fx = x1 + 60, fy = y1 + 60;
      block('house', fx, fy, fx + 170, fy + 130, 32, pick(HOUSES), pick(HOUSE_ROOFS));
      block('barn', fx + 260, fy, fx + 480, fy + 200, 46, '#a33a2a', '#5a4a42');
      for (let k = 0; k < 5; k++) props.push({ kind: 'hay', x: fx + 120 + rnd() * (x2 - fx - 200), y: fy + 300 + rnd() * (y2 - fy - 360) });
    }
  }
  for (const x of [16900, 17900]) road('street', [[x, 13400], [x, ringY(x, false)]], false, false);
  for (const y of [14500, 16800]) road('street', [[16000, y], [ringX(y, true), y]], false, false);
  const VX = [16000, 16900, 17900, 18950], VY = [13400, 14500, 15600, 16800, 17900];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 4; r++) {
    const x1 = VX[c] + 80, x2 = VX[c + 1] - (c === 2 ? 110 : 80), y1 = VY[r] + 80, y2 = VY[r + 1] - (r === 3 ? 120 : 80);
    for (let x = x1; x + 140 < x2; x += 200 + rnd() * 40) {
      for (const top of [true, false]) {
        const y = top ? y1 : y2 - 120;
        if (rnd() < 0.2) {
          trees.push({ kind: 'bush', x: x + 60, y: y + 60, r: 14 });
          continue;
        }
        block('house', x, y, x + 140, y + 120, 28 + rnd() * 10, pick(HOUSES), pick(HOUSE_ROOFS));
      }
    }
  }

  // ================= Côte =================
  area('sand', rect(0, 18090, 20000, 18760));
  area('sand', rect(19140, 9000, 20000, 18760));
  area('water', rect(-50, 18700, 20050, 20050));
  area('water', rect(19420, 9150, 20050, 20050));

  // ---------- Revêtements, puis tout ce qui dépend du sol ----------
  rasterize({ areas, roads });

  const GRID = 1250;
  const occ = new Uint8Array(GRID * GRID);
  const mark = (x1: number, y1: number, x2: number, y2: number) => {
    for (let j = Math.max(0, Math.floor(y1 / 16)); j <= Math.min(GRID - 1, Math.floor(y2 / 16)); j++)
      for (let i = Math.max(0, Math.floor(x1 / 16)); i <= Math.min(GRID - 1, Math.floor(x2 / 16)); i++) occ[j * GRID + i] = 1;
  };
  for (const b of blocks) mark(b.x1 - 30, b.y1 - 30, b.x2 + 30, b.y2 + 30);
  for (const t of trees) mark(t.x - t.r, t.y - t.r, t.x + t.r, t.y + t.r);
  /** Un arbre ne pousse que sur l'herbe, loin des routes et des bâtiments. */
  const plant = (kind: TreeKind, x: number, y: number, r: number, ok: Surf[] = [0, 7, 6], clear = 34): boolean => {
    const rr = r + clear;
    for (const [dx, dy] of [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr], [rr * 0.7, rr * 0.7], [-rr * 0.7, rr * 0.7], [rr * 0.7, -rr * 0.7], [-rr * 0.7, -rr * 0.7]]) {
      if (!ok.includes(surfAt(x + dx, y + dy))) return false;
      const i = Math.floor((x + dx) / 16), j = Math.floor((y + dy) / 16);
      if (i < 0 || j < 0 || i >= GRID || j >= GRID || occ[j * GRID + i]) return false;
    }
    trees.push({ kind, x, y, r });
    mark(x - r * 0.6, y - r * 0.6, x + r * 0.6, y + r * 0.6);
    return true;
  };
  // Forêt des collines : dense, des pins surtout, et quelques rochers.
  for (let y = 13340; y < 17400; y += 96) for (let x = 1340; x < 9700; x += 96) {
    const jx = x + (rnd() - 0.5) * 70, jy = y + (rnd() - 0.5) * 70;
    if (rnd() < 0.04) {
      if (surfAt(jx, jy) === 7) {
        const s = 40 + rnd() * 50;
        let free = true;
        for (const [dx, dy] of [[-s - 40, 0], [s + 40, 0], [0, -s - 40], [0, s + 40]]) if (surfAt(jx + dx, jy + dy) !== 7) free = false;
        if (free) {
          blocks.push({ kind: 'rock', x1: jx - s, y1: jy - s * 0.8, x2: jx + s, y2: jy + s * 0.8, h: 20 + rnd() * 30, color: '#8a8478', seed: seed++ });
          mark(jx - s, jy - s, jx + s, jy + s);
        }
      }
      continue;
    }
    plant(rnd() < 0.7 ? 'pine' : 'tree', jx, jy, 16 + rnd() * 10, [7]);
  }
  // Parc : bosquets autour du lac.
  for (let k = 0; k < 1400; k++) {
    const x = 1400 + rnd() * 8100, y = 9200 + rnd() * 3750;
    plant('tree', x, y, 16 + rnd() * 10, [0], 30);
  }
  // Lisière de la carte et arbres isolés dans la campagne.
  for (let p = 400; p < 19600; p += 60) {
    for (const [x, y] of [[p, 420 + rnd() * 120], [p, 19580 - rnd() * 120], [420 + rnd() * 120, p], [19580 - rnd() * 120, p]] as Pt[]) plant(rnd() < 0.5 ? 'pine' : 'tree', x, y, 18 + rnd() * 8, [0], 10);
  }
  for (let k = 0; k < 4200; k++) {
    const x = 400 + rnd() * 19200, y = 400 + rnd() * 19200;
    const s = surfAt(x, y);
    if (s === 0) plant(rnd() < 0.25 ? 'bush' : 'tree', x, y, 14 + rnd() * 10, [0], 40);
    else if (s === 3 && rnd() < 0.5) plant('palm', x, y, 20, [3], 40);
  }
  for (let k = 0; k < 400; k++) plant('palm', 400 + rnd() * 19200, 18150 + rnd() * 400, 20, [3], 30);

  // ================= Défis =================
  const kmh = (v: number) => v; // les paliers des radars et zones de vitesse sont en km/h
  const driftStars = (len: number): [number, number, number] => {
    // Un drift parfait rapporte ~2 700 points/s à ~300 unités/s.
    const perfect = (2700 * len) / 300;
    const r = (f: number) => Math.round((perfect * f) / 1000) * 1000;
    return [r(0.06), r(0.15), r(0.3)];
  };
  const sprintStars = (pts: Pt[]): [number, number, number] => {
    const len = pathLength(pts);
    return [Math.round(len / 300), Math.round(len / 360), Math.round(len / 420)];
  };
  const ringPts = (x1: number, y1: number, x2: number, y2: number) => {
    const near = (x: number, y: number) => ring.pts.reduce((b, p, i) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(ring.pts[b][0] - x, ring.pts[b][1] - y) ? i : b), 0);
    const a = near(x1, y1), b = near(x2, y2);
    const out: Pt[] = [];
    for (let i = a; i !== b; i = (i + 1) % ring.pts.length) out.push(ring.pts[i]);
    return out;
  };
  const tougePath = slice(touge, 0.08, 0.9);
  const bretelle = ringPts(16800, 800, 19050, 3000);
  const lacets = slice(lakeLoop, 0.02, 0.5);
  const villeDrift: Pt[] = resample([[12440, 6360], [16040, 6360], [16040, 7600]], false);
  const centre: Pt[] = [[11400, 1400], [14600, 1400], [14600, 3880], [17480, 3880], [17480, 6980], [13160, 6980], [13160, 5120], [11000, 5120]];
  const campagne: Pt[] = [[10500, 14500], [12600, 14500], [12600, 16800], [14600, 16800], [14600, 14500], [16000, 14500], [16900, 14500], [16900, 17300]];
  const aero: Pt[] = [[9800, 4800], [7500, 4800], [4400, 4600], [4400, 3720], [2200, 3720], [2200, 3000], [8400, 3000], [8400, 3720], [6400, 3720]];
  const cote: Pt[] = [[10600, 8300], [15000, 8300], [18950, 8600], [19000, 13000], [18920, 15600], [17400, 15600]];
  const challenges: Challenge[] = [
    { id: 'touge', kind: 'drift', name: 'Zone de drift : Lacets des Collines', path: tougePath, half: 190, stars: driftStars(pathLength(tougePath)) },
    { id: 'arene', kind: 'driftArea', name: 'Arène de drift des Docks', path: [[12300, 11300], [12700, 11300]], half: 200, rect: [12262, 9262, 16440, 13340], seconds: 60, stars: [15000, 40000, 80000] },
    { id: 'bretelle', kind: 'drift', name: 'Zone de drift : Grande Courbe', path: bretelle, half: 200, stars: driftStars(pathLength(bretelle)) },
    { id: 'lacets', kind: 'drift', name: 'Zone de drift : Chemin du Lac', path: lacets, half: 170, stars: driftStars(pathLength(lacets)) },
    { id: 'equerre', kind: 'drift', name: "Zone de drift : L'Équerre", path: villeDrift, half: 150, stars: driftStars(pathLength(villeDrift)) },
    { id: 'radar-avenue', kind: 'speedtrap', name: "Radar de l'Avenue", path: [[16900, 4500], [17100, 4500]], half: 140, stars: [kmh(140), kmh(180), kmh(215)] },
    { id: 'radar-cote', kind: 'speedtrap', name: 'Radar de la Plage', path: [[12100, ringY(12100, false)], [11900, ringY(11900, false)]], half: 180, stars: [kmh(170), kmh(210), kmh(240)] },
    { id: 'radar-transversale', kind: 'speedtrap', name: 'Radar de la Transversale', path: [[10200, 6000], [10200, 6200]], half: 180, stars: [kmh(160), kmh(200), kmh(230)] },
    { id: 'piste', kind: 'speedzone', name: "Zone de vitesse : Piste d'envol", path: slice(runway, 0.06, 0.94), half: 220, stars: [kmh(160), kmh(195), kmh(225)] },
    { id: 'nord', kind: 'speedzone', name: 'Zone de vitesse : Ligne Nord', path: ringPts(2500, 860, 9000, 760), half: 200, stars: [kmh(150), kmh(185), kmh(215)] },
    { id: 'sprint-centre', kind: 'sprint', name: 'Sprint du Centre-Ville', path: centre, half: 180, stars: sprintStars(centre) },
    { id: 'sprint-campagne', kind: 'sprint', name: 'Rallye de la Campagne', path: campagne, half: 180, stars: sprintStars(campagne) },
    { id: 'sprint-aero', kind: 'sprint', name: "Tour de l'Aérodrome", path: aero, half: 200, stars: sprintStars(aero) },
    { id: 'sprint-cote', kind: 'sprint', name: 'Grand Sprint de la Côte', path: cote, half: 220, stars: sprintStars(cote) },
  ];

  // ================= Panneaux bonus =================
  const boards: Board[] = [];
  const isFreeSpot = (x: number, y: number) => {
    const s = surfAt(x, y);
    if (s === 4 || s === 9) return false;
    const i = Math.floor(x / 16), j = Math.floor(y / 16);
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (occ[(j + dj) * GRID + i + di]) return false;
    return true;
  };
  const candidates = roads.filter((r) => r.kind !== 'runway' && r.kind !== 'taxi');
  for (let tries = 0; boards.length < 30 && tries < 5000; tries++) {
    const r = pick(candidates);
    const k = 1 + Math.floor(rnd() * (r.pts.length - 2));
    const [ax, ay] = r.pts[k - 1], [bx, by] = r.pts[k + 1];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    const side = rnd() < 0.5 ? -1 : 1;
    const off = r.w / 2 + 70;
    const x = r.pts[k][0] - ((by - ay) / l) * off * side, y = r.pts[k][1] + ((bx - ax) / l) * off * side;
    if (!isFreeSpot(x, y) || boards.some((b) => Math.hypot(b.x - x, b.y - y) < 2200)) continue;
    boards.push({ id: boards.length, x, y });
  }

  const spawns: Spawn[] = [
    { id: 'festival', name: 'Festival Pixel', x: 9500, y: 7900, a: 0 },
    { id: 'ville', name: 'Pixel City', x: 14000, y: 4500, a: 0 },
    { id: 'aerodrome', name: 'Aérodrome', x: 5000, y: 4450, a: Math.PI },
    { id: 'docks', name: 'Arène des Docks', x: 13000, y: 11300, a: 0 },
    { id: 'parc', name: 'Grand Parc', x: 3000, y: 9300, a: 0 },
    { id: 'collines', name: 'Collines', x: 9600, y: 13680, a: Math.PI },
    { id: 'port', name: 'Port-Joli', x: 17400, y: 15600, a: 0 },
    { id: 'plage', name: 'Plage', x: 10000, y: ringY(10000, false), a: Math.PI },
  ];

  const labels = [
    { name: 'PIXEL CITY', x: 14600, y: 4300, big: true },
    { name: 'AÉRODROME', x: 5200, y: 2400, big: true },
    { name: 'FESTIVAL', x: 9400, y: 7000 },
    { name: 'GRAND PARC', x: 5200, y: 11050, big: true },
    { name: 'COLLINES', x: 5200, y: 16600, big: true },
    { name: 'DOCKS', x: 14400, y: 11300, big: true },
    { name: 'CAMPAGNE', x: 13100, y: 16200 },
    { name: 'PORT-JOLI', x: 17500, y: 16200 },
    { name: 'PLAGE', x: 7000, y: 18400 },
  ];

  return { roads, areas, blocks, trees, props, spawns, challenges, boards, labels };
}

function shadeHex(h: string): string {
  const v = parseInt(h.slice(1), 16);
  const f = (c: number) => Math.round(c * 0.75).toString(16).padStart(2, '0');
  return '#' + f((v >> 16) & 255) + f((v >> 8) & 255) + f(v & 255);
}
