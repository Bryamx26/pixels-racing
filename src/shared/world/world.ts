import { CAR_LENGTH, CAR_WIDTH } from '../constants';
import { hitWall, type CarBody, type StepMods } from '../cars/physics';
import { buildLayout } from './layout';

/**
 * Monde ouvert : une très grande carte (WORLD × WORLD unités) faite de routes, de zones
 * (eau, parcs, champs, parkings…) et d'obstacles (bâtiments, arbres, conteneurs).
 * Tout est généré de façon déterministe, à l'identique sur le serveur et le client.
 */
export const WORLD = 20000;
/** Taille d'une case de la grille des revêtements. */
export const CELL = 16;
const GRID = WORLD / CELL;
/** Taille d'un seau de l'index spatial des obstacles et du décor. */
export const BUCKET = 256;
const BUCKETS = Math.ceil(WORLD / BUCKET);

export type Pt = [number, number];

/** Revêtements (grille de physique). */
export const Surf = {
  Grass: 0,
  Road: 1,
  Dirt: 2,
  Sand: 3,
  Water: 4,
  Lot: 5,
  Field: 6,
  Forest: 7,
  Plaza: 8,
  Wall: 9,
} as const;
export type Surf = (typeof Surf)[keyof typeof Surf];

export type RoadKind = 'highway' | 'road' | 'street' | 'dirt' | 'runway' | 'taxi' | 'bridge';

export interface Road {
  kind: RoadKind;
  /** Largeur de la chaussée. */
  w: number;
  /** Axe échantillonné tous les STEP unités. */
  pts: Pt[];
  closed: boolean;
  name?: string;
}

export type AreaKind = 'water' | 'sand' | 'lot' | 'park' | 'field' | 'forest' | 'plaza' | 'apron' | 'festival';

export interface Area {
  kind: AreaKind;
  poly: Pt[];
  /** Variante de rendu (couleur de culture, motif de parking…). */
  v?: number;
}

export type BlockKind = 'building' | 'tower' | 'house' | 'hangar' | 'warehouse' | 'container' | 'terminal' | 'control' | 'tent' | 'barn' | 'rock' | 'plane' | 'fountain';

/** Obstacle rectangulaire aligné sur les axes. */
export interface Block {
  kind: BlockKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  h: number;
  color: string;
  roof?: string;
  seed: number;
}

export type TreeKind = 'tree' | 'pine' | 'palm' | 'bush';

export interface Tree {
  kind: TreeKind;
  x: number;
  y: number;
  r: number;
}

/** Décor sans collision (dessiné au sol ou debout). */
export interface Prop {
  kind: 'cone' | 'lamp' | 'crane' | 'flag' | 'hay' | 'donut' | 'helipad' | 'parking' | 'crosswalk' | 'runwayMarks' | 'bench';
  x: number;
  y: number;
  a?: number;
  v?: number;
}

export interface Spawn {
  id: string;
  name: string;
  x: number;
  y: number;
  a: number;
}

export type ChallengeKind = 'drift' | 'driftArea' | 'speedtrap' | 'speedzone' | 'sprint';

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  name: string;
  /** Tracé (drift, zone de vitesse) ou points de passage (sprint). */
  path: Pt[];
  /** Largeur du couloir à respecter de part et d'autre du tracé. */
  half: number;
  /** Zone rectangulaire (drift libre) et durée (s). */
  rect?: [number, number, number, number];
  seconds?: number;
  /** Paliers des 1, 2 et 3 étoiles (points, km/h ; secondes pour un sprint : plus bas = mieux). */
  stars: [number, number, number];
}

export interface Board {
  id: number;
  x: number;
  y: number;
}

export interface Layout {
  roads: Road[];
  areas: Area[];
  blocks: Block[];
  trees: Tree[];
  props: Prop[];
  spawns: Spawn[];
  challenges: Challenge[];
  boards: Board[];
  /** Noms de lieux affichés sur la carte. */
  labels: { name: string; x: number; y: number; big?: boolean }[];
}

const inPoly = (poly: Pt[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export function polyBounds(poly: Pt[]): [number, number, number, number] {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of poly) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  }
  return [x1, y1, x2, y2];
}

const AREA_SURF: Record<AreaKind, Surf> = {
  water: Surf.Water,
  sand: Surf.Sand,
  lot: Surf.Lot,
  park: Surf.Grass,
  field: Surf.Field,
  forest: Surf.Forest,
  plaza: Surf.Plaza,
  apron: Surf.Lot,
  festival: Surf.Plaza,
};

/** Bords de la carte : au-delà, forêt infranchissable. */
export const EDGE = 380;

export class World {
  readonly layout: Layout;
  readonly surf = new Uint8Array(GRID * GRID);
  /** Index spatial : indices des blocs et des arbres par seau. */
  private blockIdx: number[][] = Array.from({ length: BUCKETS * BUCKETS }, () => []);
  private treeIdx: number[][] = Array.from({ length: BUCKETS * BUCKETS }, () => []);

