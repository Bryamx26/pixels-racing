import { mulberry32 } from '../../shared/math';
import { EDGE, WORLD, polyBounds, type Area, type Block, type Prop, type Pt, type Road, type Tree, type World } from '../../shared/world/world';
import { ISO, groundMatrix, isoX, isoY } from './iso';
import { P, asphaltPattern, box, poly, shade, tree } from './isoArt';

/**
 * Dessin du monde ouvert. Repère « carte » : mx = isoX + OX, my = isoY (le sol entier fait
 * ~30 000 × 15 000 pixels : il est cuit à la demande en tuiles de TILE pixels).
 */
export const OX = WORLD * ISO;
export const TILE = 256;

/** Monde → carte, et inverse (au sol). */
export const mapX = (x: number, y: number) => isoX(x, y) + OX;
export const mapY = (x: number, y: number, z = 0) => isoY(x, y, z);
export function unmap(mx: number, my: number): Pt {
  const a = (mx - OX) / ISO, b = (2 * my) / ISO;
  return [(a + b) / 2, (b - a) / 2];
}

/** Rectangle monde qui couvre un rectangle de la carte. */
export function worldRect(mx1: number, my1: number, mx2: number, my2: number, margin = 0): [number, number, number, number] {
  const c = [unmap(mx1, my1), unmap(mx2, my1), unmap(mx1, my2), unmap(mx2, my2)];
  return [Math.min(...c.map((p) => p[0])) - margin, Math.min(...c.map((p) => p[1])) - margin, Math.max(...c.map((p) => p[0])) + margin, Math.max(...c.map((p) => p[1])) + margin];
}

const overlaps = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

const AREA_COL: Record<Area['kind'], string> = {
  water: '#2f6fb3',
  sand: '#e3cf94',
  lot: '#55575f',
  park: '#4c9c40',
  field: '#8fae4a',
  forest: '#2e6a2a',
  plaza: '#a9a7a2',
  apron: '#7a7c84',
  festival: '#c9b98e',
};
const FIELD_COLS = ['#c8b04a', '#8fae4a', '#a5c25a', '#9b7a4c'];

interface RoadInfo {
  r: Road;
  bb: [number, number, number, number];
}

/** Cuisson des tuiles du sol. */
export class GroundBaker {
  private grass: CanvasPattern | null = null;
  private asphalt: CanvasPattern | null = null;
  private areaBB: [number, number, number, number][];
  private roads: RoadInfo[];

  constructor(private world: World) {
    const L = world.layout;
    this.areaBB = L.areas.map((a) => polyBounds(a.poly));
    this.roads = L.roads.map((r) => {
      const bb = polyBounds(r.pts);
      return { r, bb: [bb[0] - r.w, bb[1] - r.w, bb[2] + r.w, bb[3] + r.w] };
    });
  }

