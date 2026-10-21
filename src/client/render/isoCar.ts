import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_CELL_H, CAR_CELL_W } from '../../shared/cars/carAtlas';
import { ATLAS_COUNT, CARS } from '../../shared/cars/roster';
import atlasUrl from '../assets/voitures.png';
import { ISO, ISO_Z } from './iso';

/**
 * Voitures réalistes : chaque modèle (muscle car américaine, sportive à moteur arrière,
 * compacte, berline, 4×4, monster truck, japonaises de drift, coupé GT) est un vrai volume 3D
 * lissé (carrosserie, habitacle vitré, jantes, phares, aileron), peint en vernis brillant avec
 * reflets, et rendu en WebGL dans la projection isométrique du jeu. Chaque angle est rendu une
 * fois en haute définition (RES pixels par pixel de jeu), à la demande, puis réutilisé.
 * Les couleurs viennent du dessin de chaque voiture sur la planche d'origine.
 */

export const atlas = new Image();
atlas.src = atlasUrl;

/** Échelle d'affichage (les voitures sont un peu plus petites que leur zone de choc). */
export const CAR_SCALE = 0.7;
export const CAR_HEIGHT = 12;
const ANGLES = 64;
/** Taille du sprite en pixels de jeu, et point au sol sous le centre de la voiture. */
const SW = 52, SH = 44;
const AX = SW / 2, AY = 30;
/** Pixels de sprite par pixel de jeu (le canevas du jeu est à la résolution de l'écran). */
const RES = 3;

type RGB = [number, number, number];