  constructor() {
    this.layout = buildLayout((x, y) => this.surfAt(x, y), (l) => this.rasterize(l));
    this.index();
  }

  surfAt(x: number, y: number): Surf {
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return Surf.Wall;
    return this.surf[j * GRID + i] as Surf;
  }

  /** Revêtements : bords, zones (dans l'ordre), puis routes par-dessus (ponts compris). */
  private rasterize(l: Pick<Layout, 'areas' | 'roads'>): void {
    const s = this.surf;
    s.fill(Surf.Grass);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = i * CELL + CELL / 2, y = j * CELL + CELL / 2;
        if (x < EDGE || y < EDGE || x > WORLD - EDGE || y > WORLD - EDGE) s[j * GRID + i] = Surf.Wall;
      }
    }
    for (const a of l.areas) {
      const [x1, y1, x2, y2] = polyBounds(a.poly);
      const v = AREA_SURF[a.kind];
      for (let j = Math.max(0, Math.floor(y1 / CELL)); j <= Math.min(GRID - 1, Math.floor(y2 / CELL)); j++) {
        for (let i = Math.max(0, Math.floor(x1 / CELL)); i <= Math.min(GRID - 1, Math.floor(x2 / CELL)); i++) {
          const k = j * GRID + i;
          if (s[k] === Surf.Wall && v !== Surf.Water) continue;
          if (inPoly(a.poly, i * CELL + CELL / 2, j * CELL + CELL / 2)) s[k] = v;
        }
      }
    }
    // Les routes d'abord en terre, puis le bitume : un croisement reste goudronné.
    const order = [...l.roads].sort((p, q) => (p.kind === 'dirt' ? 0 : 1) - (q.kind === 'dirt' ? 0 : 1));
    for (const r of order) {
      const v: Surf = r.kind === 'dirt' ? Surf.Dirt : Surf.Road;
      const rad = r.w / 2 + 2;
      const n = r.pts.length;
      for (let k = 0; k < (r.closed ? n : n - 1); k++) {
        const [ax, ay] = r.pts[k], [bx, by] = r.pts[(k + 1) % n];
        const x1 = Math.min(ax, bx) - rad, x2 = Math.max(ax, bx) + rad;
        const y1 = Math.min(ay, by) - rad, y2 = Math.max(ay, by) + rad;
        for (let j = Math.max(0, Math.floor(y1 / CELL)); j <= Math.min(GRID - 1, Math.floor(y2 / CELL)); j++) {
          for (let i = Math.max(0, Math.floor(x1 / CELL)); i <= Math.min(GRID - 1, Math.floor(x2 / CELL)); i++) {
            const kk = j * GRID + i;
            if (s[kk] === Surf.Wall || (v === Surf.Dirt && s[kk] === Surf.Road)) continue;
            if (segDist(i * CELL + CELL / 2, j * CELL + CELL / 2, ax, ay, bx, by) <= rad) s[kk] = v;
          }
        }
      }
    }
  }

  private index(): void {
    const put = (idx: number[][], i: number, x1: number, y1: number, x2: number, y2: number) => {
      for (let by = bucketOf(y1); by <= bucketOf(y2); by++) for (let bx = bucketOf(x1); bx <= bucketOf(x2); bx++) idx[by * BUCKETS + bx].push(i);
    };
    this.layout.blocks.forEach((b, i) => put(this.blockIdx, i, b.x1, b.y1, b.x2, b.y2));
    this.layout.trees.forEach((t, i) => put(this.treeIdx, i, t.x - t.r, t.y - t.r, t.x + t.r, t.y + t.r));
  }

  /** Indices des blocs / arbres dont le seau croise le rectangle. */
  query(kind: 'blocks' | 'trees', x1: number, y1: number, x2: number, y2: number, out: Set<number> = new Set()): Set<number> {
    const idx = kind === 'blocks' ? this.blockIdx : this.treeIdx;
    for (let by = bucketOf(y1); by <= bucketOf(y2); by++) for (let bx = bucketOf(x1); bx <= bucketOf(x2); bx++) for (const i of idx[by * BUCKETS + bx]) out.add(i);
    return out;
  }

  /** Vrai si une voiture posée là ne touche rien (pour le voyage rapide et la remise sur la route). */
  isFree(x: number, y: number, r = CAR_LENGTH / 2 + 4): boolean {
    for (let dy = -r; dy <= r; dy += 8) for (let dx = -r; dx <= r; dx += 8) {
      const s = this.surfAt(x + dx, y + dy);
      if (s === Surf.Water || s === Surf.Wall) return false;
    }
    for (const i of this.query('blocks', x - r, y - r, x + r, y + r)) {
      const b = this.layout.blocks[i];
      if (x + r > b.x1 && x - r < b.x2 && y + r > b.y1 && y - r < b.y2) return false;
    }
    for (const i of this.query('trees', x - r, y - r, x + r, y + r)) {
      const t = this.layout.trees[i];
      if (Math.hypot(t.x - x, t.y - y) < t.r + r) return false;
    }
    return true;
  }

  /**
   * Collisions avec le décor : la voiture est approchée par trois cercles (avant, milieu,
   * arrière). Bâtiments et cases d'eau ou de bordure sont des rectangles, les troncs des cercles.
   * Renvoie la vitesse d'impact la plus forte.
   */
  collide(b: CarBody, mods: StepMods): number {
    let power = 0;
    const r = CAR_WIDTH / 2;
    const o = (CAR_LENGTH - CAR_WIDTH) / 2;
    for (let pass = 0; pass < 2; pass++) {
      for (const k of [1, 0, -1]) {
        const cx = b.x + Math.cos(b.a) * o * k, cy = b.y + Math.sin(b.a) * o * k;
        const hit = this.deepest(cx, cy, r);
        if (hit) power = Math.max(power, hitWall(b, hit[0], hit[1], hit[2], mods));
      }
    }
    return power;
  }

  /** Contact le plus profond d'un cercle avec le décor : [nx, ny, pénétration] (n vers l'obstacle). */
  private deepest(cx: number, cy: number, r: number): [number, number, number] | null {
    let best: [number, number, number] | null = null;
    const consider = (x1: number, y1: number, x2: number, y2: number) => {
      const px = Math.max(x1, Math.min(cx, x2)), py = Math.max(y1, Math.min(cy, y2));
      let dx = px - cx, dy = py - cy;
      const d = Math.hypot(dx, dy);
      let pen: number;
      if (d > 1e-6) {
        if (d >= r) return;
        pen = r - d;
        dx /= d;
        dy /= d;
      } else {
        // Centre à l'intérieur : on sort par le côté le plus proche.
        const l = cx - x1, rr = x2 - cx, t = cy - y1, bb = y2 - cy;
        const m = Math.min(l, rr, t, bb);
        [dx, dy] = m === l ? [1, 0] : m === rr ? [-1, 0] : m === t ? [0, 1] : [0, -1];
        pen = m + r;
      }
      if (!best || pen > best[2]) best = [dx, dy, pen];
    };
    for (const i of this.query('blocks', cx - r, cy - r, cx + r, cy + r)) {
      const b = this.layout.blocks[i];
      consider(b.x1, b.y1, b.x2, b.y2);
    }
    for (const i of this.query('trees', cx - r, cy - r, cx + r, cy + r)) {
      const t = this.layout.trees[i];
      const tr = trunk(t);
      const dx = t.x - cx, dy = t.y - cy, d = Math.hypot(dx, dy);
      if (d < r + tr && d > 1e-6 && (!best || r + tr - d > best[2])) best = [dx / d, dy / d, r + tr - d];
    }
    const i0 = Math.floor((cx - r) / CELL), i1 = Math.floor((cx + r) / CELL);
    const j0 = Math.floor((cy - r) / CELL), j1 = Math.floor((cy + r) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const s = i < 0 || j < 0 || i >= GRID || j >= GRID ? Surf.Wall : this.surf[j * GRID + i];
        if (s === Surf.Water || s === Surf.Wall) consider(i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL);
      }
    }
    return best;
  }

  /** Point de route le plus proche (pour remettre une voiture sur la route), avec le cap de la route. */
  nearestRoad(x: number, y: number): { x: number; y: number; a: number } {
    let best = { x, y, a: 0 }, bd = Infinity;
    for (const r of this.layout.roads) {
      if (r.kind === 'runway') continue;
      const n = r.pts.length;
      for (let k = 0; k < n; k += 2) {
        const [px, py] = r.pts[k];
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d >= bd) continue;
        const [qx, qy] = r.pts[Math.min(n - 1, k + 1)], [ox, oy] = r.pts[Math.max(0, k - 1)];
        if (!this.isFree(px, py)) continue;
        bd = d;
        best = { x: px, y: py, a: Math.atan2(qy - oy, qx - ox) };
      }
    }
    return best;
  }
}

/** Rayon du tronc (collision) d'un arbre. */
export const trunk = (t: Tree) => (t.kind === 'bush' ? t.r * 0.7 : t.kind === 'palm' ? 8 : Math.max(9, t.r * 0.35));

const bucketOf = (v: number) => Math.max(0, Math.min(BUCKETS - 1, Math.floor(v / BUCKET)));

export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

let shared: World | null = null;
/** Le monde est unique et lourd à construire : on le garde. */
export function getWorld(): World {
  return (shared ??= new World());
}

/** Revêtement → comportement physique. */
export function surfPhysics(s: Surf): { offroad: boolean; grip: number } {
  switch (s) {
    case Surf.Grass:
    case Surf.Field:
    case Surf.Forest:
      return { offroad: true, grip: 1 };
    case Surf.Sand:
      return { offroad: true, grip: 0.8 };
    case Surf.Dirt:
      return { offroad: false, grip: 0.82 };
    default:
      return { offroad: false, grip: 1 };
  }
}

export { inPoly };
