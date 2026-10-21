import { DT } from '../constants';
import { NO_INPUT, type CarInput } from '../input';
import { collideCars, draftFactor, newBody, stepDynamics, type CarBody } from '../cars/physics';
import { carStats } from '../cars/stats';
import { getWorld, surfPhysics, type World } from './world';

/** Une voiture en balade libre. */
export interface RoamCar extends CarBody {
  id: string;
  name: string;
  carId: number;
  drift: boolean;
  offroad: boolean;
  draft: number;
}

export interface RoamState {
  tick: number;
  cars: RoamCar[];
}

export type RoamEvent =
  | { type: 'bump'; x: number; y: number; power: number }
  | { type: 'wall'; id: string; power: number; x: number; y: number }
  | { type: 'boost'; id: string };

/** Avance une voiture d'un pas dans le monde : dynamique, revêtement, décor. */
export function stepRoamCar(world: World, b: CarBody, inp: CarInput, carId: number, draft: number): { wall: number; drift: boolean; offroad: boolean; boostStarted: boolean } {
  const surf = surfPhysics(world.surfAt(b.x, b.y));
  const mods = { draft, stats: carStats(carId), damage: false };
  const res = stepDynamics(b, inp, DT, mods, surf.offroad, surf.grip);
  const wall = world.collide(b, mods);
  return { wall, drift: res.drift, offroad: res.offroad, boostStarted: res.boostStarted };
}

/**
 * Monde ouvert partagé : des joueurs arrivent et repartent quand ils veulent, sans course.
 * Utilisé par le serveur (en ligne) et par le client (balade en solo).
 */
export class Roam {
  readonly world: World = getWorld();
  readonly state: RoamState = { tick: 0, cars: [] };

  add(id: string, name: string, carId: number, spawnId = 'festival'): RoamCar {
    const sp = this.world.layout.spawns.find((s) => s.id === spawnId) ?? this.world.layout.spawns[0];
    const car: RoamCar = { ...newBody(sp.x, sp.y, sp.a, 0, 0), id, name, carId, drift: false, offroad: false, draft: 0 };
    this.place(car, sp.x, sp.y, sp.a);
    this.state.cars.push(car);
    return car;
  }

  remove(id: string): void {
    this.state.cars = this.state.cars.filter((c) => c.id !== id);
  }

  get(id: string): RoamCar | undefined {
    return this.state.cars.find((c) => c.id === id);
  }

  /** Pose une voiture à l'arrêt, décalée si la place est prise par une autre voiture. */
  place(car: RoamCar, x: number, y: number, a: number): void {
    const side = -Math.sin(a), fwd = Math.cos(a), fy = Math.sin(a), sy = Math.cos(a);
    for (let k = 0; k < 12; k++) {
      const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
      const px = x + side * off * 36 - fwd * Math.floor(k / 4) * 60, py = y + sy * off * 36 - fy * Math.floor(k / 4) * 60;
      const busy = this.state.cars.some((o) => o !== car && Math.hypot(o.x - px, o.y - py) < 50);
      if (!busy && this.world.isFree(px, py, 20)) {
        x = px;
        y = py;
        break;
      }
    }
    Object.assign(car, { x, y, a, vx: 0, vy: 0, w: 0, spin: 0, boostTicks: 0 });
  }

  /** Voyage rapide / remise sur la route : refusé si la place n'est pas libre. */
  warp(id: string, x: number, y: number, a: number): boolean {
    const car = this.get(id);
    if (!car || !Number.isFinite(x + y + a) || !this.world.isFree(x, y, 20)) return false;
    this.place(car, x, y, a);
    return true;
  }

  step(inputs: ReadonlyMap<string, CarInput>): RoamEvent[] {
    const s = this.state;
    const events: RoamEvent[] = [];
    s.tick++;
    for (const c of s.cars) c.draft = draftFactor(c, s.cars, 1);
    for (const c of s.cars) {
      const res = stepRoamCar(this.world, c, inputs.get(c.id) ?? NO_INPUT, c.carId, c.draft);
      c.drift = res.drift;
      c.offroad = res.offroad;
      if (res.boostStarted) events.push({ type: 'boost', id: c.id });
      if (res.wall > 60) events.push({ type: 'wall', id: c.id, power: res.wall, x: c.x, y: c.y });
    }
    for (let i = 0; i < s.cars.length; i++) {
      for (let j = i + 1; j < s.cars.length; j++) {
        const p = s.cars[i], q = s.cars[j];
        if (Math.abs(p.x - q.x) > 120 || Math.abs(p.y - q.y) > 120) continue;
        const power = collideCars(p, q, 1, carStats(p.carId).mass, carStats(q.carId).mass);
        if (power > 60) events.push({ type: 'bump', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, power });
      }
    }
    return events;
  }
}