  private patterns(g: CanvasRenderingContext2D): void {
    if (this.grass) return;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const gg = c.getContext('2d')!;
    const rnd = mulberry32(9);
    gg.fillStyle = '#4a9a3c';
    gg.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 380; i++) {
      gg.fillStyle = rnd() < 0.5 ? '#54a644' : '#418c35';
      gg.fillRect((rnd() * 64) | 0, (rnd() * 64) | 0, 1 + (rnd() < 0.3 ? 1 : 0), 1);
    }
    this.grass = g.createPattern(c, 'repeat');
    this.asphalt = asphaltPattern(g);
  }

  bake(ti: number, tj: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d')!;
    this.patterns(g);
    const tx = ti * TILE, ty = tj * TILE;
    // Herbe, motif aligné sur la carte (pas de couture entre tuiles).
    g.setTransform(1, 0, 0, 1, -(tx % 64), -(ty % 64));
    g.fillStyle = this.grass!;
    g.fillRect(0, 0, TILE + 64, TILE + 64);
    const bb = worldRect(tx, ty, tx + TILE, ty + TILE, 40);
    const M = groundMatrix(OX - tx, -ty);
    g.setTransform(...M);
    const L = this.world.layout;

    // Lisière infranchissable : sous-bois sombre.
    g.fillStyle = '#24521f';
    for (const r of [[-500, -500, WORLD + 500, EDGE], [-500, WORLD - EDGE, WORLD + 500, WORLD + 500], [-500, -500, EDGE, WORLD + 500], [WORLD - EDGE, -500, WORLD + 500, WORLD + 500]])
      if (overlaps(r, bb)) g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);

    // Zones.
    L.areas.forEach((a, i) => {
      if (!overlaps(this.areaBB[i], bb)) return;
      this.area(g, a);
    });

    // Ombres portées des bâtiments (soleil en haut à gauche de l'écran).
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (const i of this.world.query('blocks', bb[0] - 300, bb[1] - 300, bb[2], bb[3])) {
      const b = L.blocks[i];
      if (b.kind === 'plane') continue;
      const s = Math.min(240, b.h * 0.7);
      g.beginPath();
      g.moveTo(b.x1, b.y1);
      g.lineTo(b.x2, b.y1);
      g.lineTo(b.x2 + s, b.y1 + s * 0.35);
      g.lineTo(b.x2 + s, b.y2 + s * 0.35);
      g.lineTo(b.x1 + s, b.y2 + s * 0.35);
      g.lineTo(b.x1, b.y2);
      g.closePath();
      g.fill();
    }

    // Routes : abords, revêtement, marquages (en trois passes pour des croisements propres).
    const runs = this.roads.filter((ri) => overlaps(ri.bb, bb)).map((ri) => ({ r: ri.r, runs: this.runs(ri.r, bb) })).filter((x) => x.runs.length);
    for (const pass of [0, 1, 2]) for (const { r, runs: rs } of runs) for (const run of rs) this.road(g, r, run, pass);

    // Décor peint au sol.
    for (const p of L.props) {
      if (p.x < bb[0] - 400 || p.x > bb[2] + 400 || p.y < bb[1] - 400 || p.y > bb[3] + 400) continue;
      this.flatProp(g, p);
    }
    return c;
  }

  /** Portions [début, fin] d'une route proches du rectangle. */
  private runs(r: Road, bb: number[]): [number, number][] {
    const m = r.w;
    const out: [number, number][] = [];
    const n = r.pts.length;
    let start = -1;
    for (let k = 0; k < n; k++) {
      const [x, y] = r.pts[k];
      const inside = x > bb[0] - m && x < bb[2] + m && y > bb[1] - m && y < bb[3] + m;
      if (inside && start < 0) start = k;
      if (!inside && start >= 0) {
        out.push([Math.max(0, start - 1), k]);
        start = -1;
      }
    }
    if (start >= 0) out.push([Math.max(0, start - 1), r.closed ? n : n - 1]);
    return out;
  }

  private path(g: CanvasRenderingContext2D, r: Road, [a, b]: [number, number], off = 0): void {
    g.beginPath();
    const n = r.pts.length;
    for (let k = a; k <= b; k++) {
      const i = k % n;
      let [x, y] = r.pts[i];
      if (off) {
        const p = r.pts[Math.max(0, i - 1)], q = r.pts[Math.min(n - 1, i + 1)];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        x -= ((q[1] - p[1]) / l) * off;
        y += ((q[0] - p[0]) / l) * off;
      }
      if (k === a) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }

  private road(g: CanvasRenderingContext2D, r: Road, run: [number, number], pass: number): void {
    const w = r.w;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.setLineDash([]);
    const dash = (on: number, offL: number, col: string, lw: number, gap: number) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.setLineDash(gap ? [on, gap] : []);
      g.lineDashOffset = -run[0] * 16;
      g.lineCap = 'butt';
      this.path(g, r, run, offL);
      g.stroke();
      g.setLineDash([]);
      g.lineCap = 'round';
    };
    if (pass === 0) {
      // Abords : bas-côté, trottoir, rive du pont.
      g.strokeStyle = r.kind === 'dirt' ? '#86683f' : r.kind === 'bridge' ? '#5a4030' : r.kind === 'street' ? '#bdbab3' : '#7d7a70';
      g.lineWidth = w + (r.kind === 'street' ? 4 : r.kind === 'bridge' ? 16 : 10);
      this.path(g, r, run);
      g.stroke();
      return;
    }
    if (pass === 1) {
      g.strokeStyle = r.kind === 'dirt' ? '#a8865a' : r.kind === 'bridge' ? '#9c7a4e' : r.kind === 'runway' ? '#3e4048' : this.asphalt!;
      g.lineWidth = w;
      this.path(g, r, run);
      g.stroke();
      if (r.kind === 'dirt') {
        dash(10, w * 0.22, 'rgba(90,60,30,0.35)', 6, 14);
        dash(10, -w * 0.22, 'rgba(90,60,30,0.35)', 6, 14);
      }
      if (r.kind === 'bridge') dash(3, 0, 'rgba(60,40,20,0.4)', w - 6, 9);
      return;
    }
    // Marquages.
    switch (r.kind) {
      case 'highway':
        dash(1, w / 2 - 8, '#ececec', 3, 0);
        dash(1, -w / 2 + 8, '#ececec', 3, 0);
        dash(18, w / 4, 'rgba(240,240,240,0.75)', 2, 22);
        dash(18, -w / 4, 'rgba(240,240,240,0.75)', 2, 22);
        dash(1, 3, '#e8c440', 2, 0);
        dash(1, -3, '#e8c440', 2, 0);
        break;
      case 'road':
        dash(1, w / 2 - 6, 'rgba(240,240,240,0.85)', 2, 0);
        dash(1, -w / 2 + 6, 'rgba(240,240,240,0.85)', 2, 0);
        dash(16, 0, 'rgba(240,240,240,0.8)', 2, 18);
        break;
      case 'street':
        dash(12, 0, 'rgba(240,220,120,0.75)', 2, 12);
        break;
      case 'taxi':
        dash(1, 0, '#f2c230', 2, 0);
        break;
      case 'runway':
        dash(1, w / 2 - 10, '#f4f4f4', 4, 0);
        dash(1, -w / 2 + 10, '#f4f4f4', 4, 0);
        dash(40, 0, '#f4f4f4', 4, 40);
        // Bandes de seuil aux deux bouts.
        g.fillStyle = '#f4f4f4';
        for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
          const dir = end === r.pts[0] ? 1 : -1;
          for (let k = -w / 2 + 24; k < w / 2 - 20; k += 22) g.fillRect(end[0] + (dir > 0 ? 30 : -150), end[1] + k, 120, 10);
        }
        break;
      case 'bridge':
        dash(1, w / 2 + 4, '#d9d2c0', 4, 0);
        dash(1, -w / 2 - 4, '#d9d2c0', 4, 0);
        dash(4, w / 2 + 4, '#5a4030', 6, 36);
        dash(4, -w / 2 - 4, '#5a4030', 6, 36);
        break;
    }
  }

  private area(g: CanvasRenderingContext2D, a: Area): void {
    const path = () => {
      g.beginPath();
      a.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    const [x1, y1, x2, y2] = polyBounds(a.poly);
    if (a.kind === 'water') {
      path();
      g.lineJoin = 'round';
      g.lineWidth = 26;
      g.strokeStyle = '#d7eef7';
      g.stroke();
      g.lineWidth = 12;
      g.strokeStyle = '#5aa3d6';
      g.stroke();
      g.fillStyle = AREA_COL.water;
      g.fill();
      g.save();
      g.clip();
      const rnd = mulberry32(Math.round(x1 + y1));
      g.fillStyle = 'rgba(255,255,255,0.28)';
      const n = Math.min(4000, ((x2 - x1) * (y2 - y1)) / 9000);
      for (let k = 0; k < n; k++) g.fillRect(x1 + rnd() * (x2 - x1), y1 + rnd() * (y2 - y1), 14, 3);
      g.restore();
      return;
    }
    path();
    if (a.kind === 'plaza' || a.kind === 'lot' || a.kind === 'apron') {
      g.lineJoin = 'miter';
      g.lineWidth = 6;
      g.strokeStyle = a.kind === 'plaza' ? '#8d8b86' : '#9a9890';
      g.stroke();
    }
    g.fillStyle = a.kind === 'field' ? FIELD_COLS[a.v ?? 0] : a.kind === 'lot' ? this.asphalt! : AREA_COL[a.kind];
    g.fill();
    g.save();
    g.clip();
    const rnd = mulberry32(Math.round(x1 * 7 + y1));
    if (a.kind === 'field') {
      // Sillons.
      g.strokeStyle = 'rgba(0,0,0,0.13)';
      g.lineWidth = 6;
      g.beginPath();
      const along = (a.v ?? 0) % 2 === 0;
      if (along) for (let y = y1; y < y2; y += 22) (g.moveTo(x1, y), g.lineTo(x2, y));
      else for (let x = x1; x < x2; x += 22) (g.moveTo(x, y1), g.lineTo(x, y2));
      g.stroke();
    } else if (a.kind === 'plaza') {
      g.strokeStyle = 'rgba(0,0,0,0.07)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let y = y1; y < y2; y += 24) (g.moveTo(x1, y), g.lineTo(x2, y));
      for (let x = x1; x < x2; x += 24) (g.moveTo(x, y1), g.lineTo(x, y2));
      g.stroke();
    } else if (a.kind === 'lot' && a.v === 1) {
      // Places de parking.
      g.strokeStyle = 'rgba(240,240,240,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      for (let y = y1 + 20; y < y2 - 60; y += 120) for (let x = x1 + 20; x < x2 - 20; x += 40) (g.moveTo(x, y), g.lineTo(x, y + 60));
      g.stroke();
    } else if (a.kind === 'lot' && a.v === 2) {
      // Arène : bordure rouge et blanche, grand damier de départ.
      g.lineWidth = 16;
      g.setLineDash([24, 24]);
      g.strokeStyle = '#d8262e';
      g.strokeRect(x1 + 20, y1 + 20, x2 - x1 - 40, y2 - y1 - 40);
      g.setLineDash([]);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 12; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#eee';
        g.fillRect(12350 + i * 16, 11100 + j * 16 + 8, 16, 16);
      }
    } else if (a.kind === 'park' || a.kind === 'forest' || a.kind === 'sand') {
      const spots = Math.min(5000, ((x2 - x1) * (y2 - y1)) / 6000);
      for (let k = 0; k < spots; k++) {
        g.fillStyle = a.kind === 'sand' ? (rnd() < 0.5 ? '#f0dfa8' : '#cfb877') : rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
        g.fillRect(x1 + rnd() * (x2 - x1), y1 + rnd() * (y2 - y1), 5, 4);
      }
      if (a.kind === 'park') {
        const flowers = ['#f2c230', '#e34b4b', '#f2f2f2', '#c06bd8', '#ff8fb1'];
        for (let k = 0; k < spots / 40; k++) {
          const x = x1 + rnd() * (x2 - x1), y = y1 + rnd() * (y2 - y1);
          g.fillStyle = '#2f6e2c';
          g.beginPath();
          g.ellipse(x, y, 24, 16, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = flowers[Math.floor(rnd() * flowers.length)];
          for (let f = 0; f < 14; f++) g.fillRect(x + (rnd() - 0.5) * 36, y + (rnd() - 0.5) * 22, 4, 4);
        }
      }
    } else if (a.kind === 'festival') {
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 4;
      g.strokeRect(x1 + 30, y1 + 30, x2 - x1 - 60, y2 - y1 - 60);
    }
    g.restore();
  }

  private flatProp(g: CanvasRenderingContext2D, p: Prop): void {
    if (p.kind === 'crosswalk') {
      g.fillStyle = 'rgba(240,240,240,0.8)';
      for (let k = -44; k <= 40; k += 14) {
        g.fillRect(p.x + 64, p.y + k, 20, 7);
        g.fillRect(p.x - 84, p.y + k, 20, 7);
        g.fillRect(p.x + k, p.y + 64, 7, 20);
        g.fillRect(p.x + k, p.y - 84, 7, 20);
      }
    } else if (p.kind === 'donut') {
      g.strokeStyle = 'rgba(15,15,18,0.35)';
      g.lineWidth = 4;
      const rnd = mulberry32(p.x);
      for (let k = 0; k < 9; k++) {
        g.beginPath();
        g.ellipse(p.x + (rnd() - 0.5) * 60, p.y + (rnd() - 0.5) * 60, (p.v ?? 300) * (0.45 + rnd() * 0.5), (p.v ?? 300) * (0.4 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = 'rgba(240,240,240,0.6)';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(p.x, p.y, 40, 0, Math.PI * 2);
      g.stroke();
    } else if (p.kind === 'helipad') {
      g.fillStyle = '#3e4048';
      g.beginPath();
      g.arc(p.x, p.y, 110, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#f2c230';
      g.lineWidth = 8;
      g.stroke();
      g.fillStyle = '#f4f4f4';
      g.fillRect(p.x - 40, p.y - 50, 18, 100);
      g.fillRect(p.x + 22, p.y - 50, 18, 100);
      g.fillRect(p.x - 22, p.y - 9, 44, 18);
    }
  }
}

// ---------- Sprites (debout) ----------
export interface SpriteImg {
  canvas: HTMLCanvasElement;
  /** Position du coin haut-gauche dans la carte. */
  x: number;
  y: number;
}

/** Image d'un bâtiment (ou d'un autre bloc), placée dans la carte. */
export function blockSprite(b: Block): SpriteImg {
  const extra = b.kind === 'control' ? 50 : b.kind === 'tent' ? 30 : 30;
  const sx1 = mapX(b.x1, b.y2) - 4, sx2 = mapX(b.x2, b.y1) + 4;
  const sy1 = mapY(b.x1, b.y1, b.h + extra) - 30, sy2 = mapY(b.x2, b.y2) + 4;
  const plane = b.kind === 'plane';
  const pad = plane ? 120 : 0;
  const c = document.createElement('canvas');
  c.width = Math.ceil(sx2 - sx1 + pad * 2);
  c.height = Math.ceil(sy2 - sy1 + pad);
  const g = c.getContext('2d')!;
  const ox = OX - sx1 + pad, oy = -sy1 + pad / 2;
  const rnd = mulberry32(b.seed);
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, w = b.x2 - b.x1, d = b.y2 - b.y1;
  switch (b.kind) {
    case 'tower':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, b.color, { windows: { rnd, glass: shade(b.color, 0.6), lit: 0.15 }, roof: b.roof, roofDetails: rnd });
      break;
    case 'building':
    case 'terminal':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, b.color, { windows: { rnd, glass: rnd() < 0.5 ? '#2e3d5c' : '#3b6f8f', lit: rnd() * 0.2 }, roof: b.roof, roofDetails: b.kind === 'building' ? rnd : undefined });
      break;
    case 'house':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, b.color, { windows: { rnd, glass: '#3b6f8f', lit: 0.1 } });
      // Toit à deux pans (faîtage le long de x).
      roof(g, ox, oy, b.x1 - 6, b.y1 - 6, b.x2 + 6, b.y2 + 6, b.h, 22, b.roof ?? '#b5452f');
      break;
    case 'barn':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, b.color);
      roof(g, ox, oy, b.x1 - 8, b.y1 - 8, b.x2 + 8, b.y2 + 8, b.h, 34, b.roof ?? '#5a4a42');
      break;
    case 'hangar': {
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, b.color, { roof: b.roof });
      // Grande porte côté tarmac (face y1, non visible en iso) : bandes sur le toit à la place.
      g.strokeStyle = 'rgba(0,0,0,0.15)';
      g.lineWidth = 2;
      for (let x = b.x1 + 40; x < b.x2; x += 60) {
        const [ax, ay] = P(ox, oy, x, b.y1, b.h), [bx, by] = P(ox, oy, x, b.y2, b.h);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
      break;
    }
    case 'warehouse':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, b.color, { roof: b.roof, roofDetails: rnd });
      break;
    case 'container': {
      const stacks = b.h > 60 ? 2 : 1;
      for (let s = 0; s < stacks; s++) {
        const col = s ? ['#2e86c1', '#d68910', '#27ae60', '#c0392b'][b.seed % 4] : b.color;
        const n = Math.max(1, Math.round(w / 240));
        for (let k = 0; k < n; k++) box(g, ox, oy, b.x1 + (w / n) * (k + 0.5), cy, 0, w / n - 4, d, s * 46, 44, col);
      }
      break;
    }
    case 'control':
      box(g, ox, oy, cx, cy, 0, w * 0.7, d * 0.7, 0, b.h, b.color, { windows: { rnd, glass: '#3b6f8f', lit: 0 } });
      box(g, ox, oy, cx, cy, 0, w * 1.1, d * 1.1, b.h, 34, '#4a7090', { roof: '#e8e4dc' });
      break;
    case 'tent':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h * 0.6, '#f4f4f4');
      pyramid(g, ox, oy, b.x1 - 6, b.y1 - 6, b.x2 + 6, b.y2 + 6, b.h * 0.6, b.h * 0.7, b.color);
      break;
    case 'rock':
      box(g, ox, oy, cx, cy, 0.3, w * 0.9, d * 0.9, 0, b.h, b.color);
      box(g, ox, oy, cx + w * 0.1, cy - d * 0.1, -0.2, w * 0.6, d * 0.6, b.h, b.h * 0.4, shade(b.color, 1.1));
      break;
    case 'fountain':
      box(g, ox, oy, cx, cy, 0, w, d, 0, b.h, '#c9c4b8', { roof: '#4f9ad6' });
      box(g, ox, oy, cx, cy, 0, 16, 16, b.h, 26, '#c9c4b8', { roof: '#bfe3f2' });
      break;
    case 'plane':
      planeArt(g, ox, oy, cx, cy, b.color, b.roof ?? '#3f8ef0');
      break;
  }
  return { canvas: c, x: sx1 - pad, y: sy1 - pad / 2 };
}