function parseHex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------- Couleurs du dessin d'origine ----------
function spritePixels(carId: number): Uint8ClampedArray | null {
  if (carId >= ATLAS_COUNT || !atlas.complete || !atlas.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = CAR_CELL_W;
  c.height = CAR_CELL_H;
  const g = c.getContext('2d')!;
  g.drawImage(atlas, (carId % 4) * CAR_CELL_W, Math.floor(carId / 4) * CAR_CELL_H, CAR_CELL_W, CAR_CELL_H, 0, 0, CAR_CELL_W, CAR_CELL_H);
  return g.getImageData(0, 0, CAR_CELL_W, CAR_CELL_H).data;
}

/** Les deux couleurs saturées les plus présentes du dessin (carrosserie, accent). */
function palette(carId: number): [RGB, RGB] {
  const def = CARS[carId];
  const fallback = parseHex(def?.color ?? '#888888');
  const p = spritePixels(carId);
  if (!p) return [fallback, parseHex(def?.accent ?? '#f0f0f0')];
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

// ---------- Modèles ----------
type ModelKind = 'muscle' | 'sport' | 'hatch' | 'sedan' | 'suv' | 'monster' | 'drift' | 'gtr';

/** Silhouette d'un modèle, en unités du monde (la voiture fait CAR_WIDTH de large). */
interface Spec {
  len: number;
  /** Demi-largeur de caisse. */
  hw: number;
  clearance: number;
  /** Hauteur du capot au nez, de la ligne de caisse (pied du pare-brise) et du coffre. */
  zNose: number;
  zBelt: number;
  zTail: number;
  /** Habitacle : arrière et avant à sa base, hauteur du toit, longueur au sol du pare-brise et de la lunette. */
  cabRear: number;
  cabFront: number;
  roof: number;
  ws: number;
  rw: number;
  wheelR: number;
  /** Distance des essieux aux extrémités. */
  wheelInset: number;
  /** Rayon des coins de caisse vus de dessus. */
  corner: number;
  /** Ailes élargies au droit des roues. */
  flare: number;
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

const SPECS: Record<ModelKind, Spec> = {
  // Grosse américaine : long capot, lunette fuyante, pare-chocs chromés.
  muscle: { len: 50, hw: 12.5, clearance: 2, zNose: 7.5, zBelt: 9.3, zTail: 9, cabRear: -15, cabFront: 2, roof: 14.2, ws: 6, rw: 8, wheelR: 4.6, wheelInset: 9, corner: 4, flare: 0.4, wing: 'lip' },
  // Sportive à moteur arrière : basse, ronde, becquet.
  sport: { len: 46, hw: 12, clearance: 1.8, zNose: 5.8, zBelt: 8.4, zTail: 8.6, cabRear: -13, cabFront: 3, roof: 13, ws: 7, rw: 10, wheelR: 4.4, wheelInset: 8, corner: 8, flare: 0.8, wing: 'ducktail' },
  // Compacte sportive : courte, hayon droit.
  hatch: { len: 42, hw: 12, clearance: 2, zNose: 8, zBelt: 10, zTail: 10.5, cabRear: -18.5, cabFront: 4, roof: 16, ws: 6.5, rw: 1.8, wheelR: 4.4, wheelInset: 7, corner: 5, flare: 0.3, wing: 'none' },
  // Berline sportive : trois volumes.
  sedan: { len: 50, hw: 12, clearance: 2, zNose: 8, zBelt: 10, zTail: 10.2, cabRear: -12.5, cabFront: 6, roof: 15.4, ws: 7, rw: 6, wheelR: 4.6, wheelInset: 9, corner: 5, flare: 0.3, wing: 'lip' },
  // Gros 4×4 carré.
  suv: { len: 48, hw: 12.5, clearance: 4, zNose: 11, zBelt: 13, zTail: 13.5, cabRear: -22, cabFront: 6, roof: 21, ws: 4.5, rw: 1, wheelR: 5.6, wheelInset: 9, corner: 3.5, flare: 0.5, wing: 'none' },
  monster: { len: 42, hw: 11, clearance: 9, zNose: 15, zBelt: 17, zTail: 16.5, cabRear: -10, cabFront: 4, roof: 24, ws: 4, rw: 1, wheelR: 8, wheelInset: 8, corner: 3, flare: 0, wing: 'none' },
  // Japonaise de drift : basse, ailes larges, grand aileron.
  drift: { len: 50, hw: 12, clearance: 1.6, zNose: 7, zBelt: 9.4, zTail: 9.6, cabRear: -12.5, cabFront: 4, roof: 14, ws: 7, rw: 6.5, wheelR: 4.5, wheelInset: 9, corner: 4.5, flare: 1.2, wing: 'gt' },
  // Coupé GT japonais : caisse carrée, ailes larges, capot ajouré, grand aileron.
  gtr: { len: 50, hw: 12.3, clearance: 2, zNose: 8, zBelt: 10, zTail: 10.3, cabRear: -12, cabFront: 4, roof: 14.6, ws: 6.5, rw: 5, wheelR: 4.7, wheelInset: 9, corner: 3.5, flare: 1, wing: 'gt' },
};

const GLASS: RGB = [10, 14, 22];
const DARK: RGB = [22, 22, 26];
const CHROME = 0xd8dce4;
const TYRE = 0x18181b;
const HEAD = 0xfff4d0;
const TAIL = 0xe0202a;

const smooth = (t: number) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};
/** Superellipse : cos/sin aplatis (n grand = section plus carrée). */
const se = (c: number, n: number) => Math.sign(c) * Math.abs(c) ** (2 / n);

const toLin = (c: RGB) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** Tube lissé : `section(i, j)` donne le point j de la section i (stations de l'arrière vers l'avant). */
function loft(ni: number, nj: number, at: (i: number, j: number) => { p: [number, number, number]; c: RGB }): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const { p, c } = at(i, j);
      pos.push(p[0], p[1], p[2]);
      const k = toLin(c);
      col.push(k.r, k.g, k.b);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < ni - 1; i++) {
    for (let j = 0; j < nj; j++) {
      const a = i * nj + j, b = i * nj + ((j + 1) % nj), c = (i + 1) * nj + j, d = (i + 1) * nj + ((j + 1) % nj);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let envMap: THREE.Texture | null = null;

function buildCar(carId: number, gl: THREE.WebGLRenderer): THREE.Group {
  const kind = MODEL[carId] ?? 'sedan';
  const s = SPECS[kind];
  const def = CARS[carId];
  const [main, accent] = palette(carId);
  const contrast = Math.abs(main[0] - accent[0]) + Math.abs(main[1] - accent[1]) + Math.abs(main[2] - accent[2]) > 200;
  const twoTone = !!def?.drift && carId % 2 === 1;
  const half = s.len / 2;
  const wheelX = [half - s.wheelInset, -half + s.wheelInset];

  if (!envMap) envMap = new THREE.PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture;
  const paint = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    metalness: 0.15,
    roughness: 0.42,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMap,
    envMapIntensity: 0.55,
  });
  const matte = (color: number | THREE.Color, rough = 0.85, metal = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMap, envMapIntensity: 0.6 });
  const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
  const car = new THREE.Group();

  // ----- Caisse -----
  /** Demi-largeur de caisse à l'abscisse x (coins arrondis, ailes élargies). */
  const width = (x: number) => {
    let w = s.hw;
    for (const wx of wheelX) w += s.flare * smooth(1 - Math.abs(x - wx) / (s.wheelR + 3));
    const e = (Math.abs(x) - (half - s.corner)) / s.corner;
    if (e > 0) w *= Math.max(0, 1 - Math.min(1, e) ** 2.4) ** (1 / 2.4);
    return w;
  };
  /** Dessus de la caisse : capot, pied de l'habitacle, coffre ; les bouts s'arrondissent. */
  const topAt = (x: number) => {
    let z: number;
    if (x >= s.cabFront) z = s.zBelt + (s.zNose - s.zBelt) * smooth((x - s.cabFront) / (half - s.cabFront));
    else if (x <= s.cabRear) z = s.zBelt + (s.zTail - s.zBelt) * smooth((s.cabRear - x) / (s.cabRear + half));
    else z = s.zBelt;
    const e = (Math.abs(x) - (half - 2.5)) / 2.5;
    if (e > 0) z -= (1 - Math.sqrt(Math.max(0, 1 - e * e))) * 2.2;
    return z;
  };
  /** Bas de caisse, relevé en arc au-dessus des roues (passages de roue). */
  const bottomAt = (x: number) => {
    let z = s.clearance;
    for (const wx of wheelX) {
      const r = s.wheelR + 0.7, dx = x - wx;
      if (Math.abs(dx) < r) z = Math.max(z, Math.min(s.wheelR + Math.sqrt(r * r - dx * dx), topAt(x) - 2.4));
    }
    return z;
  };
  const NI = 120, NJ = 56;
  const xs = (i: number) => -half + (s.len * i) / (NI - 1);
  car.add(
    new THREE.Mesh(
      loft(NI, NJ, (i, j) => {
        const x = xs(i);
        const t = (j / NJ) * Math.PI * 2;
        const w = width(x), top = topAt(x);
        const bot = bottomAt(x);
        const mid = (bot + top) / 2, hh = (top - bot) / 2;
        const zr = se(Math.sin(t), 5);
        const z = mid + hh * zr;
        // Flancs légèrement rentrés vers le haut.
        const y = w * se(Math.cos(t), 5) * (1 - 0.06 * Math.max(0, zr));
        let c: RGB = main;
        if (z < bot + 0.6) c = DARK;
        else if (twoTone && z < s.clearance + 3.2) c = accent;
        // Bandes de course sur le capot et le coffre des américaines.
        else if (kind === 'muscle' && contrast && zr > 0.9 && Math.abs(y) > 0.8 && Math.abs(y) < 2.8) c = accent;
        // Prise d'air du capot (GT), plus sombre.
        else if (kind === 'gtr' && zr > 0.9 && x > 8 && x < 17 && Math.abs(y) < 5) c = [main[0] * 0.7, main[1] * 0.7, main[2] * 0.7];
        return { p: [x, y, z], c };
      }),
      paint,
    ),
  );

  // ----- Habitacle vitré -----
  const roofAt = (x: number) => {
    const up = Math.min(smooth((x - s.cabRear) / s.rw), smooth((s.cabFront - x) / s.ws));
    return s.zBelt + (s.roof - s.zBelt) * Math.sqrt(up);
  };
  const xB = (s.cabRear + s.rw + s.cabFront - s.ws) / 2;
  const CI = 60, CJ = 48;
  car.add(
    new THREE.Mesh(
      loft(CI, CJ, (i, j) => {
        const x = s.cabRear + ((s.cabFront - s.cabRear) * i) / (CI - 1);
        const t = (j / CJ) * Math.PI * 2;
        const zb = s.zBelt - 1.2, zt = roofAt(x);
        const mid = (zb + zt) / 2, hh = (zt - zb) / 2;
        const zr = se(Math.sin(t), 6);
        const z = mid + hh * zr;
        const rel = (z - s.zBelt) / Math.max(0.01, s.roof - s.zBelt);
        const w = s.hw - 1.1 - 2.6 * Math.max(0, rel);
        const y = w * se(Math.cos(t), 6);
        const sloped = x < s.cabRear + s.rw * 0.92 || x > s.cabFront - s.ws * 0.92;
        const top = Math.sin(t) > 0.93;
        const side = Math.abs(Math.cos(t)) > 0.72;
        let c: RGB = main;
        if (top) c = sloped ? GLASS : main;
        else if (side && rel > 0.1 && rel < 0.86 && Math.abs(x - xB) > 0.7 && x > s.cabRear + 1 && x < s.cabFront - 1) c = GLASS;
        if (kind === 'muscle' && contrast && top && !sloped && Math.abs(y) > 0.8 && Math.abs(y) < 2.8) c = accent;
        return { p: [x, y, z], c };
      }),
      paint,
    ),
  );

  // ----- Roues -----
  const wheelY = kind === 'monster' ? s.hw + 2 : width(wheelX[0]) - 0.8;
  const tyreW = kind === 'monster' ? 5 : 3;
  const tyreGeo = new THREE.CylinderGeometry(s.wheelR, s.wheelR, tyreW, 28);
  const rimGeo = new THREE.CylinderGeometry(s.wheelR * 0.62, s.wheelR * 0.62, 0.3, 24);
  const hubGeo = new THREE.CylinderGeometry(s.wheelR * 0.18, s.wheelR * 0.18, 0.4, 12);
  const tyreMat = matte(TYRE, 0.9);
  const rimMat = kind === 'gtr' || kind === 'drift' ? matte(0x3a3d46, 0.35, 0.8) : matte(0xc9ccd4, 0.25, 0.9);
  const hubMat = matte(0x222226, 0.5, 0.6);
  for (const wx of wheelX) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tyreGeo, tyreMat));
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = (side * tyreW) / 2;
      wheel.add(rim);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.y = (side * tyreW) / 2 + side * 0.1;
      wheel.add(hub);
      wheel.position.set(wx, side * wheelY, s.wheelR);
      car.add(wheel);
    }
  }

  const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    car.add(m);
    return m;
  };
  /** Abscisse de la face avant (sign = 1) ou arrière (−1) à la hauteur latérale y. */
  const endX = (y: number, sign: number) => {
    let x = half;
    while (x > 0 && width(sign * x) < Math.abs(y)) x -= 0.05;
    return sign * x;
  };
  const paintMat = new THREE.MeshPhysicalMaterial({ color: toLin(main), metalness: 0.15, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.05, envMap, envMapIntensity: 0.55 });
  const darkMat = matte(0x101012, 0.6, 0.2);

  // ----- Phares, calandre, feux -----
  const lightZ = s.zNose - 1.6;
  for (const side of [-1, 1]) {
    const y = side * s.hw * 0.66;
    box(0.6, s.hw * 0.42, 1.1, glow(HEAD), endX(y, 1) - 0.15, y, lightZ);
  }
  box(0.6, s.hw * 0.7, 1.8, darkMat, endX(0, 1) - 0.1, 0, s.clearance + 2.2);
  const tailZ = s.zTail - 1.7;
  for (const side of [-1, 1]) {
    if (kind === 'gtr') {
      // Deux paires de feux ronds.
      for (const k of [0.5, 0.78]) {
        const y = side * s.hw * k;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.5, 16), glow(TAIL));
        disc.rotation.z = Math.PI / 2;
        disc.position.set(endX(y, -1) + 0.1, y, tailZ);
        car.add(disc);
      }
    } else {
      const y = side * s.hw * 0.68;
      box(0.6, s.hw * 0.46, 1.1, glow(TAIL), endX(y, -1) + 0.15, y, tailZ);
    }
  }
  // Pare-chocs chromés (américaine, berline) ou noirs.
  const bumper = kind === 'muscle' || kind === 'sedan' ? matte(CHROME, 0.15, 1) : darkMat;
  for (const sign of [-1, 1]) box(0.8, s.hw * 1.6, 1, bumper, endX(0, sign) - sign * 0.35, 0, s.clearance + 0.8);

  // ----- Rétroviseurs -----
  for (const side of [-1, 1]) box(1.2, 1.6, 1, paintMat, s.cabFront - s.ws * 0.75, side * (s.hw - 0.2), s.zBelt + 1.2);

  // ----- Aileron, becquet, prise d'air -----
  const wingMat = twoTone || kind === 'gtr' ? darkMat : new THREE.MeshPhysicalMaterial({ color: toLin(accent), roughness: 0.4, clearcoat: 1, envMap });
  if (s.wing === 'gt') {
    const zw = s.zTail + 4.5, xw = -half + 2.6;
    box(3.6, s.hw * 2 + 0.6, 0.55, wingMat, xw, 0, zw, -0.12);
    for (const side of [-1, 1]) box(3.4, 0.4, 2, darkMat, xw, side * (s.hw + 0.3), zw - 0.4);
    for (const side of [-1, 1]) box(1.4, 0.5, zw - s.zTail, darkMat, xw + 0.6, side * 6.5, (zw + s.zTail) / 2 - 0.3);
  } else if (s.wing === 'ducktail') {
    box(4, s.hw * 1.5, 1.1, paintMat, -half + 3.2, 0, s.zTail + 0.3, 0.25);
  } else if (s.wing === 'lip') {
    box(1.6, s.hw * 1.6, 0.6, paintMat, -half + 1.6, 0, s.zTail + 0.1);
  }
  if (kind === 'hatch') box(2.5, s.hw * 1.5, 0.5, paintMat, s.cabRear + 1, 0, s.roof + 0.1);
  if (kind === 'muscle') box(6, 4.5, 1.2, darkMat, 9, 0, topAt(9) + 0.3);
  if (kind === 'suv' || kind === 'monster') {
    // Barres de toit et roue de secours.
    for (const side of [-1, 1]) box(s.cabFront - s.cabRear - s.ws - 2, 0.6, 0.6, darkMat, (s.cabFront - s.ws + s.cabRear) / 2, side * (s.hw - 4), s.roof + 0.5);
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 2, 20), tyreMat);
    spare.rotation.z = Math.PI / 2;
    spare.position.set(-half - 0.8, 0, s.zTail - 4);
    car.add(spare);
  }

  // La hauteur affichée suit la projection du jeu (ISO_Z), plus écrasée que la vue 3D.
  car.scale.set(CAR_SCALE, CAR_SCALE, CAR_SCALE * Z_FIX);
  return car;
}

