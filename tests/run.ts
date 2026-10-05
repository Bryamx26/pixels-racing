/** Tests headless de la simulation : `npm test`. */
import { CAR_WIDTH, ROAD_WIDTH, TICK_RATE, WALL_DIST } from '../src/shared/constants';
import { packInput, unpackInput } from '../src/shared/input';
import { wrapAngle } from '../src/shared/math';
import { stepCar } from '../src/shared/cars/physics';
import { Race, gridPose, standings, formatTime } from '../src/shared/race/race';
import { TRACKS } from '../src/shared/track/tracks';
import { getTrack, wrapIdx } from '../src/shared/track/track';
import { CARS } from '../src/shared/cars/carAtlas';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

test('une voiture fait 1/4 de la largeur de la chaussée', () => {
  assert(Math.abs(CAR_WIDTH * 4 - ROAD_WIDTH) < 1e-9, `${CAR_WIDTH} × 4 ≠ ${ROAD_WIDTH}`);
});

test('16 voitures dans l\'atlas', () => assert(CARS.length === 16, `${CARS.length}`));

for (const def of TRACKS) {
  const t = getTrack(def.id);
  test(`${def.name} : les portions de piste ne se touchent pas`, () => {
    const minArc = Math.ceil((WALL_DIST * 4) / 8);
    let worst = Infinity;
    for (let i = 0; i < t.n; i += 2) {
      for (let j = 0; j < t.n; j += 2) {
        const arc = Math.min(Math.abs(i - j), t.n - Math.abs(i - j));
        if (arc < minArc) continue;
        worst = Math.min(worst, Math.hypot(t.xs[i] - t.xs[j], t.ys[i] - t.ys[j]));
      }
    }
    assert(worst > 2 * WALL_DIST + 20, `distance mini ${worst.toFixed(0)} ≤ ${2 * WALL_DIST + 20}`);
  });
  test(`${def.name} : virages assez larges pour le mur intérieur`, () => {
    let minR = Infinity;
    for (let i = 0; i < t.n; i++) {
      const k = wrapIdx(t, i + 4);
      const da = Math.abs(wrapAngle(Math.atan2(t.tys[k], t.txs[k]) - Math.atan2(t.tys[i], t.txs[i])));
      if (da > 1e-4) minR = Math.min(minR, 32 / da);
    }
    assert(minR > WALL_DIST * 1.05, `rayon mini ${minR.toFixed(0)}`);
  });
  test(`${def.name} : le circuit tient dans l'image`, () => {
    for (let i = 0; i < t.n; i++) {
      assert(
        t.xs[i] > WALL_DIST + 20 && t.ys[i] > WALL_DIST + 20 && t.xs[i] < def.width - WALL_DIST - 20 && t.ys[i] < def.height - WALL_DIST - 20,
        `échantillon ${i} hors image (${t.xs[i].toFixed(0)}, ${t.ys[i].toFixed(0)})`,
      );
    }
  });
  test(`${def.name} : 8 bots bouclent 3 tours`, () => {
    const race = new Race(def.id, 3, Array.from({ length: 8 }, (_, i) => ({ id: 'b' + i, name: 'Bot', carId: i, bot: true })), 3);
    const none = new Map();
    let ticks = 0;
    while (race.state.phase !== 'done' && ticks < TICK_RATE * 60 * 6) {
      race.step(none);
      ticks++;
    }
    const st = standings(race.state);
    const finished = st.filter((r) => r.finishTick >= 0).length;
    console.log(
      `       vainqueur ${formatTime(st[0].finishTick - 180)}, meilleur tour ${formatTime(Math.min(...st.map((r) => r.bestLap || 1e9)))}, ${finished}/8 arrivés, longueur ${t.length.toFixed(0)}`,
    );
    assert(finished === 8, `${finished}/8 arrivés`);
  });
}

test('la grille place 8 voitures sans chevauchement', () => {
  const t = getTrack('neon');
  const poses = Array.from({ length: 8 }, (_, i) => gridPose(t, i));
  for (let i = 0; i < 8; i++)
    for (let j = i + 1; j < 8; j++) assert(Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y) > CAR_WIDTH, `${i}/${j}`);
});

test('gaz à fond en ligne droite : la voiture accélère puis plafonne', () => {
  const t = getTrack('neon');
  const b = gridPose(t, 0);
  const speeds: number[] = [];
  for (let i = 0; i < 240; i++) {
    stepCar(b, { throttle: 1, brake: 0, steer: 0 }, t, 1 / 60);
    speeds.push(Math.hypot(b.vx, b.vy));
  }
  assert(speeds[59] > 200, `après 1 s : ${speeds[59].toFixed(0)}`);
  assert(speeds[239] < 480, `vitesse max ${speeds[239].toFixed(0)}`);
});

test('freiner à grande vitesse fait déraper, freiner lentement non', () => {
  const t = getTrack('neon');
  const b = gridPose(t, 0);
  for (let i = 0; i < 150; i++) stepCar(b, { throttle: 1, brake: 0, steer: 0 }, t, 1 / 60);
  assert(stepCar(b, { throttle: 0, brake: 1, steer: 0.5 }, t, 1 / 60).drift, 'pas de dérapage à pleine vitesse');
  const c = gridPose(t, 1);
  for (let i = 0; i < 20; i++) stepCar(c, { throttle: 1, brake: 0, steer: 0 }, t, 1 / 60);
  assert(!stepCar(c, { throttle: 0, brake: 1, steer: 0.5 }, t, 1 / 60).drift, 'dérapage à basse vitesse');
});

test('les commandes réseau se décodent et sont bornées', () => {
  const p = packInput(5, { throttle: 1, brake: 0, steer: -0.5 });
  const u = unpackInput(p)!;
  assert(u.seq === 5 && u.input.steer === -0.5, JSON.stringify(u));
  assert(unpackInput([1, 500, 0, -900])!.input.steer === -1, 'borne');
  assert(unpackInput(['x']) === null && unpackInput([1, NaN, 0, 0]) === null, 'invalide');
});

if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
