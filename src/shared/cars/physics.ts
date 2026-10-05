import { CAR_LENGTH, CAR_WIDTH, KERB_WIDTH, ROAD_WIDTH, WALL_DIST } from '../constants';
import type { CarInput } from '../input';
import { clamp } from '../math';
import { lateralOffset, nearestSample, type Track } from '../track/track';
import type { CarStats } from './stats';

/** État physique d'une voiture : tout ce que la prédiction client doit rejouer. */
export interface CarBody {
  x: number;
  y: number;
  /** Cap (radians, 0 = vers +x). */
  a: number;
  vx: number;
  vy: number;
  /** Vitesse de rotation (rad/s) : la voiture met un instant à s'inscrire en virage. */
  w: number;
  /** Jauge de turbo (0..1), remplie en dérapant et dans l'aspiration. */
  boost: number;
  /** Ticks de turbo restants (> 0 : turbo en cours). */
  boostTicks: number;
  /** Ticks de tête-à-queue restants (flaque d'huile). */
  spin: number;
  /** Dégâts (0..1) : réduisent l'accélération et la vitesse de pointe. Réparés aux stands. */
  damage: number;
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
  /** Empattement : rayon de braquage d'un modèle « bicyclette ». */
  wheelbase: 36,
  /** Angle de braquage maximal des roues (rad), réduit à haute vitesse. */
  maxSteer: 0.6,
  /** Accélération latérale maximale avant que les pneus glissent (sous-virage). */
  lateralGrip: 1050,
  /** Réactivité du châssis : vitesse à laquelle la rotation rejoint la consigne. */
  yawResponse: 9,
  /** Aspiration : gain d'accélération et de vitesse de pointe derrière une voiture. */
  draftAccel: 0.45,
  draftTopSpeed: 0.1,
  /** Zone d'aspiration derrière une voiture (distance, largeur). */
  draftLength: 280,
  /** Turbo : durée d'une jauge pleine (ticks), gains, remplissage par seconde. */
  boostTicksFull: 100,
  boostAccel: 0.9,
  boostTopSpeed: 0.22,
  boostFillDrift: 0.4,
  boostFillDraft: 0.3,
  /** Jauge minimale pour déclencher le turbo. */
  boostMin: 0.25,
  /** Perte de performances à 100 % de dégâts. */
  damageTop: 0.25,
  damageAccel: 0.25,
  grassMaxSpeed: 200,
  grassDrag: 3,
};

/** Une voiture roule dans l'herbe quand son centre dépasse les vibreurs. */
export const OFFROAD_DIST = ROAD_WIDTH / 2 + KERB_WIDTH;
const WALL_LIMIT = WALL_DIST - CAR_WIDTH / 2;

export interface StepMods {
  /** Aspiration reçue (0..1), calculée par draftFactor. */
  draft?: number;
  stats?: CarStats;
  /** Les chocs abîment la voiture. */
  damage?: boolean;
}

export interface StepResult {
  wall: boolean;
  wallPower: number;
  offroad: boolean;
  drift: boolean;
  boostStarted: boolean;
  boosting: boolean;
}

const NEUTRAL: CarStats = { accel: 1, top: 1, grip: 1, mass: 1 };

export function newBody(x: number, y: number, a: number, idx: number, prog: number): CarBody {
  return { x, y, a, vx: 0, vy: 0, w: 0, boost: 0, boostTicks: 0, spin: 0, damage: 0, idx, prog };
}

export function speedOf(b: CarBody): number {
  return Math.hypot(b.vx, b.vy);
}

/** Vitesse longitudinale (positive en marche avant). */
export function forwardSpeed(b: CarBody): number {
  return b.vx * Math.cos(b.a) + b.vy * Math.sin(b.a);
}

