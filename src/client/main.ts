import { CARS } from '../shared/cars/carAtlas';
import { CAR } from '../shared/cars/physics';
import { COUNTDOWN_TICKS, DEFAULT_LAPS } from '../shared/constants';
import { formatTime, type Entrant, type RaceEvent } from '../shared/race/race';
import type { RoomInfo, ServerMsg } from '../shared/net/protocol';
import { TRACKS, customTrackDef, getTrackDef, isOfficialTrack, registerTrack, type TrackDef } from '../shared/track/tracks';
import { validateTrack } from '../shared/track/validate';
import { Sound } from './audio';
import { Editor, loadCustom } from './editor/editor';
import { Ghost } from './game/ghost';
import { LocalRace } from './game/localRace';
import { OnlineRace } from './game/onlineRace';
import type { RaceView } from './game/raceView';
import { Controls, isTouchDevice } from './input/controls';
import { Connection } from './net/connection';
import { fetchRecords, submitRecord } from './net/records';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import * as ui from './ui/screens';

// ---------- Préférences (localStorage, facultatif) ----------
const store = {
  get(k: string, d: string): string {
    try {
      return localStorage.getItem('pr.' + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem('pr.' + k, v);
    } catch {
      /* stockage indisponible */
    }
  },
};

const touch = isTouchDevice();
const prefs = {
  name: store.get('name', ''),
  carId: Number(store.get('car', String(Math.floor(Math.random() * CARS.length)))) % CARS.length,
  trackId: store.get('track', TRACKS[0].id),
  laps: Number(store.get('laps', String(DEFAULT_LAPS))),
  bots: Number(store.get('bots', '5')),
  items: store.get('items', '1') === '1',
  autoGas: store.get('autogas', touch ? '1' : '0') === '1',
  muted: store.get('mute', '0') === '1',
};

// ---------- Circuit perso (éditeur) ----------
let customDef: TrackDef | null = null;
function loadCustomDef(): void {
  const saved = loadCustom();
  customDef = null;
  if (!saved) return;
  const def = customTrackDef(saved.name, saved.points);
  if (validateTrack(def).length === 0) {
    registerTrack(def);
    customDef = def;
  }
}
loadCustomDef();
if (!TRACKS.some((t) => t.id === prefs.trackId) && prefs.trackId !== (customDef as TrackDef | null)?.id) prefs.trackId = TRACKS[0].id;

// ---------- Modules ----------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const touchEl = document.getElementById('touch')!;
const hudEl = document.getElementById('hud')!;
const toastEl = document.getElementById('toast')!;
const renderer = new Renderer(canvas);
const controls = new Controls(touchEl);
controls.autoGas = prefs.autoGas;
const hud = new Hud(hudEl);
const sound = new Sound();
sound.muted = prefs.muted;

let conn: Connection | null = null;
let room: RoomInfo | null = null;
let race: RaceView | null = null;
let demo: LocalRace | null = null;
let ghost: Ghost | null = null;
let editor: Editor | null = null;
let resultsShown = false;
let pauseOpen = false;
interface SoloConfig {
  trackId: string;
  laps: number;
  bots: number;
  items: boolean;
  trial: boolean;
}
let lastSolo: SoloConfig | null = null;

let toastTimer = 0;
function toast(msg: string, info = false): void {
  toastEl.textContent = msg;
  toastEl.className = 'show' + (info ? ' info' : '');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.className = ''), 2600);
}

