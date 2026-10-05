/** Tests headless de la simulation : `npm test`. */
import { CAR_WIDTH, ROAD_WIDTH, TICK_RATE } from '../src/shared/constants';
import { packInput, unpackInput } from '../src/shared/input';
import { draftFactor, stepCar } from '../src/shared/cars/physics';
import { Race, gridPose, standings, formatTime } from '../src/shared/race/race';
import { EDITOR_TEMPLATE, TRACKS, customTrackDef } from '../src/shared/track/tracks';
import { getTrack, nearestSample } from '../src/shared/track/track';
import { CARS } from '../src/shared/cars/carAtlas';
import { validateTrack } from '../src/shared/track/validate';

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
  test(`${def.name} : circuit jouable (pas de chevauchement, virages, terrain)`, () => {
    const problems = validateTrack(def, t);
    assert(problems.length === 0, problems.map((p) => `${p.message} (${p.at.map(Math.round)})`).join(', '));
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

test('la voiture met un instant à tourner (inertie) et sous-vire à pleine vitesse', () => {
  const t = getTrack('neon');
  const b = gridPose(t, 0);
  for (let i = 0; i < 200; i++) stepCar(b, { throttle: 1, brake: 0, steer: 0 }, t, 1 / 60);
  stepCar(b, { throttle: 1, brake: 0, steer: 1 }, t, 1 / 60);
  const first = Math.abs(b.w);
  for (let i = 0; i < 20; i++) stepCar(b, { throttle: 1, brake: 0, steer: 1 }, t, 1 / 60);
  assert(first < Math.abs(b.w) * 0.4, `rotation immédiate ${first.toFixed(2)} vs ${b.w.toFixed(2)}`);
  const sp = Math.hypot(b.vx, b.vy);
  assert(Math.abs(b.w) * sp <= 1050 * 1.05, `accélération latérale ${(Math.abs(b.w) * sp).toFixed(0)}`);
});

test("l'aspiration fait aller plus vite derrière une voiture", () => {
  const t = getTrack('neon');
  const run = (withLeader: boolean) => {
    const me = gridPose(t, 0);
    const lead = { ...me, x: me.x + Math.cos(me.a) * 120, y: me.y + Math.sin(me.a) * 120 };
    let total = 0;
    for (let i = 0; i < 90; i++) {
      // Meneur imaginaire toujours 120 devant, à la même vitesse.
      lead.x = me.x + Math.cos(me.a) * 120;
      lead.y = me.y + Math.sin(me.a) * 120;
      lead.vx = me.vx;
      lead.vy = me.vy;
      const d = withLeader ? draftFactor(me, [lead], t.n) : 0;
      if (withLeader && i >= 60) total += d;
      stepCar(me, { throttle: 1, brake: 0, steer: 0 }, t, 1 / 60, { draft: d });
    }
    return { speed: Math.hypot(me.vx, me.vy), draft: total / 30 };
  };
  const solo = run(false), drafted = run(true);
  assert(drafted.draft > 0.4, `aspiration ${drafted.draft.toFixed(2)}`);
  assert(drafted.speed > solo.speed + 8, `${drafted.speed.toFixed(0)} vs ${solo.speed.toFixed(0)}`);
});

test('les commandes réseau se décodent et sont bornées', () => {
  const p = packInput(5, { throttle: 1, brake: 0, steer: -0.5 });
  const u = unpackInput(p)!;
  assert(u.seq === 5 && u.input.steer === -0.5, JSON.stringify(u));
  assert(unpackInput([1, 500, 0, -900])!.input.steer === -1, 'borne');
  assert(unpackInput(['x']) === null && unpackInput([1, NaN, 0, 0]) === null, 'invalide');
});

/** Lance une voiture en ligne droite sur `ticks` et rend sa vitesse finale. */
function straightRun(setup: (b: ReturnType<typeof gridPose>) => void, inp: { boost?: boolean }, damage = false, ticks = 150) {
  const t = getTrack('neon');
  const b = gridPose(t, 0);
  setup(b);
  for (let i = 0; i < ticks; i++) stepCar(b, { throttle: 1, brake: 0, steer: 0, ...inp }, t, 1 / 60, { damage });
  return { b, speed: Math.hypot(b.vx, b.vy) };
}

test('le turbo se déclenche avec une jauge pleine et accélère', () => {
  const plain = straightRun(() => {}, {});
  const boosted = straightRun((b) => (b.boost = 1), { boost: true });
  const empty = straightRun((b) => (b.boost = 0.1), { boost: true });
  assert(boosted.speed > plain.speed + 25, `${boosted.speed.toFixed(0)} vs ${plain.speed.toFixed(0)}`);
  assert(Math.abs(empty.speed - plain.speed) < 1, 'jauge trop basse : pas de turbo');
});

test('une voiture abîmée va moins vite', () => {
  const ok = straightRun(() => {}, {}, true, 200);
  const hurt = straightRun((b) => (b.damage = 1), {}, true, 200);
  assert(hurt.speed < ok.speed * 0.85, `${hurt.speed.toFixed(0)} vs ${ok.speed.toFixed(0)}`);
});

function soloRace(options = { items: true, damage: true }) {
  const race = new Race('neon', 3, [{ id: 'me', name: 'Moi', carId: 0, bot: false }], 1, options);
  const idle = new Map([['me', { throttle: 0, brake: 0, steer: 0 }]]);
  while (race.state.phase === 'countdown') race.step(idle);
  return { race, me: race.state.racers[0], idle };
}

test('les boîtes donnent un objet, et sans objets il n\'y en a pas', () => {
  const { race, me, idle } = soloRace();
  const p = race.state.pickups[0];
  assert(race.state.pickups.length > 0, 'aucune boîte');
  me.x = p.x;
  me.y = p.y;
  me.idx = nearestSample(race.track, p.x, p.y);
  race.step(idle);
  assert(me.item !== null && p.respawn > 0, 'objet non ramassé');
  assert(soloRace({ items: false, damage: true }).race.state.pickups.length === 0, 'boîtes présentes sans objets');
});

test("l'huile fait partir en tête-à-queue, le bouclier protège", () => {
  for (const shielded of [false, true]) {
    const { race, me, idle } = soloRace();
    me.shield = shielded ? 300 : 0;
    race.state.oils.push({ x: me.x, y: me.y, owner: 'autre', armed: 0, until: race.state.tick + 600 });
    race.step(idle);
    assert(shielded ? me.spin === 0 : me.spin > 0, shielded ? 'bouclier inefficace' : 'pas de tête-à-queue');
  }
});

test('le nitro se déclenche à l\'appui du bouton objet', () => {
  const { race, me } = soloRace();
  me.item = 'nitro';
  race.step(new Map([['me', { throttle: 1, brake: 0, steer: 0, item: true }]]));
  assert(me.item === null && me.boostTicks > 0, 'nitro non utilisé');
});

test("le modèle de l'éditeur est un circuit valide", () => {
  const problems = validateTrack(customTrackDef('Test', EDITOR_TEMPLATE));
  assert(problems.length === 0, problems.map((p) => p.message).join(', '));
});

if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
