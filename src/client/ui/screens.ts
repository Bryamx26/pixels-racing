import { CARS } from '../../shared/cars/carAtlas';
import { MAX_LAPS, MAX_PLAYERS, MIN_LAPS } from '../../shared/constants';
import { COUNTDOWN_TICKS } from '../../shared/constants';
import { formatTime, standings, type RaceState } from '../../shared/race/race';
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
      ${carThumb(c.id)}<span>${esc(c.name)}</span></button>`,
  ).join('')}</div>`;
}

export function trackOptions(selected: string): string {
  return TRACKS.map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
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
  PC : <b>↑</b>/<b>Z</b> gaz · <b>↓</b>/<b>S</b> frein et marche arrière · <b>←→</b>/<b>Q D</b> diriger · <b>ÉCHAP</b> menu. Freiner à pleine vitesse fait déraper. Manette : gâchettes + stick.<br>
  Mobile : ◀ ▶ à gauche, GAZ / FREIN à droite. Tiens le téléphone à l'horizontale.
</div>`;

export function homeScreen(name: string, joinCode: string, autoGas: boolean, muted: boolean): string {
  return `<div class="screen">
    <div class="title">PIXELS RACING</div>
    <p class="subtitle">Course pixel art en ligne · PC et mobile</p>
    <label class="field">Ton pseudo<input data-a="name" id="name" maxlength="12" value="${esc(name)}" placeholder="Pilote" autocomplete="off"></label>
    <div class="row">
      <button data-a="solo">COURSE SOLO</button>
      <button data-a="create">CRÉER UNE SALLE</button>
    </div>
    <div class="row">
      <input class="code" id="code" maxlength="5" placeholder="CODE" value="${esc(joinCode)}" autocomplete="off">
      <button class="secondary" data-a="join">REJOINDRE</button>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" data-a="autogas" ${autoGas ? 'checked' : ''}> Accélération automatique</label>
      <label class="check"><input type="checkbox" data-a="mute" ${muted ? 'checked' : ''}> Couper le son</label>
    </div>
    ${KEYS_HELP}
  </div>`;
}

export function soloScreen(carId: number, trackId: string, laps: number, bots: number): string {
  return `<div class="screen wide">
    <h2>COURSE SOLO</h2>
    <div class="row">
      <label class="field">Circuit<select data-a="track">${trackOptions(trackId)}</select></label>
      <label class="field">Tours<select data-a="laps">${lapOptions(laps)}</select></label>
      <label class="field">Adversaires<select data-a="bots">${botOptions(bots, MAX_PLAYERS - 1)}</select></label>
    </div>
    <h3>TA VOITURE</h3>
    ${carPicker(carId)}
    <div class="row">
      <button class="secondary" data-a="back">RETOUR</button>
      <button data-a="go">DÉPART !</button>
    </div>
  </div>`;
}

export function lobbyScreen(room: RoomInfo, myId: string): string {
  const me = room.players.find((p) => p.id === myId);
  const host = !!me?.host;
  const link = `${location.origin}/?salle=${room.code}`;
  const taken = new Set(room.players.filter((p) => p.id !== myId).map((p) => p.carId));
  const track = TRACKS.find((t) => t.id === room.trackId);
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
        <label class="field">Circuit<select data-a="track">${trackOptions(room.trackId)}</select></label>
        <label class="field">Tours<select data-a="laps">${lapOptions(room.laps)}</select></label>
        <label class="field">Bots<select data-a="bots">${botOptions(room.bots, MAX_PLAYERS - room.players.length)}</select></label>
      </div>`
    : `<p class="hint">${esc(track?.name ?? '')} · ${room.laps} tour${room.laps > 1 ? 's' : ''} · l'hôte lance la course</p>`;
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