// ---------- Rendu en sprites ----------
/** Projection orthographique qui reproduit l'isométrique du jeu : sx = (x − y)·ISO, sy = (x + y)·ISO/2. */
const EL = Math.asin(0.5);
const K = ISO * Math.SQRT2;
const Z_FIX = ISO_Z / (K * Math.cos(EL));

interface Studio {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}
let studio: Studio | null | undefined;

function getStudio(): Studio | null {
  if (studio !== undefined) return studio;
  try {
    const canvas = document.createElement('canvas');
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    gl.setPixelRatio(1);
    gl.setSize(SW * RES, SH * RES, false);
    gl.setClearColor(0x000000, 0);
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 0.95;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3428, 0.7));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    // Soleil en haut à gauche de l'écran, comme les ombres du décor.
    sun.position.set(-0.6, -0.9, 1.6);
    scene.add(sun);
    // Une unité de la caméra = K pixels de jeu ; le centre de la voiture tombe sur (AX, AY).
    const camera = new THREE.OrthographicCamera(-AX / K, (SW - AX) / K, AY / K, -(SH - AY) / K, 1, 400);
    const d = new THREE.Vector3(Math.cos(EL) / Math.SQRT2, -Math.cos(EL) / Math.SQRT2, Math.sin(EL)).multiplyScalar(150);
    camera.position.copy(d);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    studio = { gl, scene, camera };
  } catch {
    studio = null;
  }
  return studio;
}