function roof(g: CanvasRenderingContext2D, ox: number, oy: number, x1: number, y1: number, x2: number, y2: number, z: number, h: number, col: string): void {
  const ym = (y1 + y2) / 2;
  // Pan arrière (vers -y) puis pan avant, et pignon visible (côté +x).
  poly(g, [P(ox, oy, x1, y1, z), P(ox, oy, x2, y1, z), P(ox, oy, x2, ym, z + h), P(ox, oy, x1, ym, z + h)], shade(col, 0.85));
  poly(g, [P(ox, oy, x1, ym, z + h), P(ox, oy, x2, ym, z + h), P(ox, oy, x2, y2, z), P(ox, oy, x1, y2, z)], shade(col, 1.05));
  poly(g, [P(ox, oy, x2, y1 + 6, z), P(ox, oy, x2, ym, z + h - 2), P(ox, oy, x2, y2 - 6, z)], '#d9d0bd');
}

function pyramid(g: CanvasRenderingContext2D, ox: number, oy: number, x1: number, y1: number, x2: number, y2: number, z: number, h: number, col: string): void {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const top = P(ox, oy, cx, cy, z + h);
  poly(g, [P(ox, oy, x1, y1, z), P(ox, oy, x2, y1, z), top], shade(col, 0.8));
  poly(g, [P(ox, oy, x1, y1, z), P(ox, oy, x1, y2, z), top], shade(col, 0.9));
  poly(g, [P(ox, oy, x2, y1, z), P(ox, oy, x2, y2, z), top], shade(col, 0.75));
  poly(g, [P(ox, oy, x1, y2, z), P(ox, oy, x2, y2, z), top], shade(col, 1.08));
  g.fillStyle = '#f4f4f4';
  g.fillRect(Math.round(top[0]) - 1, Math.round(top[1]) - 8, 2, 8);
}

