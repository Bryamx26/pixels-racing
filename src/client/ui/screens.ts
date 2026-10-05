import { CARS } from '../../shared/cars/carAtlas';
import { MAX_LAPS, MAX_PLAYERS, MIN_LAPS } from '../../shared/constants';
import { COUNTDOWN_TICKS } from '../../shared/constants';
import { carClass } from '../../shared/cars/stats';
import { formatTime, standings, type RaceState } from '../../shared/race/race';
import type { TrackDef } from '../../shared/track/tracks';
import type { LapRecord } from '../../shared/net/protocol';
import { TRACKS } from '../../shared/track/tracks';
import type { RoomInfo } from '../../shared/net/protocol';
import { atlasUrl } from '../render/renderer';

const root = document.getElementById('screens')!;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Remplace l'écran courant ; `on` associe des gestionnaires aux éléments [data-a]. */
export function show(html: string, on: Record<string, (el: HTMLElement) => void> = {}): HTMLElement {
  root.innerHTML = html;
  root.querySelectorAll<HTMLElement>('[data-a]').forEach((el) => {
    const fn = on[el.dataset.a!];
    if (!fn) return;
    el.addEventListener(el.tagName === 'SELECT' || el.tagName === 'INPUT' ? 'change' : 'click', () => fn(el));
  });
  return root;
}

export function clear(): void {
  root.innerHTML = '';
}

export function carThumb(carId: number, scale?: number): string {
  return `<div class="car-thumb" style="--atlas:url(${atlasUrl});--cx:${carId % 4};--cy:${Math.floor(carId / 4)}${scale ? `;--s:${scale}` : ''}"></div>`;
}

/** Grille de choix des 16 voitures. `taken` : voitures déjà prises par d'autres joueurs. */
export function carPicker(selected: number, taken: Set<number> = new Set()): string {
  return `<div class="cars">${CARS.map(
    (c) => `<button class="car-pick ${c.id === selected ? 'sel' : ''} ${taken.has(c.id) ? 'taken' : ''}" data-a="car" data-car="${c.id}">
      ${carThumb(c.id)}<span>${esc(c.name)}</span><small class="cls ${carClass(c.id).id}">${carClass(c.id).name}</small></button>`,
  ).join('')}</div>${carInfo(selected)}`;
}

/** Barres de caractéristiques de la voiture choisie. */
export function carInfo(carId: number): string {
  const k = carClass(carId);
  const bar = (label: string, v: number, lo: number, hi: number) =>
    `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(((v - lo) / (hi - lo)) * 80 + 20)}%"></b></i></div>`;
  return `<div class="car-info" id="car-info"><div><b>${esc(CARS[carId]?.name ?? '')}</b> · ${k.name} — ${esc(k.hint)}</div>
    ${bar('Accélération', k.stats.accel, 0.88, 1.1)}${bar('Vitesse', k.stats.top, 0.94, 1.08)}${bar('Tenue de route', k.stats.grip, 0.86, 1.14)}${bar('Poids', k.stats.mass, 0.8, 1.55)}
  </div>`;
}

export function trackOptions(selected: string, custom: TrackDef | null = null): string {
  const list = custom ? [...TRACKS, custom] : TRACKS;
  return list
    .map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}${t === custom ? ' (perso)' : ''}</option>`)
    .join('');
}

export function lapOptions(selected: number): string {
  let s = '';
  for (let i = MIN_LAPS; i <= MAX_LAPS; i++) s += `<option value="${i}" ${i === selected ? 'selected' : ''}>${i} tour${i > 1 ? 's' : ''}</option>`;
  return s;
}

export function botOptions(selected: number, max: number): string {
  let s = '';
  for (let i = 0; i <= max; i++) s += `<option value="${i}" ${i === selected ? 'selected' : ''}>${i} bot${i > 1 ? 's' : ''}</option>`;
  return s;
}

export const KEYS_HELP = `<div class="keys">
  PC : <b>↑</b>/<b>Z</b> gaz · <b>↓</b>/<b>S</b> frein · <b>←→</b>/<b>Q D</b> diriger · <b>ESPACE</b> turbo · <b>E</b> objet · <b>ÉCHAP</b> menu. Manette : gâchettes, stick, X turbo, Y objet.<br>
  Freiner à pleine vitesse fait déraper ; déraper et rouler dans l'aspiration remplit le turbo. Voiture abîmée ? Arrête-toi sur la bande jaune des STANDS.<br>
  Mobile : ◀ ▶ à gauche ; GAZ, FREIN, TURBO et OBJET à droite. Tiens le téléphone à l'horizontale.