const models = new Map<number, THREE.Group>();
const sprites = new Map<number, HTMLCanvasElement>();

function renderSprite(st: Studio, carId: number, b: number): HTMLCanvasElement {
  let m = models.get(carId);
  if (!m) {
    m = buildCar(carId, st.gl);
    models.set(carId, m);
  }
  st.scene.add(m);
  // Le monde du jeu a l'axe y vers le bas : un cap `a` y devient une rotation de −a.
  m.rotation.z = -(b / ANGLES) * Math.PI * 2;
  st.gl.render(st.scene, st.camera);
  st.scene.remove(m);
  const s = document.createElement('canvas');
  s.width = SW * RES;
  s.height = SH * RES;
  s.getContext('2d')!.drawImage(st.gl.domElement, 0, 0);
  sprites.set(carId * ANGLES + b, s);
  return s;
}

/**
 * Angles qui restent à rendre, traités en tâche de fond (un par tour de boucle) pour ne pas
 * saccader la course ; en attendant, on affiche l'angle déjà prêt le plus proche.
 */
const pending: number[] = [];
let pumping = false;
function pump(): void {
  const st = getStudio();
  const key = pending.shift();
  if (!st || key === undefined) {
    pumping = false;
    return;
  }
  if (!sprites.has(key)) renderSprite(st, Math.floor(key / ANGLES), key % ANGLES);
  setTimeout(pump, 0);
}

