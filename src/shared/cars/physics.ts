import { CAR_LENGTH, CAR_WIDTH, KERB_WIDTH, ROAD_WIDTH, WALL_DIST } from '../constants';
import type { CarInput } from '../input';
import { clamp } from '../math';
import { lateralOffset, nearestSample, type Track } from '../track/track';

/** État physique d'une voiture : tout ce que la prédiction client doit rejouer. */
export interface CarBody {
  x: number;
  y: number;
  /** Cap (radians, 0 = vers +x). */
  a: number;
  vx: number;
  vy: number;
  /** Échantillon de piste le plus proche. */
  idx: number;
  /** Progression « déroulée » en échantillons : tours × n + idx (négative sur la grille). */
  prog: number;
}

/** Réglages communs à toutes les voitures (vitesses en unités monde / s). */
export const CAR = {
  accel: 420,
  maxSpeed: 470,
  brake: 760,
  reverseAccel: 280,
  reverseMax: 150,
  rolling: 40,
  drag: 0.12,
  grip: 10,
  driftGrip: 2.2,
  /** Freiner au-dessus de cette vitesse fait déraper la voiture. */
  driftSpeed: 250,
  turnRate: 3.1,
  grassMaxSpeed: 200,
  grassDrag: 3,
};

/** Une voiture roule dans l'herbe quand son centre dépasse les vibreurs. */
export const OFFROAD_DIST = ROAD_WIDTH / 2 + KERB_WIDTH;
const WALL_LIMIT = WALL_DIST - CAR_WIDTH / 2;

export function speedOf(b: CarBody): number {
  return Math.hypot(b.vx, b.vy);
}

/** Vitesse longitudinale (positive en marche avant). */
export function forwardSpeed(b: CarBody): number {
  return b.vx * Math.cos(b.a) + b.vy * Math.sin(b.a);
}

/** Avance une voiture d'un pas (`dt` s) : mur touché, dans l'herbe, en dérapage. */
export function stepCar(
  b: CarBody,
  inp: CarInput,
  track: Track,
  dt: number,
): { wall: boolean; offroad: boolean; drift: boolean } {
  const cos = Math.cos(b.a), sin = Math.sin(b.a);
  let vf = b.vx * cos + b.vy * sin;
  // Coup de frein lancé à grande vitesse : l'arrière décroche et la voiture dérape.
  const drift = inp.brake > 0.05 && vf > CAR.driftSpeed;
  let vr = -b.vx * sin + b.vy * cos;
  const offroad = Math.abs(lateralOffset(track, b.idx, b.x, b.y)) > OFFROAD_DIST;

  // Moteur, frein, marche arrière.
  if (inp.brake > 0.05) {
    if (vf > 10) vf = Math.max(0, vf - CAR.brake * inp.brake * dt);
    else vf = Math.max(-CAR.reverseMax, vf - CAR.reverseAccel * inp.brake * dt);
  } else if (inp.throttle > 0.05) {
    const r = clamp(vf / CAR.maxSpeed, 0, 1);
    vf += CAR.accel * inp.throttle * (1 - r * r) * dt;
  }
  // Frottements : roulement constant + traînée proportionnelle.
  const roll = Math.min(Math.abs(vf), CAR.rolling * dt);
  vf -= Math.sign(vf) * roll;
  vf *= 1 - CAR.drag * dt;
  if (offroad && Math.abs(vf) > CAR.grassMaxSpeed) vf -= (vf - Math.sign(vf) * CAR.grassMaxSpeed) * CAR.grassDrag * dt;

  // Direction : rien à l'arrêt, un peu moins vive à pleine vitesse, inversée en marche arrière.
  const sp = Math.abs(vf);
  const turn =
    inp.steer *
    CAR.turnRate *
    clamp(sp / 90, 0, 1) *
    (1 - 0.3 * clamp(sp / CAR.maxSpeed, 0, 1)) *
    (drift ? 1.35 : 1) *
    Math.sign(vf);
  // Adhérence : la vitesse latérale disparaît vite, sauf en dérapage.
  vr *= Math.exp(-(drift ? CAR.driftGrip : offroad ? CAR.grip * 0.6 : CAR.grip) * dt);

  b.vx = vf * cos - vr * sin;
  b.vy = vf * sin + vr * cos;
  b.a += turn * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Mur de pneus : on replace la voiture et on annule la vitesse sortante (léger rebond).
  b.idx = nearestSample(track, b.x, b.y, b.idx);
  let wall = false;
  const lat = lateralOffset(track, b.idx, b.x, b.y);
  if (Math.abs(lat) > WALL_LIMIT) {
    wall = true;
    const nx = -track.tys[b.idx] * Math.sign(lat), ny = track.txs[b.idx] * Math.sign(lat);
    const over = Math.abs(lat) - WALL_LIMIT;
    b.x -= nx * over;
    b.y -= ny * over;
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      b.vx -= nx * vn * 1.3;
      b.vy -= ny * vn * 1.3;
      b.vx *= 0.92;
      b.vy *= 0.92;
    }
  }
  return { wall, offroad, drift };
}

/** Met à jour la progression déroulée à partir du nouvel échantillon. */
export function updateProgress(b: CarBody, track: Track): void {
  const cur = ((b.prog % track.n) + track.n) % track.n;
  let d = b.idx - cur;
  if (d > track.n / 2) d -= track.n;
  if (d < -track.n / 2) d += track.n;
  b.prog += d;
}

/** Centres des 3 cercles qui approchent la carrosserie (avant, milieu, arrière). */
function circles(b: CarBody): [number, number][] {
  const o = (CAR_LENGTH - CAR_WIDTH) / 2;
  const c = Math.cos(b.a) * o, s = Math.sin(b.a) * o;
  return [[b.x + c, b.y + s], [b.x, b.y], [b.x - c, b.y - s]];
}

/** Collision entre deux voitures de même masse. Renvoie la force du choc (0 si aucun contact). */
export function collideCars(p: CarBody, q: CarBody): number {
  const dx0 = q.x - p.x, dy0 = q.y - p.y;
  if (dx0 * dx0 + dy0 * dy0 > (CAR_LENGTH + CAR_WIDTH) ** 2) return 0;
  const r = CAR_WIDTH / 2;
  let best = 0, nx = 0, ny = 0;
  for (const a of circles(p)) {
    for (const c of circles(q)) {
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const d = Math.hypot(dx, dy);
      const pen = 2 * r - d;
      if (pen > best) {
        best = pen;
        nx = d > 1e-6 ? dx / d : 1;
        ny = d > 1e-6 ? dy / d : 0;
      }
    }
  }
  if (best <= 0) return 0;
  p.x -= (nx * best) / 2;
  p.y -= (ny * best) / 2;
  q.x += (nx * best) / 2;
  q.y += (ny * best) / 2;
  const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
  if (rel >= 0) return 0;
  const j = (-(1 + 0.35) * rel) / 2;
  p.vx -= nx * j;
  p.vy -= ny * j;
  q.vx += nx * j;
  q.vy += ny * j;
  return -rel;
}