function planeArt(g: CanvasRenderingContext2D, ox: number, oy: number, cx: number, cy: number, body: string, stripe: string): void {
  // Ailes, fuselage, empennage (l'avion pointe vers +x).
  box(g, ox, oy, cx + 10, cy, 0, 70, 300, 14, 5, '#d9dde3');
  box(g, ox, oy, cx - 130, cy, 0, 30, 110, 22, 4, '#d9dde3');
  box(g, ox, oy, cx, cy, 0, 300, 44, 4, 34, body, { roof: '#ffffff' });
  box(g, ox, oy, cx + 8, cy, 0, 280, 46, 20, 5, stripe);
  box(g, ox, oy, cx - 135, cy, 0, 30, 6, 38, 40, stripe);
  box(g, ox, oy, cx + 152, cy, 0, 14, 36, 14, 16, '#2e3d5c');
}

// ---------- Arbres et petits objets (images partagées) ----------
const treeCache = new Map<string, { canvas: HTMLCanvasElement; ax: number; ay: number }>();

/** Image d'arbre partagée (par espèce et taille), avec son point d'ancrage au pied. */
export function treeSprite(t: Tree): { canvas: HTMLCanvasElement; ax: number; ay: number } {
  const r = Math.round(t.r / 2) * 2;
  const v = Math.floor((t.x * 7 + t.y * 13) % 3);
  const key = `${t.kind}${r}.${v}`;
  let s = treeCache.get(key);
  if (s) return s;
  const W = r * 3 + 16, H = r * 4 + 40;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const ax = Math.round(W / 2), ay = H - 8;
  const rnd = mulberry32(r * 31 + v);
  if (t.kind === 'tree') tree(g, ax, ay, r * 0.62, rnd);
  else if (t.kind === 'bush') {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(ax + 3, ay, r * 0.7, r * 0.35, 0, 0, Math.PI * 2);
    g.fill();
    for (const [k, col] of ['#2b7330', '#3a8c3a', '#56a84a'].entries()) {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(ax - k, ay - 5 - k * 3, r * 0.6 - k * 2, r * 0.42 - k * 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else if (t.kind === 'pine') {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(ax + 4, ay, r * 0.6, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a3b22';
    g.fillRect(ax - 1, ay - 8, 3, 8);
    const shades = ['#17421d', '#1f5a26', '#2b7330'];
    const hgt = r * 2.2;
    for (let k = 0; k < 3; k++) {
      const base = ay - 6 - k * hgt * 0.25, w = r * (0.7 - k * 0.15);
      g.fillStyle = shades[k];
      g.beginPath();
      g.moveTo(ax - w, base);
      g.lineTo(ax + w, base);
      g.lineTo(ax + (v - 1), base - hgt * 0.5);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#3f8a3a';
    g.fillRect(ax - 2, ay - 6 - hgt * 0.75, 2, 3);
  } else {
    // Palmier.
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath();
    g.ellipse(ax + 10, ay, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#8a6a44';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(ax + 6, ay - r, ax + 3 + v, ay - r * 1.8);
    g.stroke();
    const tx = ax + 3 + v, ty = ay - r * 1.8;
    g.fillStyle = '#2f8a3a';
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + v;
      g.beginPath();
      g.ellipse(tx + Math.cos(a) * r * 0.45, ty + Math.sin(a) * r * 0.2 + 2, r * 0.5, 3, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#6b4a2e';
    g.fillRect(tx - 2, ty - 1, 4, 4);
  }
  s = { canvas: c, ax, ay };
  treeCache.set(key, s);
  return s;
}

/** Petits objets debout, dessinés directement (cônes, lampadaires, drapeaux, foin). */
export function drawProp(g: CanvasRenderingContext2D, p: Prop, sx: number, sy: number): void {
  sx = Math.round(sx);
  sy = Math.round(sy);
  switch (p.kind) {
    case 'cone':
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(sx - 3, sy, 8, 2);
      g.fillStyle = '#ff7a1a';
      g.fillRect(sx - 3, sy - 2, 7, 2);
      g.fillRect(sx - 2, sy - 6, 5, 4);
      g.fillStyle = '#fff';
      g.fillRect(sx - 2, sy - 5, 5, 1);
      g.fillStyle = '#ff7a1a';
      g.fillRect(sx - 1, sy - 9, 3, 3);
      break;
    case 'lamp':
      g.fillStyle = '#3a3d46';
      g.fillRect(sx, sy - 34, 2, 34);
      g.fillRect(sx - 4, sy - 35, 8, 2);
      g.fillStyle = '#fff2b0';
      g.fillRect(sx - 4, sy - 33, 3, 2);
      g.fillRect(sx + 3, sy - 33, 3, 2);
      break;
    case 'flag': {
      const cols = ['#e34b4b', '#3f8ef0', '#f2c230', '#5ad06a', '#ff7a1a', '#c06bd8'];
      g.fillStyle = '#d9d9de';
      g.fillRect(sx, sy - 40, 2, 40);
      g.fillStyle = cols[(p.v ?? 0) % cols.length];
      g.fillRect(sx + 2, sy - 40, 12, 7);
      g.fillRect(sx + 2, sy - 33, 8, 4);
      break;
    }
    case 'hay':
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(sx - 7, sy, 16, 3);
      g.fillStyle = '#d9b44a';
      g.fillRect(sx - 7, sy - 9, 14, 10);
      g.fillStyle = '#f0d070';
      g.fillRect(sx - 7, sy - 11, 14, 3);
      g.fillStyle = '#a8862e';
      g.fillRect(sx - 7, sy - 5, 14, 1);
      break;
  }
}

export const STANDING = new Set<Prop['kind']>(['cone', 'lamp', 'flag', 'hay']);

// ---------- Carte du monde (minicarte et carte plein écran) ----------
/** Vue isométrique réduite de tout le monde, échelle `scale` pixels par pixel de carte. */
export function worldMapImage(world: World, scale: number): HTMLCanvasElement {
  const L = world.layout;
  const W = Math.ceil(WORLD * 2 * ISO * scale), H = Math.ceil(WORLD * ISO * scale);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const [m0, m1, m2, m3, m4, m5] = groundMatrix(OX, 0);
  g.setTransform(m0 * scale, m1 * scale, m2 * scale, m3 * scale, m4 * scale, m5 * scale);
  g.fillStyle = '#3f8a35';
  g.fillRect(0, 0, WORLD, WORLD);
  g.fillStyle = '#1d4a1d';
  g.fillRect(0, 0, WORLD, EDGE);
  g.fillRect(0, WORLD - EDGE, WORLD, EDGE);
  g.fillRect(0, 0, EDGE, WORLD);
  g.fillRect(WORLD - EDGE, 0, EDGE, WORLD);
  for (const a of L.areas) {
    g.beginPath();
    a.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = a.kind === 'field' ? FIELD_COLS[a.v ?? 0] : a.kind === 'water' ? '#2a62a0' : a.kind === 'forest' ? '#2a5e26' : AREA_COL[a.kind];
    g.fill();
  }
  g.fillStyle = '#6a6c74';
  for (const b of L.blocks) if (b.kind !== 'plane') g.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
  g.lineJoin = g.lineCap = 'round';
  for (const pass of [0, 1]) for (const r of L.roads) {
    g.beginPath();
    r.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (r.closed) g.closePath();
    g.lineWidth = Math.max(r.w, 60 / scale / 8) + (pass ? 0 : 50);
    g.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.35)' : r.kind === 'highway' ? '#f2c230' : r.kind === 'dirt' ? '#c8a26a' : '#e8e8ee';
    g.stroke();
  }
  return c;
}