const warmed = new Set<number>();

function spriteFor(carId: number, a: number, warm: boolean): HTMLCanvasElement | null {
  if (!atlas.complete || !atlas.naturalWidth) return null;
  const st = getStudio();
  if (!st) return null;
  const b = ((Math.round((a / (Math.PI * 2)) * ANGLES) % ANGLES) + ANGLES) % ANGLES;
  const s = sprites.get(carId * ANGLES + b);
  if (s) return s;
  if (warm && !warmed.has(carId)) {
    // Première apparition en jeu : cet angle tout de suite, les autres en fond.
    warmed.add(carId);
    for (let k = 1; k < ANGLES; k++) pending.push(carId * ANGLES + ((b + k) % ANGLES));
    if (!pumping) {
      pumping = true;
      setTimeout(pump, 0);
    }
    return renderSprite(st, carId, b);
  }
  if (!warm) return renderSprite(st, carId, b);
  for (let d = 1; d <= ANGLES / 2; d++) {
    const near = sprites.get(carId * ANGLES + ((b + d) % ANGLES)) ?? sprites.get(carId * ANGLES + ((b - d + ANGLES) % ANGLES));
    if (near) return near;
  }
  return renderSprite(st, carId, b);
}

/**
 * Dessine une voiture. (sx, sy) : position (en pixels de jeu) du point au sol sous le centre
 * de la voiture, `a` : cap dans le monde, `lean` : roulis (−1..1, la caisse penche vers l'extérieur).
 */