/** Avance une voiture d'un pas (`dt` s). */
export function stepCar(b: CarBody, inp: CarInput, track: Track, dt: number, mods: StepMods = {}): StepResult {
  const draft = mods.draft ?? 0;
  const st = mods.stats ?? NEUTRAL;
  const cos = Math.cos(b.a), sin = Math.sin(b.a);
  let vf = b.vx * cos + b.vy * sin;
  let vr = -b.vx * sin + b.vy * cos;
  const offroad = Math.abs(lateralOffset(track, b.idx, b.x, b.y)) > OFFROAD_DIST;

  // Tête-à-queue sur l'huile : plus de commandes le temps de reprendre la main.
  const spinning = b.spin > 0;
  if (spinning) {
    b.spin--;
    inp = { throttle: 0, brake: 0, steer: 0 };
  }
  // Coup de frein lancé à grande vitesse : l'arrière décroche et la voiture dérape.
  const drift = !spinning && inp.brake > 0.05 && vf > CAR.driftSpeed;

  // Turbo : la jauge se vide d'un coup en temps de turbo.
  let boostStarted = false;
  if (inp.boost && b.boostTicks <= 0 && b.boost >= CAR.boostMin && !spinning) {
    b.boostTicks = Math.round(b.boost * CAR.boostTicksFull);
    b.boost = 0;
    boostStarted = true;
  }
  const boosting = b.boostTicks > 0;
  if (boosting) b.boostTicks--;
  else b.boost = Math.min(1, b.boost + ((drift ? CAR.boostFillDrift : 0) + draft * CAR.boostFillDraft) * dt);

  const dmg = b.damage;
  const accelMul =
    st.accel * (1 + CAR.draftAccel * draft + (boosting ? CAR.boostAccel : 0)) * (1 - CAR.damageAccel * dmg);
  const topMul =
    st.top * (1 + CAR.draftTopSpeed * draft + (boosting ? CAR.boostTopSpeed : 0)) * (1 - CAR.damageTop * dmg);

  // Moteur, frein, marche arrière.
  if (inp.brake > 0.05) {
    if (vf > 10) vf = Math.max(0, vf - CAR.brake * inp.brake * dt);
    else vf = Math.max(-CAR.reverseMax, vf - CAR.reverseAccel * inp.brake * dt);
  } else if (inp.throttle > 0.05 || boosting) {
    const r = clamp(vf / (CAR.maxSpeed * topMul), 0, 1);
    vf += CAR.accel * accelMul * Math.max(inp.throttle, boosting ? 1 : 0) * (1 - r * r) * dt;
  }
  // Frottements : roulement constant + traînée proportionnelle (moins d'air dans l'aspiration).
  const roll = Math.min(Math.abs(vf), CAR.rolling * dt);
  vf -= Math.sign(vf) * roll;
  vf *= 1 - CAR.drag * (1 - 0.6 * draft) * dt;
  if (offroad && Math.abs(vf) > CAR.grassMaxSpeed) vf -= (vf - Math.sign(vf) * CAR.grassMaxSpeed) * CAR.grassDrag * dt;
  if (spinning) vf *= 1 - 1.2 * dt;

  // Direction (modèle bicyclette) : le rayon de braquage dépend de l'angle des roues,
  // qui se réduit à haute vitesse ; les pneus limitent l'accélération latérale
  // (la voiture élargit sa trajectoire si on arrive trop vite : sous-virage).
  const sp = Math.abs(vf);
  const steerAngle = inp.steer * CAR.maxSteer * (1 - 0.45 * clamp(sp / CAR.maxSpeed, 0, 1));
  let target = (vf * Math.tan(steerAngle)) / CAR.wheelbase;
  const gripMul = (drift ? 1.6 : offroad ? 0.6 : 1) * st.grip;
  const maxYaw = (CAR.lateralGrip * gripMul) / Math.max(sp, 1);
  target = clamp(target, -maxYaw, maxYaw) * (drift ? 1.3 : 1);
  // Inertie : la rotation rejoint la consigne progressivement (et plus lentement en glisse).
  if (spinning) b.w += (Math.sign(b.w || 1) * 9 - b.w) * Math.min(1, 6 * dt);
  else b.w += (target - b.w) * Math.min(1, CAR.yawResponse * (drift ? 0.5 : 1) * dt);
  // Adhérence : la vitesse latérale disparaît vite, sauf en dérapage (et presque plus sur l'huile).
  const lateral = spinning ? CAR.grip * 0.15 : drift ? CAR.driftGrip : offroad ? CAR.grip * 0.6 : CAR.grip * st.grip;
  vr *= Math.exp(-lateral * dt);

  b.vx = vf * cos - vr * sin;
  b.vy = vf * sin + vr * cos;
  b.a += b.w * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Mur de pneus : on replace la voiture et on annule la vitesse sortante (léger rebond).
  b.idx = nearestSample(track, b.x, b.y, b.idx);
  let wall = false;
  let wallPower = 0;
  const lat = lateralOffset(track, b.idx, b.x, b.y);
  if (Math.abs(lat) > WALL_LIMIT) {
    wall = true;
    const nx = -track.tys[b.idx] * Math.sign(lat), ny = track.txs[b.idx] * Math.sign(lat);
    const over = Math.abs(lat) - WALL_LIMIT;
    b.x -= nx * over;
    b.y -= ny * over;
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      wallPower = vn;
      if (mods.damage && vn > 80) b.damage = Math.min(1, b.damage + vn / 2600 / st.mass);
      b.w *= 0.5;
      b.vx -= nx * vn * 1.3;
      b.vy -= ny * vn * 1.3;
      b.vx *= 0.92;
      b.vy *= 0.92;
    }
  }
  return { wall, wallPower, offroad, drift, boostStarted, boosting };
}