</div>`;

export function homeScreen(name: string, joinCode: string, autoGas: boolean, muted: boolean): string {
  return `<div class="screen">
    <div class="title">PIXELS RACING</div>
    <p class="subtitle">Course pixel art en ligne · PC et mobile</p>
    <label class="field">Ton pseudo<input data-a="name" id="name" maxlength="12" value="${esc(name)}" placeholder="Pilote" autocomplete="off"></label>
    <div class="row">
      <button data-a="solo">COURSE SOLO</button>
      <button data-a="trial">CONTRE-LA-MONTRE</button>
      <button data-a="create">CRÉER UNE SALLE</button>
    </div>
    <div class="row">
      <input class="code" id="code" maxlength="5" placeholder="CODE" value="${esc(joinCode)}" autocomplete="off">
      <button class="secondary" data-a="join">REJOINDRE</button>
    </div>
    <div class="row">
      <button class="secondary" data-a="editor">ÉDITEUR DE CIRCUIT</button>
      <button class="secondary" data-a="records">CLASSEMENT</button>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" data-a="autogas" ${autoGas ? 'checked' : ''}> Accélération automatique</label>
      <label class="check"><input type="checkbox" data-a="mute" ${muted ? 'checked' : ''}> Couper le son</label>
    </div>
    ${KEYS_HELP}
  </div>`;
}

export function soloScreen(
  carId: number,
  trackId: string,
  laps: number,
  bots: number,
  items: boolean,
  custom: TrackDef | null,
  trial: boolean,
  best: string,
): string {
  return `<div class="screen wide">
    <h2>${trial ? 'CONTRE-LA-MONTRE' : 'COURSE SOLO'}</h2>
    ${trial ? `<p class="hint">Seul en piste contre ton fantôme (ton meilleur tour). Record perso : ${best}</p>` : ''}
    <div class="row">
      <label class="field">Circuit<select data-a="track">${trackOptions(trackId, custom)}</select></label>
      <label class="field">Tours<select data-a="laps">${lapOptions(laps)}</select></label>
      ${
        trial
          ? ''
          : `<label class="field">Adversaires<select data-a="bots">${botOptions(bots, MAX_PLAYERS - 1)}</select></label>`
      }
    </div>
    ${trial ? '' : `<div class="row"><label class="check"><input type="checkbox" data-a="items" ${items ? 'checked' : ''}> Boîtes d'objets (nitro, huile, bouclier)</label></div>`}
    <h3>TA VOITURE</h3>
    ${carPicker(carId)}
    <div class="row">
      <button class="secondary" data-a="back">RETOUR</button>
      <button data-a="go">DÉPART !</button>
    </div>
  </div>`;
}

export function lobbyScreen(room: RoomInfo, myId: string, myCustom: TrackDef | null): string {
  const me = room.players.find((p) => p.id === myId);
  const host = !!me?.host;
  const link = `${location.origin}/?salle=${room.code}`;
  const taken = new Set(room.players.filter((p) => p.id !== myId).map((p) => p.carId));
  const track = TRACKS.find((t) => t.id === room.trackId) ?? room.custom;
  const customOpt = room.custom ?? myCustom;
  const players = room.players
    .map(
      (p) => `<div class="player" style="--c:${CARS[p.carId]?.color}">
        ${carThumb(p.carId)}<span class="name">${esc(p.name)}</span>
        ${p.host ? '<span class="tag">HÔTE</span>' : ''}${p.connected ? '' : '<span class="tag off">DÉCO</span>'}
      </div>`,
    )
    .join('');
  const bots = room.bots
    ? `<div class="player"><span class="name">+ ${room.bots} bot${room.bots > 1 ? 's' : ''}</span></div>`
    : '';
  const settings = host
    ? `<div class="row">
        <label class="field">Circuit<select data-a="track">${trackOptions(room.trackId, customOpt)}</select></label>
        <label class="field">Tours<select data-a="laps">${lapOptions(room.laps)}</select></label>
        <label class="field">Bots<select data-a="bots">${botOptions(room.bots, MAX_PLAYERS - room.players.length)}</select></label>
      </div>
      <div class="row"><label class="check"><input type="checkbox" data-a="items" ${room.items ? 'checked' : ''}> Boîtes d'objets</label></div>`
    : `<p class="hint">${esc(track?.name ?? '')} · ${room.laps} tour${room.laps > 1 ? 's' : ''} · objets ${room.items ? 'oui' : 'non'} · l'hôte lance la course</p>`;
  return `<div class="screen wide">
    <h2>SALLE</h2>
    <div class="code-box">${room.code}</div>
    <p class="hint">${esc(link)}</p>
    <div class="row"><button class="secondary" data-a="share">PARTAGER LE LIEN</button></div>
    <div class="players">${players}${bots}</div>
    ${settings}
    <h3>TA VOITURE</h3>
    ${carPicker(me?.carId ?? 0, taken)}
    <div class="row">
      <button class="secondary" data-a="leave">QUITTER</button>
      ${host ? '<button data-a="start">LANCER LA COURSE</button>' : ''}
    </div>
  </div>`;
}