/** Plein écran + paysage sur mobile (doit partir d'un geste de l'utilisateur). */
function goFullscreen(): void {
  sound.unlock();
  if (!touch || document.fullscreenElement) return;
  const el = document.documentElement;
  el.requestFullscreen?.({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}

// ---------- Course de démonstration en fond des menus ----------
function startDemo(): void {
  const track = TRACKS[Math.floor(Math.random() * TRACKS.length)].id;
  const entrants: Entrant[] = Array.from({ length: 6 }, (_, i) => ({ id: 'demo' + i, name: '', carId: (i * 3 + 1) % CARS.length, bot: true }));
  demo = new LocalRace(track, 99, entrants, '', controls);
  renderer.ghost = null;
  renderer.setTrack(demo.track);
}

// ---------- Écrans ----------
function readName(): string {
  const el = document.getElementById('name') as HTMLInputElement | null;
  const n = (el?.value ?? prefs.name).trim().slice(0, 12);
  prefs.name = n;
  store.set('name', n);
  return n || 'Pilote';
}

function showHome(): void {
  const params = new URLSearchParams(location.search);
  ui.show(ui.homeScreen(prefs.name, params.get('salle') ?? '', prefs.autoGas, prefs.muted), {
    name: () => readName(),
    solo: () => {
      readName();
      sound.unlock();
      showSolo(false);
    },
    trial: () => {
      readName();
      sound.unlock();
      showSolo(true);
    },
    create: () => {
      goFullscreen();
      online().send({ t: 'create', trackId: isOfficialTrack(prefs.trackId) ? prefs.trackId : TRACKS[0].id, laps: prefs.laps });
    },
    join: () => {
      const code = (document.getElementById('code') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length < 4) return toast('Entre le code de la salle.');
      goFullscreen();
      online().send({ t: 'join', code });
    },
    editor: () => {
      readName();
      openEditor();
    },
    records: () => {
      readName();
      showRecords(isOfficialTrack(prefs.trackId) ? prefs.trackId : TRACKS[0].id);
    },
    autogas: (el) => {
      prefs.autoGas = controls.autoGas = (el as HTMLInputElement).checked;
      store.set('autogas', prefs.autoGas ? '1' : '0');
    },
    mute: (el) => {
      prefs.muted = sound.muted = (el as HTMLInputElement).checked;
      store.set('mute', prefs.muted ? '1' : '0');
    },
  });
}

function pickCar(el: HTMLElement): void {
  prefs.carId = Number(el.dataset.car);
  store.set('car', String(prefs.carId));
  document.querySelectorAll('.car-pick').forEach((b) => b.classList.toggle('sel', b === el));
  document.getElementById('car-info')!.outerHTML = ui.carInfo(prefs.carId);
}

function showSolo(trial: boolean): void {
  const best = Ghost.bestTicks(prefs.trackId);
  ui.show(
    ui.soloScreen(prefs.carId, prefs.trackId, prefs.laps, prefs.bots, prefs.items, customDef, trial, best ? formatTime(best) : '--'),
    {
      car: pickCar,
      track: (el) => {
        store.set('track', (prefs.trackId = (el as HTMLSelectElement).value));
        if (trial) showSolo(true);
      },
      laps: (el) => store.set('laps', String((prefs.laps = Number((el as HTMLSelectElement).value)))),
      bots: (el) => store.set('bots', String((prefs.bots = Number((el as HTMLSelectElement).value)))),
      items: (el) => store.set('items', (prefs.items = (el as HTMLInputElement).checked) ? '1' : '0'),
      back: showHome,
      go: () => {
        goFullscreen();
        startSolo({ trackId: prefs.trackId, laps: prefs.laps, bots: trial ? 0 : prefs.bots, items: !trial && prefs.items, trial });
      },
    },
  );
}

function startSolo(cfg: SoloConfig): void {
  lastSolo = cfg;
  const others = CARS.map((c) => c.id).filter((id) => id !== prefs.carId).sort(() => Math.random() - 0.5);
  const names = ['Turbo', 'Nitro', 'Drift', 'Pistons', 'Chrome', 'Bolide', 'Rallye'];
  const entrants: Entrant[] = [
    { id: 'me', name: prefs.name || 'Pilote', carId: prefs.carId, bot: false },
    ...Array.from({ length: cfg.bots }, (_, i) => ({ id: 'bot' + i, name: names[i], carId: others[i], bot: true })),
  ];
  // Le joueur part en fond de grille : il faut remonter !
  entrants.reverse();
  const view = new LocalRace(cfg.trackId, cfg.laps, entrants, 'me', controls, { items: cfg.items, damage: !cfg.trial });
  ghost = new Ghost(cfg.trackId, 'me');
  view.onTick = (s) => ghost?.record(s);
  enterRace(view);
}

function openEditor(): void {
  ui.clear();
  editor = new Editor(
    (def) => {
      registerTrack(def);
      customDef = def;
      closeEditor();
      prefs.trackId = def.id;
      startSolo({ trackId: def.id, laps: 2, bots: 3, items: prefs.items, trial: false });
    },
    () => {
      closeEditor();
      showHome();
    },
  );
}

function closeEditor(): void {
  editor?.destroy();
  editor = null;
  loadCustomDef();
}

let recordsReq = 0;
function showRecords(trackId: string): void {
  const req = ++recordsReq;
  const render = (list: Parameters<typeof ui.recordsScreen>[1]) =>
    ui.show(ui.recordsScreen(trackId, list, prefs.name), {
      tab: (el) => showRecords(el.dataset.track!),
      back: showHome,
    });
  render(null);
  fetchRecords(trackId)
    .then((list) => req === recordsReq && render(list))
    .catch(() => req === recordsReq && toast('Classement indisponible (serveur injoignable).'));
}

function showLobby(): void {
  if (!room || !conn?.playerId) return;
  if (room.custom) registerTrack(room.custom);
  ui.show(ui.lobbyScreen(room, conn.playerId, customDef), {
    car: (el) => {
      pickCar(el);
      conn!.send({ t: 'car', carId: prefs.carId });
    },
    track: (el) => {
      const id = (el as HTMLSelectElement).value;
      if (customDef && id === customDef.id) conn!.send({ t: 'config', custom: { name: customDef.name, points: customDef.points } });
      else conn!.send({ t: 'config', trackId: id });
    },
    laps: (el) => conn!.send({ t: 'config', laps: Number((el as HTMLSelectElement).value) }),
    bots: (el) => conn!.send({ t: 'config', bots: Number((el as HTMLSelectElement).value) }),
    items: (el) => conn!.send({ t: 'config', items: (el as HTMLInputElement).checked }),
    share: async () => {
      const url = `${location.origin}/?salle=${room!.code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Pixels Racing', text: `Rejoins ma course ! Code ${room!.code}`, url });
        else {
          await navigator.clipboard.writeText(url);
          toast('Lien copié !', true);
        }
      } catch {
        /* partage annulé */
      }
    },
    leave: () => conn!.send({ t: 'leave' }),
    start: () => {
      goFullscreen();
      conn!.send({ t: 'start' });
    },
  });
}

// ---------- En ligne ----------
function online(): Connection {
  if (conn) return conn;
  const c = new Connection(readName());
  conn = c;
  c.onStatus = (s) => {
    if (s === 'reconnecting') toast('Connexion perdue, reconnexion…');
    if (s === 'offline') toast('Serveur injoignable.');
  };
  c.on(onServer);
  c.connect();
  // Mesure du ping.
  setInterval(() => c.send({ t: 'ping', c: performance.now() }), 2000);
  return c;
}

function onServer(msg: ServerMsg): void {
  switch (msg.t) {
    case 'welcome':
      return;
    case 'error':
      toast(msg.message);
      return;
    case 'info':
      toast(msg.message, true);
      return;
    case 'room': {
      const wasIn = !!room;
      room = msg.room;
      if (!room) {
        if (race?.online) leaveRace();
        if (wasIn) history.replaceState(null, '', '/');
        showHome();
        return;
      }
      if (room.custom) registerTrack(room.custom);
      history.replaceState(null, '', `/?salle=${room.code}`);
      if (!wasIn) {
        const me = room.players.find((p) => p.id === conn!.playerId);
        if (me && me.carId !== prefs.carId && !room.players.some((p) => p.id !== me.id && p.carId === prefs.carId)) {
          conn!.send({ t: 'car', carId: prefs.carId });
        }
      }
      if (room.phase === 'lobby') {
        if (race?.online) leaveRace();
        if (!editor) showLobby();
      }
      return;
    }
    case 'snap':
      if (!race && room?.phase === 'race' && conn?.playerId) {
        ghost = null;
        enterRace(new OnlineRace(conn, controls, conn.playerId, msg.state));
      }
      return;
  }
}

// ---------- Course ----------
function enterRace(view: RaceView): void {
  race?.dispose();
  race = view;
  demo = null;
  resultsShown = false;
  pauseOpen = false;
  renderer.ghost = null;
  hud.extra = '';
  renderer.setTrack(view.track);
  ui.clear();
  hud.show(true);
  touchEl.hidden = !touch;
  touchEl.classList.toggle('no-items', !view.state.options.items);
  if (touch && innerHeight > innerWidth) toast('Tourne ton téléphone à l\'horizontale 📱', true);
}

function leaveRace(): void {
  race?.dispose();
  race = null;
  ghost = null;
  hud.show(false);
  touchEl.hidden = true;
  sound.setEngine(0, false, false);
  startDemo();
}

function openPause(): void {
  if (!race || resultsShown) return;
  pauseOpen = true;
  if (!race.online) race.paused = true;
  touchEl.hidden = true;
  ui.show(ui.pauseScreen(race.online), {
    resume: closePause,
    restart: () => {
      if (lastSolo) startSolo(lastSolo);
    },
    quit: () => {
      if (race?.online) conn?.send({ t: 'leave' });
      else {
        leaveRace();
        showHome();
      }
    },
  });
}

function closePause(): void {
  pauseOpen = false;
  if (race) race.paused = false;
  touchEl.hidden = !touch;
  ui.clear();
}

hud.onMenu = () => (pauseOpen ? closePause() : openPause());
controls.onEscape = () => {
  if (race) hud.onMenu();
};

/** Meilleurs tours en solo : fantôme du contre-la-montre et classement en ligne. */
function onMyLap(view: RaceView, ticks: number): void {
  const me = view.state.racers.find((r) => r.id === view.myId);
  if (!me) return;
  if (ghost && lastSolo?.trial) {
    const prev = ghost.bestTicks;
    if (ghost.lapDone(ticks, me.carId)) {
      hud.message(prev ? `RECORD ! −${formatTime(prev - ticks)}` : 'PREMIER TOUR ENREGISTRÉ', 2000, true);
    } else {
      hud.message(`+${formatTime(ticks - prev)} SUR LE FANTÔME`, 1600, true);
    }
  }
  const key = 'best.' + view.state.trackId;
  const best = Number(store.get(key, '0'));
  if (isOfficialTrack(view.state.trackId) && (!best || ticks < best)) {
    store.set(key, String(ticks));
    void submitRecord(view.state.trackId, prefs.name || 'Pilote', ticks, me.carId).then((place) => {
      if (place) toast(`Classement : ${place}e meilleur tour sur ${getTrackDef(view.state.trackId).name} !`, true);
    });
  }
}

// ---------- Boucle principale ----------
let last = performance.now();
let lastCountdown = -1;
function soundEvents(events: RaceEvent[], myId: string, meX: number, meY: number): void {
  for (const e of events) {
    if (e.type === 'bump' && Math.hypot(e.x - meX, e.y - meY) < 80) {
      sound.bump(e.power);
      renderer.shake = Math.min(8, e.power / 40);
    }
    if (e.type === 'go') sound.beep(880, 0.4);
    if (e.type === 'finish' && e.id === myId) sound.beep(660, 0.5, 'triangle');
    if (e.type === 'pickup' && e.id === myId) sound.beep(1200, 0.08, 'square', 0.08);
    if (e.type === 'boost' && e.id === myId) sound.beep(180, 0.3, 'sawtooth', 0.1);
    if (e.type === 'item' && e.id === myId) sound.beep(e.item === 'shield' ? 990 : 500, 0.15, 'triangle', 0.1);
    if (e.type === 'spin' && e.id === myId) sound.beep(140, 0.5, 'sawtooth', 0.12);
  }
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const view = race ?? demo;
  if (view && !editor) {
    view.update(now);
    const state = view.frame(now);
    const events = view.drainEvents();
    renderer.onEvents(events);
    if (race && ghost && lastSolo?.trial) renderer.ghost = ghost.pose(race.state);
    renderer.draw(state, race ? view.myId : null, dt);
    if (race) {
      hud.onEvents(events, state, race.myId);
      hud.update(race.track, state, race.myId, dt, race.online && conn ? { rtt: conn.rtt } : undefined);
      const me = state.racers.find((r) => r.id === race!.myId);
      soundEvents(events, race.myId, me?.x ?? 0, me?.y ?? 0);
      for (const e of events) {
        if (e.type === 'lap' && e.id === race.myId && !race.online) onMyLap(race, e.ticks);
        if (e.type === 'finish' && e.id === race.myId && !race.online) onMyLap(race, e.lapTicks);
      }
      if (lastSolo?.trial && ghost?.bestTicks && !race.online) hud.extra = `FANTÔME ${formatTime(ghost.bestTicks)}`;
      if (state.phase === 'countdown') {
        const sec = Math.ceil((COUNTDOWN_TICKS - state.tick) / 60);
        if (sec !== lastCountdown && sec > 0) sound.beep(440, 0.15);
        lastCountdown = sec;
      }
      const speed = me ? Math.hypot(me.vx, me.vy) / CAR.maxSpeed : 0;
      sound.setEngine(speed, !!me, state.phase !== 'done' && !pauseOpen);
      if (state.phase === 'done' && !resultsShown) {
        resultsShown = true;
        touchEl.hidden = true;
        ui.show(ui.resultsScreen(race.state, race.myId, race.online), {
          again: () => lastSolo && startSolo(lastSolo),
          menu: () => {
            leaveRace();
            showHome();
          },
        });
      }
    } else if (demo && demo.state.phase === 'done') startDemo();
  }
  requestAnimationFrame(frame);
}

startDemo();
showHome();
// Lien d'invitation : on rejoint directement si le pseudo est connu.
const invite = new URLSearchParams(location.search).get('salle');
if (invite && prefs.name) online().send({ t: 'join', code: invite.toUpperCase() });
requestAnimationFrame(frame);

// Débogage : ?debug expose l'état dans la console.
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, {
    pixelsRacing: {
      get race() {
        return race;
      },
      get room() {
        return room;
      },
      controls,
      renderer,
    },
  });
}
