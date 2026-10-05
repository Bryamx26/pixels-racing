import { KERB_WIDTH, ROAD_WIDTH, WALL_DIST } from '../../shared/constants';
import { mulberry32 } from '../../shared/math';
import { PIT, gridPose } from '../../shared/race/race';
import { nearestSample, pointAt, wrapIdx, type Track } from '../../shared/track/track';

/** Trace la polyligne fermée de l'axe décalé latéralement. */
function loopPath(ctx: CanvasRenderingContext2D, t: Track, offset = 0, step = 1): void {
  ctx.beginPath();
  for (let i = 0; i < t.n; i += step) {
    const [x, y] = pointAt(t, i, offset);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Trace une portion ouverte de l'axe (échantillons from..to, peut déborder du tour). */
function segPath(ctx: CanvasRenderingContext2D, t: Track, from: number, to: number, offset = 0): void {
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const [x, y] = pointAt(t, i, offset);
    if (i === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Chaussée d'une portion : vibreurs, bitume, lignes de voies. */
function roadPortion(ctx: CanvasRenderingContext2D, t: Track, from: number, to: number, asphalt: CanvasPattern): void {
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.lineWidth = ROAD_WIDTH + KERB_WIDTH * 2;
  ctx.strokeStyle = '#f2f2f2';
  segPath(ctx, t, from, to);
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
    segPath(ctx, t, from, to, (side * ROAD_WIDTH) / 4);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Pont : tablier du passage du dessus, dessiné par-dessus les voitures du dessous. */
export interface BridgeArt {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
}

export function renderBridge(t: Track): BridgeArt | null {
  if (!t.bridge) return null;
  const [from, to] = t.bridge;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = from; i <= to; i++) {
    minX = Math.min(minX, t.xs[i]);
    maxX = Math.max(maxX, t.xs[i]);
    minY = Math.min(minY, t.ys[i]);
    maxY = Math.max(maxY, t.ys[i]);
  }
  const pad = ROAD_WIDTH + 40;
  const ox = Math.floor(minX - pad), oy = Math.floor(minY - pad);
  const c = document.createElement('canvas');
  c.width = Math.ceil(maxX - minX + pad * 2);
  c.height = Math.ceil(maxY - minY + pad * 2);
  const ctx = c.getContext('2d')!;
  ctx.translate(-ox, -oy);
  // Ombre portée du tablier puis garde-corps en béton.
  ctx.save();
  ctx.translate(10, 14);
  ctx.lineWidth = ROAD_WIDTH + KERB_WIDTH * 2 + 14;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  segPath(ctx, t, from, to);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = ROAD_WIDTH + KERB_WIDTH * 2 + 14;
  ctx.strokeStyle = '#8e93a3';
  segPath(ctx, t, from, to);
  ctx.stroke();
  ctx.lineWidth = ROAD_WIDTH + KERB_WIDTH * 2 + 6;
  ctx.strokeStyle = '#5d6170';
  ctx.stroke();
  roadPortion(ctx, t, from, to, asphaltPattern(ctx));
  return { canvas: c, ox, oy };
}

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
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

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rnd: () => number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(x + 5, y + 6, r, 0, Math.PI * 2);
  ctx.fill();
  const shades = ['#1f5a26', '#2b7330', '#3a8c3a', '#56a84a'];
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = shades[k];
    ctx.beginPath();
    ctx.arc(x - k * r * 0.12, y - k * r * 0.14, r * (1 - k * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#7cc45f';
  for (let k = 0; k < 4; k++) ctx.fillRect(Math.round(x - r * 0.4 + rnd() * r * 0.5), Math.round(y - r * 0.5 + rnd() * r * 0.4), 2, 2);
}

/**
 * Dessine l'image complète d'un circuit (1 unité monde = 1 pixel) : herbe, vibreurs,
 * bitume, lignes de voies, damier de départ, grille, murs de pneus, arbres et tribunes.
 */
export function renderTrack(t: Track): HTMLCanvasElement {
  const def = t.def;
  const c = document.createElement('canvas');
  c.width = def.width;
  c.height = def.height;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(def.seed);

  // Herbe : couleur de base + grain pixel (deux tons) + bandes de tonte.
  const img = ctx.createImageData(c.width, c.height);
  const [gr, gg, gb] = hexToRgb(def.grass);
  const d = img.data;
  for (let y = 0; y < c.height; y++) {
    const stripe = Math.floor((y + 0) / 48) % 2 ? 6 : 0;
    for (let x = 0; x < c.width; x++) {
      const h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0;
      const n = (h & 15) === 0 ? 12 : (h & 15) === 1 ? -12 : 0;
      const o = (y * c.width + x) * 4;
      d[o] = gr + n + stripe;
      d[o + 1] = gg + n + stripe;
      d[o + 2] = gb + n * 0.5;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Bas-côté plus sombre (zone lente entre la piste et le mur).
  ctx.strokeStyle = 'rgba(30, 60, 20, 0.22)';
  ctx.lineWidth = WALL_DIST * 2;
  loopPath(ctx, t, 0, 2);
  ctx.stroke();

  // Vibreurs : blanc continu puis tirets rouges.
  ctx.lineWidth = ROAD_WIDTH + KERB_WIDTH * 2;
  ctx.strokeStyle = '#f2f2f2';
  loopPath(ctx, t);
  ctx.stroke();
  ctx.setLineDash([12, 12]);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#d8262e';
  ctx.stroke();
  ctx.setLineDash([]);

  // Bitume.
  ctx.lineWidth = ROAD_WIDTH;
  ctx.strokeStyle = asphaltPattern(ctx);
  loopPath(ctx, t);
  ctx.stroke();

  // Trois lignes pointillées : quatre voies, une voiture de large chacune.
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(240, 240, 240, 0.6)';
  ctx.setLineDash([14, 18]);
  for (const side of [-1, 0, 1]) {
    loopPath(ctx, t, (side * ROAD_WIDTH) / 4);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Passage du dessous d'un pont : redessiné par-dessus pour rester continu
  // (le tablier du dessus est une image à part, affichée au-dessus des voitures).
  if (t.under) roadPortion(ctx, t, t.under[0] - 6, t.under[1] + 6, asphaltPattern(ctx));

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
    ctx.fillStyle = '#111';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STANDS', 1, 1);
    ctx.fillStyle = '#ffcc33';
    ctx.fillText('STANDS', 0, 0);
    ctx.restore();
  }

  // Damier de la ligne d'arrivée (échantillon 0) et cases de la grille.
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

  // Murs de pneus des deux côtés.
  const tyreColors = ['#ececec', '#d8262e', '#ececec', '#26262b'];
  for (const side of [-1, 1]) {
    let k = 0;
    let last: [number, number] | null = null;
    for (let i = 0; i < t.n; i++) {
      const p = pointAt(t, i, side * (WALL_DIST + 3));
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 8) continue;
      last = p;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(p[0] + 1, p[1] + 1.5, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tyreColors[k++ % 4];
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 2, 2);
    }
  }

  // Tribune près du départ, du côté où il y a de la place.
  const far = (x: number, y: number, m: number) => {
    const i = nearestSample(t, x, y);
    return Math.hypot(t.xs[i] - x, t.ys[i] - y) > m;
  };
  for (const side of [-1, 1]) {
    const [sx, sy] = pointAt(t, Math.round(t.n * 0.985), side * (WALL_DIST + 60));
    if (!far(sx, sy, WALL_DIST + 40)) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-150 + 6, -36 + 6, 300, 72);
    ctx.fillStyle = '#8a8fa3';
    ctx.fillRect(-150, -36, 300, 72);
    const seat = ['#e34b4b', '#3f8ef0', '#f2c230', '#f2f2f2', '#5ad06a'];
    for (let row = 0; row < 6; row++) {
      for (let x = -144; x < 144; x += 6) {
        ctx.fillStyle = rnd() < 0.7 ? seat[Math.floor(rnd() * seat.length)] : '#5a5f70';
        ctx.fillRect(x, -30 + row * 11, 4, 6);
      }
    }
    ctx.restore();
    break;
  }

  // Arbres sur l'herbe, loin de la piste.
  for (let k = 0; k < (def.width * def.height) / 9000; k++) {
    const x = 20 + rnd() * (def.width - 40);
    const y = 20 + rnd() * (def.height - 40);
    const r = 12 + rnd() * 10;
    if (!far(x, y, WALL_DIST + r + 14)) continue;
    tree(ctx, x, y, r, rnd);
  }
  return c;
}