export function pauseScreen(online: boolean): string {
  return `<div class="screen overlay">
    <h2>PAUSE</h2>
    ${online ? '<p class="hint">La course continue en ligne pendant que ce menu est ouvert.</p>' : ''}
    <div class="row"><button data-a="resume">REPRENDRE</button></div>
    ${online ? '' : '<div class="row"><button class="secondary" data-a="restart">RECOMMENCER</button></div>'}
    <div class="row"><button class="danger" data-a="quit">${online ? 'QUITTER LA SALLE' : 'QUITTER'}</button></div>
    ${KEYS_HELP}
  </div>`;
}

export function resultsScreen(state: RaceState, myId: string, online: boolean): string {
  const rows = standings(state)
    .map((r, i) => {
      const time = r.finishTick >= 0 ? formatTime(r.finishTick - COUNTDOWN_TICKS) : 'NC';
      return `<tr class="${r.id === myId ? 'me' : ''}">
        <td class="place">${i + 1}</td>
        <td>${carThumb(r.carId, 0.6)}</td>
        <td style="color:${CARS[r.carId]?.color}">${esc(r.name)}</td>
        <td class="t">${time}<br><small>MT ${r.bestLap ? formatTime(r.bestLap) : '--'}</small></td>
      </tr>`;
    })
    .join('');
  return `<div class="screen overlay">
    <h2>RÉSULTATS</h2>
    <table class="results">${rows}</table>
    ${
      online
        ? '<p class="hint">Retour au salon dans quelques secondes…</p>'
        : '<div class="row"><button class="secondary" data-a="menu">MENU</button><button data-a="again">REJOUER</button></div>'
    }
  </div>`;
}

export function recordsScreen(trackId: string, records: LapRecord[] | null, mine: string): string {
  const tabs = TRACKS.map(
    (t) => `<button class="${t.id === trackId ? '' : 'secondary'}" data-a="tab" data-track="${t.id}">${esc(t.name)}</button>`,
  ).join('');
  const rows =
    records === null
      ? '<p class="hint">Chargement…</p>'
      : records.length === 0
        ? '<p class="hint">Aucun temps pour l\'instant. À toi de jouer !</p>'
        : `<table class="results">${records
            .map(
              (r, i) => `<tr class="${r.name === mine ? 'me' : ''}"><td class="place">${i + 1}</td><td>${carThumb(r.carId, 0.6)}</td>
              <td>${esc(r.name)}${r.online ? ' <small class="tag">EN LIGNE</small>' : ''}</td><td class="t">${formatTime(r.ticks)}<br><small>${esc(r.at)}</small></td></tr>`,
            )
            .join('')}</table>`;
  return `<div class="screen wide">
    <h2>MEILLEURS TOURS</h2>
    <div class="row">${tabs}</div>
    ${rows}
    <div class="row"><button class="secondary" data-a="back">RETOUR</button></div>
  </div>`;
}