/** Les voitures interagissent seulement si elles sont sur la même portion de piste (pas sous un pont). */
export function samePortion(p: CarBody, q: CarBody, n: number): boolean {
  const d = Math.abs(p.idx - q.idx);
  return Math.min(d, n - d) < 40;
}

/**
 * Aspiration (0..1) : la voiture `b` roule dans le sillage d'une autre, juste devant elle,
 * dans le même axe. Plus elle est proche (et rapide), plus l'effet est fort.
 */
export function draftFactor(b: CarBody, others: readonly CarBody[], n: number): number {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 150) return 0;
  const fx = b.vx / sp, fy = b.vy / sp;
  let best = 0;
  for (const o of others) {
    if (o === b || !samePortion(b, o, n)) continue;
    const dx = o.x - b.x, dy = o.y - b.y;
    const ahead = dx * fx + dy * fy;
    if (ahead < CAR_LENGTH * 0.8 || ahead > CAR.draftLength) continue;
    const side = Math.abs(-dx * fy + dy * fx);
    if (side > CAR_WIDTH * 1.1) continue;
    // Le meneur doit aller à peu près dans le même sens et assez vite.
    const osp = Math.hypot(o.vx, o.vy);
    if (osp < 120 || (o.vx * fx + o.vy * fy) / osp < 0.8) continue;
    const f = (1 - (ahead - CAR_LENGTH) / CAR.draftLength) * (1 - side / (CAR_WIDTH * 1.4));
    best = Math.max(best, clamp(f, 0, 1));
  }
  return best;
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

/** Collision entre deux voitures (masses mp, mq). Renvoie la force du choc (0 si aucun contact). */
export function collideCars(p: CarBody, q: CarBody, n: number, mp = 1, mq = 1): number {
  if (!samePortion(p, q, n)) return 0;
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
  // La voiture la plus lourde est moins déplacée.
  const sp = mq / (mp + mq), sq = mp / (mp + mq);
  p.x -= nx * best * sp;
  p.y -= ny * best * sp;
  q.x += nx * best * sq;
  q.y += ny * best * sq;
  const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
  if (rel >= 0) return 0;
  const j = (-(1 + 0.35) * rel) / (1 / mp + 1 / mq);
  p.vx -= (nx * j) / mp;
  p.vy -= (ny * j) / mp;
  q.vx += (nx * j) / mq;
  q.vy += (ny * j) / mq;
  return -rel;
}