export function drawIsoCar(ctx: CanvasRenderingContext2D, carId: number, a: number, sx: number, sy: number, lean = 0, scale = 1, warm = true): void {
  const s = spriteFor(carId, a, warm);
  if (!s) {
    ctx.fillStyle = CARS[carId]?.color ?? '#f0f';
    ctx.fillRect(sx - 10, sy - 10, 20, 10);
    return;
  }
  const ox = -Math.sin(a) * lean * 1.2 * ISO;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s, sx - AX * scale + ox, sy - AY * scale, SW * scale, SH * scale);
  ctx.imageSmoothingEnabled = smoothing;
}

// ---------- Vignettes des menus ----------
export const THUMB_W = 72;
export const THUMB_H = 52;
/** Nombre de lignes de la planche des vignettes. */
export const THUMB_ROWS = Math.ceil(CARS.length / 4);
/** Définition de la planche des vignettes (pixels par pixel de vignette). */
const THUMB_RES = 3;
let thumbUrl = '';

/** Planche des voitures (4 par ligne), pour les vignettes des menus. */
export function thumbAtlasUrl(): string {
  if (thumbUrl) return thumbUrl;
  if (!atlas.complete || !atlas.naturalWidth) return atlasUrl;
  const c = document.createElement('canvas');
  c.width = THUMB_W * 4 * THUMB_RES;
  c.height = THUMB_H * THUMB_ROWS * THUMB_RES;
  const g = c.getContext('2d')!;
  g.scale(THUMB_RES, THUMB_RES);
  for (let id = 0; id < CARS.length; id++) {
    const x = (id % 4) * THUMB_W + THUMB_W / 2, y = Math.floor(id / 4) * THUMB_H + THUMB_H / 2 + 8;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x, y, 19, 8, 0, 0, Math.PI * 2);
    g.fill();
    drawIsoCar(g, id, -0.45, x, y, 0, 1.25, false);
  }
  thumbUrl = c.toDataURL();
  return thumbUrl;
}

export const isoReady = new Promise<void>((res) => {
  if (atlas.complete && atlas.naturalWidth) res();
  else atlas.addEventListener('load', () => res(), { once: true });
});
