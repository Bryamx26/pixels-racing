import { CAR } from '../../shared/cars/physics';
import { CARS } from '../../shared/cars/roster';
import { CHALLENGE_LABEL, ChallengeTracker, KMH, formatValue, starsFor, type ChallengeEvent } from '../../shared/world/challenges';
import type { RoamCar, RoamEvent } from '../../shared/world/roam';
import { getWorld, type Challenge, type Pt } from '../../shared/world/world';
import type { Sound } from '../audio';
import type { RoamView } from '../game/roamView';
import { WorldRenderer, KIND_COLOR } from '../render/worldRenderer';
import { OX, mapX, mapY, worldMapImage } from '../render/worldArt';
import * as ui from '../ui/screens';

const MAP_SCALE = 1 / 24;

const store = {
  get(k: string, d: string): string {
    try {
      return localStorage.getItem('pr.roam.' + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem('pr.roam.' + k, v);
    } catch {
      /* stockage indisponible */
    }
  },
};

const STAR = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export interface RoamDeps {
  canvas: HTMLCanvasElement;
  touchEl: HTMLElement;
  sound: Sound;
  toast: (msg: string, info?: boolean) => void;
  /** Retour au menu principal. */
  onQuit: () => void;
  /** Changement de voiture (mémorisé dans les préférences). */
  onCar: (carId: number) => void;
  /** Annonce d'un exploit aux autres joueurs (en ligne). */
  brag: (text: string) => void;
  rtt: () => number | null;
}

/**
 * Mode monde ouvert : affichage, interface (compteur, minicarte, défis, carte plein écran,
 * voyage rapide, panneaux bonus) et règles locales (défis, records).
 */
export class RoamMode {
  readonly world = getWorld();
  private renderer: WorldRenderer;
  private tracker: ChallengeTracker;
  private root: HTMLElement;
  private els: Record<'speed' | 'boost' | 'center' | 'ch' | 'boards' | 'drift' | 'net', HTMLElement>;
  private mini: HTMLCanvasElement;
  private mapImg: HTMLCanvasElement;
  private flash: { text: string; until: number; small: boolean } | null = null;
  private smashed: Set<number>;
  private wallPower = 0;
  private waypoint: Pt | null = null;
  private cars: RoamCar[] = [];
  private mapOpen = false;
  private menuOpen = false;
  private keyHandler: (e: KeyboardEvent) => void;
  private resizeHandler = () => this.renderer.resize();
  private itemBtn: HTMLElement | null;
  private itemLabel = '';
  private onItem = (e: Event) => {
    e.preventDefault();
    this.resetToRoad();
  };

  constructor(
    private view: RoamView,
    private deps: RoamDeps,
  ) {
    this.renderer = new WorldRenderer(deps.canvas, this.world);
    this.renderer.resize();
    addEventListener('resize', this.resizeHandler);
    this.tracker = new ChallengeTracker(this.world.layout.challenges);
    this.smashed = new Set(JSON.parse(store.get('boards', '[]')) as number[]);
    this.mapImg = worldMapImage(this.world, MAP_SCALE);

    const root = document.createElement('div');
    root.id = 'roam-hud';
    root.innerHTML = `
      <div class="roam-ch" hidden></div>
      <div class="hud-bars roam-bars"><div class="bar boost"><i></i><span>TURBO</span></div><div class="roam-boards"></div></div>
      <canvas class="roam-mini"></canvas>
      <div class="roam-btns">
        <button class="secondary" data-b="menu" aria-label="Menu">II</button>
        <button class="secondary" data-b="map">CARTE</button>
        <button class="secondary" data-b="reset" aria-label="Remettre sur la route">↺</button>
      </div>
      <div class="hud-center"></div>
      <div class="hud-speed"></div>
      <div class="hud-net"></div>
      <div class="hud-drift" hidden><div class="dt"></div><div class="dc"></div><div class="da"><i></i></div></div>
      <div class="roam-map" hidden></div>`;
    document.getElementById('app')!.insertBefore(root, document.getElementById('touch'));
    this.root = root;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    this.els = { speed: q('.hud-speed'), boost: q('.bar.boost'), center: q('.hud-center'), ch: q('.roam-ch'), boards: q('.roam-boards'), drift: q('.hud-drift'), net: q('.hud-net') };
    this.mini = q('.roam-mini') as HTMLCanvasElement;
    this.mini.width = 180;
    this.mini.height = 120;
    q('[data-b=menu]').addEventListener('click', () => this.openMenu());
    q('[data-b=map]').addEventListener('click', () => this.toggleMap());
    q('[data-b=reset]').addEventListener('click', () => this.resetToRoad());

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyM' || e.code === 'Tab') {
        e.preventDefault();
        this.toggleMap();
      } else if (e.code === 'KeyR' && !e.repeat) this.resetToRoad();
      else if (e.code === 'Escape') {
        if (this.mapOpen) this.toggleMap();
        else if (this.menuOpen) this.closeMenu();
        else this.openMenu();
      }
    };
    addEventListener('keydown', this.keyHandler);

    // Tactile : le bouton « objet » sert à se remettre sur la route.
    deps.touchEl.hidden = !matchMedia('(pointer: coarse)').matches && !('ontouchstart' in window);
    deps.touchEl.classList.remove('no-items');
    this.itemBtn = deps.touchEl.querySelector<HTMLElement>('.tbtn[data-k=item]');
    if (this.itemBtn) {
      this.itemLabel = this.itemBtn.textContent ?? '';
      this.itemBtn.textContent = 'ROUTE ↺';
      this.itemBtn.addEventListener('pointerdown', this.onItem);
    }

    view.onTick = (me, ev) => this.tick(me, ev);
    this.message('MONDE OUVERT', 1800);
    setTimeout(() => this.message('M : CARTE · R : ROUTE · défis : franchis les arches', 3000, true), 1900);
  }

  dispose(): void {
    this.view.dispose();
    removeEventListener('keydown', this.keyHandler);
    removeEventListener('resize', this.resizeHandler);
    this.root.remove();
    if (this.itemBtn) {
      this.itemBtn.textContent = this.itemLabel;
      this.itemBtn.removeEventListener('pointerdown', this.onItem);
    }
    this.deps.touchEl.hidden = true;
    this.deps.sound.setEngine(0, false, false);
  }

  private message(text: string, ms = 1600, small = false): void {
    this.flash = { text, until: performance.now() + ms, small };
  }

  // ---------- Règles locales : défis et panneaux ----------
  private tick(me: RoamCar, ev: RoamEvent[]): void {
    for (const e of ev) if (e.type === 'wall' && e.id === this.view.myId) this.wallPower = Math.max(this.wallPower, e.power);
    if (this.view.paused) return;
    for (const e of this.tracker.step(me, this.wallPower, 1 / 60)) this.onChallenge(e);
    this.wallPower = 0;
    for (const b of this.world.layout.boards) {
      if (this.smashed.has(b.id) || Math.abs(b.x - me.x) > 50 || Math.abs(b.y - me.y) > 50) continue;
      if (Math.hypot(b.x - me.x, b.y - me.y) > 44) continue;
      this.smashed.add(b.id);
      store.set('boards', JSON.stringify([...this.smashed]));
      this.renderer.smash(b.x, b.y);
      this.deps.sound.beep(1400, 0.08, 'square', 0.08);
      this.deps.sound.beep(1800, 0.12, 'triangle', 0.08);
      const n = this.smashed.size, total = this.world.layout.boards.length;
      this.message(`PANNEAU BONUS ${n}/${total}`, 1500, true);
      if (n === total) this.deps.brag('a cassé tous les panneaux bonus !');
    }
  }

  private best(ch: Challenge): number | null {
    const v = store.get('best.' + ch.id, '');
    return v ? Number(v) : null;
  }

  private onChallenge(e: ChallengeEvent): void {
    const s = this.deps.sound;
    if (e.type === 'start') {
      this.message(e.ch.name.toUpperCase(), 1800, true);
      s.beep(880, 0.15, 'triangle', 0.1);
      this.waypoint = null;
    } else if (e.type === 'checkpoint') {
      s.beep(990, 0.08, 'square', 0.08);
    } else if (e.type === 'drift') {
      if (e.ev.type === 'banked') {
        this.message(`+${e.ev.points.toLocaleString('fr-FR')}`, 900, true);
        s.beep(e.ev.points > 3000 ? 1320 : 990, 0.12, 'triangle', 0.09);
      } else {
        this.message(`COMBO PERDU (−${e.ev.points.toLocaleString('fr-FR')})`, 1200, true);
        s.beep(150, 0.35, 'sawtooth', 0.1);
      }
    } else if (e.type === 'fail') {
      this.message(e.reason.toUpperCase(), 1600, true);
      s.beep(160, 0.3, 'sawtooth', 0.1);
    } else if (e.type === 'end') {
      const prev = this.best(e.ch);
      const lower = e.ch.kind === 'sprint';
      const record = prev === null || (lower ? e.value < prev : e.value > prev);
      if (record) store.set('best.' + e.ch.id, String(lower ? Math.round(e.value * 100) / 100 : Math.round(e.value)));
      const txt = `${STAR(e.stars)}  ${formatValue(e.ch, e.value)}`;
      this.message(record && prev !== null ? `RECORD ! ${txt}` : txt, 2600);
      s.beep(e.stars >= 2 ? 1320 : 660, 0.4, 'triangle', 0.1);
      if (e.stars === 3 || (record && prev !== null)) this.deps.brag(`${STAR(e.stars)} ${e.ch.name} (${formatValue(e.ch, e.value)})`);
    }
  }

  private resetToRoad(): void {
    const me = this.view.me();
    if (!me || this.mapOpen || this.menuOpen) return;
    const ev = this.tracker.cancel();
    if (ev) this.onChallenge(ev);
    const p = this.world.nearestRoad(me.x, me.y);
    this.view.warp(p.x, p.y, p.a);
    this.renderer.snap();
  }

  private travel(spawnId: string): void {
    const sp = this.world.layout.spawns.find((s) => s.id === spawnId);
    if (!sp) return;
    const ev = this.tracker.cancel();
    if (ev) this.onChallenge(ev);
    this.view.warp(sp.x, sp.y, sp.a);
    this.renderer.snap();
    this.toggleMap(false);
    this.message(sp.name.toUpperCase(), 1500, true);
  }

  // ---------- Menus ----------
  private openMenu(): void {
    if (this.mapOpen) this.toggleMap(false);
    this.menuOpen = true;
    if (!this.view.online) this.view.paused = true;
    ui.show(
      `<div class="screen"><div class="title small">PAUSE</div>
        <div class="row"><button data-a="resume">REPRENDRE</button><button class="secondary" data-a="car">CHANGER DE VOITURE</button></div>
        <div class="row"><button class="secondary" data-a="map">CARTE</button><button class="secondary danger" data-a="quit">QUITTER</button></div>
        <div class="keys">↑↓←→ / ZQSD conduire · ESPACE turbo · M carte · R remettre sur la route.<br>
        Défis : franchis une arche violette (drift), bleue (vitesse) ou orange (sprint). Les panneaux ★ se cassent en roulant dessus.</div></div>`,
      {
        resume: () => this.closeMenu(),
        map: () => {
          this.closeMenu();
          this.toggleMap(true);
        },
        car: () => this.carMenu(),
        quit: () => {
          ui.clear();
          this.deps.onQuit();
        },
      },
    );
  }

  private carMenu(): void {
    const me = this.view.me();
    ui.show(`<div class="screen"><div class="title small">TA VOITURE</div>${ui.carPicker(me?.carId ?? 0)}<div class="row"><button data-a="ok">ROULER</button></div></div>`, {
      car: (el) => {
        const id = Number(el.dataset.car);
        this.view.setCar(id);
        this.deps.onCar(id);
        document.querySelectorAll('.car-pick').forEach((b) => b.classList.toggle('sel', b === el));
        document.getElementById('car-info')!.outerHTML = ui.carInfo(id);
      },
      ok: () => this.closeMenu(),
    });
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.view.paused = false;
    ui.clear();
  }

  private toggleMap(open = !this.mapOpen): void {
    this.mapOpen = open;
    const el = this.root.querySelector<HTMLElement>('.roam-map')!;
    el.hidden = !open;
    if (!this.view.online) this.view.paused = open || this.menuOpen;
    if (!open) {
      el.innerHTML = '';
      return;
    }
    const L = this.world.layout;
    const rows = L.challenges
      .map((ch) => {
        const b = this.best(ch);
        const st = b === null ? 0 : starsFor(ch, b);
        return `<button class="ch-row" data-ch="${ch.id}"><i style="background:${KIND_COLOR[ch.kind]}"></i><span>${ui.esc(ch.name)}</span><b>${STAR(st)}</b><small>${b === null ? '—' : formatValue(ch, b)}</small></button>`;
      })
      .join('');
    const stars = L.challenges.reduce((s, ch) => {
      const b = this.best(ch);
      return s + (b === null ? 0 : starsFor(ch, b));
    }, 0);
    el.innerHTML = `
      <canvas class="map-canvas"></canvas>
      <div class="map-side">
        <div class="map-title">CARTE · ${stars}/${L.challenges.length * 3} ★ · PANNEAUX ${this.smashed.size}/${L.boards.length}</div>
        <div class="map-sub">VOYAGE RAPIDE</div>
        <div class="map-travel">${L.spawns.map((s) => `<button class="secondary" data-sp="${s.id}">${ui.esc(s.name)}</button>`).join('')}</div>
        <div class="map-sub">DÉFIS (touche un défi pour l'itinéraire)</div>
        <div class="map-list">${rows}</div>
        <button data-close>FERMER (M)</button>
      </div>`;
    el.querySelectorAll<HTMLElement>('[data-sp]').forEach((b) => b.addEventListener('click', () => this.travel(b.dataset.sp!)));
    el.querySelectorAll<HTMLElement>('[data-ch]').forEach((b) =>
      b.addEventListener('click', () => {
        const ch = L.challenges.find((c) => c.id === b.dataset.ch)!;
        this.waypoint = ch.path[0];
        this.toggleMap(false);
        this.message(`ITINÉRAIRE : ${ch.name.toUpperCase()}`, 1600, true);
      }),
    );
    el.querySelector('[data-close]')!.addEventListener('click', () => this.toggleMap(false));
    const cv = el.querySelector<HTMLCanvasElement>('.map-canvas')!;
    // Toucher la carte : point de destination.
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      const k = this.mapFit(cv);
      const mx = ((e.clientX - r.left) * (cv.width / r.width) - k.ox) / k.s, my = ((e.clientY - r.top) * (cv.height / r.height) - k.oy) / k.s;
      const a = (mx - OX) / 0.75, b2 = (2 * my) / 0.75;
      this.waypoint = [(a + b2) / 2, (b2 - a) / 2];
      this.drawBigMap(cv);
    });
    requestAnimationFrame(() => this.drawBigMap(cv));
  }

  private mapFit(cv: HTMLCanvasElement): { s: number; ox: number; oy: number } {
    const iw = this.mapImg.width / MAP_SCALE, ih = this.mapImg.height / MAP_SCALE;
    const s = Math.min(cv.width / iw, cv.height / ih);
    return { s, ox: (cv.width - iw * s) / 2, oy: (cv.height - ih * s) / 2 };
  }

  private drawBigMap(cv: HTMLCanvasElement): void {
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width);
    cv.height = Math.round(r.height);
    const g = cv.getContext('2d')!;
    const { s, ox, oy } = this.mapFit(cv);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapImg, ox, oy, this.mapImg.width * (s / MAP_SCALE), this.mapImg.height * (s / MAP_SCALE));
    const P = (x: number, y: number): Pt => [ox + mapX(x, y) * s, oy + mapY(x, y) * s];
    const L = this.world.layout;
    g.textAlign = 'center';
    for (const l of L.labels) {
      const [x, y] = P(l.x, l.y);
      g.font = `${l.big ? 13 : 10}px "Press Start 2P", monospace`;
      g.fillStyle = '#000';
      g.fillText(l.name, x + 2, y + 2);
      g.fillStyle = '#fff';
      g.fillText(l.name, x, y);
    }
    for (const ch of L.challenges) {
      const [x, y] = P(...ch.path[0]);
      const b = this.best(ch);
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = KIND_COLOR[ch.kind];
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.font = '8px "Press Start 2P", monospace';
      g.fillStyle = '#fff';
      g.fillText(ch.kind === 'sprint' ? 'S' : ch.kind.startsWith('drift') ? 'D' : 'V', x, y + 4);
      if (b !== null) {
        g.fillStyle = '#ffcc33';
        g.fillText(STAR(starsFor(ch, b)), x, y + 20);
      }
    }
    for (const sp of L.spawns) {
      const [x, y] = P(sp.x, sp.y);
      g.fillStyle = '#fff';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    if (this.waypoint) {
      const [x, y] = P(...this.waypoint);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 10, 0, Math.PI * 2);
      g.stroke();
    }
    for (const c of this.cars) {
      const [x, y] = P(c.x, c.y);
      const mine = c.id === this.view.myId;
      g.fillStyle = '#000';
      g.fillRect(x - 6, y - 6, 12, 12);
      g.fillStyle = mine ? '#ffcc33' : CARS[c.carId]?.color ?? '#fff';
      g.fillRect(x - 4, y - 4, 8, 8);
      if (mine) {
        g.font = '9px "Press Start 2P", monospace';
        g.fillStyle = '#ffcc33';
        g.fillText('TOI', x, y - 10);
      }
    }
  }

  // ---------- Image ----------
  frame(now: number, dt: number): void {
    const v = this.view;
    v.update(now);
    const cars = v.frame(now);
    const events = v.drainEvents();
    this.renderer.onEvents(events, v.myId);
    const me = cars.find((c) => c.id === v.myId);
    for (const e of events) if (e.type === 'bump' && me && Math.hypot(e.x - me.x, e.y - me.y) < 80) this.deps.sound.bump(e.power);
    const L = this.world.layout;
    const a = this.tracker.active;
    let target: Pt | null = null;
    if (a) {
      if (a.ch.kind === 'sprint') target = a.ch.path[Math.min(a.idx, a.ch.path.length - 1)];
      else if (a.ch.kind !== 'driftArea') target = a.ch.path[a.ch.path.length - 1];
    } else target = this.waypoint;
    if (!a && this.waypoint && me && Math.hypot(this.waypoint[0] - me.x, this.waypoint[1] - me.y) < 200) this.waypoint = null;
    this.renderer.draw(cars, v.myId, dt, { boards: L.boards.filter((b) => !this.smashed.has(b.id)), active: a?.ch ?? null, target });
    this.cars = cars;
    this.hud(me, now);
    const sp = me ? Math.hypot(me.vx, me.vy) : 0;
    this.deps.sound.setEngine(sp / CAR.maxSpeed, !!me, !this.mapOpen && !this.menuOpen);
  }

  private hud(me: RoamCar | undefined, now: number): void {
    if (me) {
      this.els.speed.innerHTML = `${Math.round(Math.hypot(me.vx, me.vy) * KMH)} <small>KM/H</small>`;
      const lvl = me.boostTicks > 0 ? me.boostTicks / CAR.boostTicksFull : me.boost;
      (this.els.boost.firstElementChild as HTMLElement).style.width = `${Math.min(1, lvl) * 100}%`;
      this.els.boost.classList.toggle('ready', me.boost >= CAR.boostMin && me.boostTicks <= 0);
      this.els.boost.classList.toggle('on', me.boostTicks > 0);
    }
    this.els.boards.textContent = `★ PANNEAUX ${this.smashed.size}/${this.world.layout.boards.length}`;
    // Défi en cours.
    const a = this.tracker.active;
    const ch = this.els.ch;
    ch.hidden = !a;
    if (a) {
      const c = a.ch;
      const fmt = (v: number) => formatValue(c, v);
      let val = '';
      if (c.kind === 'sprint') val = `${this.tracker.clock().toFixed(1).replace('.', ',')} s · ${a.idx - 1}/${c.path.length - 1}`;
      else if (c.kind === 'speedzone') val = `${this.tracker.clock().toFixed(1).replace('.', ',')} s`;
      else if (a.drift) val = `${fmt(a.drift.total + a.drift.combo)}${c.kind === 'driftArea' ? ` · ${Math.ceil(this.tracker.clock())} s` : ''}`;
      const best = this.best(c);
      ch.innerHTML = `<div class="k" style="color:${KIND_COLOR[c.kind]}">${CHALLENGE_LABEL[c.kind].toUpperCase()}</div><div class="n">${ui.esc(c.name)}</div><div class="v">${val}</div>
        <div class="s">${c.stars.map((s, i) => `<span>${'★'.repeat(i + 1)} ${fmt(s)}</span>`).join('')}</div>${best !== null ? `<div class="b">RECORD ${fmt(best)}</div>` : ''}`;
    }
    const d = a?.drift ?? null;
    this.els.drift.hidden = !d;
    if (d) {
      const dc = this.els.drift.querySelector<HTMLElement>('.dc')!;
      this.els.drift.querySelector('.dt')!.textContent = '';
      dc.textContent = d.combo > 0 ? `+${Math.round(d.combo).toLocaleString('fr-FR')}  ×${d.mult}` : '';
      dc.className = 'dc' + (d.drifting ? ' on' : '');
      const bar = this.els.drift.querySelector<HTMLElement>('.da i')!;
      bar.style.width = `${(Math.min(90, (d.angle * 180) / Math.PI) / 90) * 100}%`;
      bar.className = d.drifting ? 'on' : '';
    }
    const c = this.els.center;
    if (this.flash && now < this.flash.until) {
      c.className = 'hud-center' + (this.flash.small ? ' small' : '');
      c.textContent = this.flash.text;
    } else c.textContent = '';
    const rtt = this.deps.rtt();
    this.els.net.textContent = rtt === null ? '' : `${Math.round(rtt)} ms · ${this.cars.length} en ligne`;
    this.drawMini(me);
  }

  private drawMini(me: RoamCar | undefined): void {
    const g = this.mini.getContext('2d')!;
    const W = this.mini.width, H = this.mini.height;
    g.fillStyle = '#123';
    g.fillRect(0, 0, W, H);
    if (!me) return;
    const cx = mapX(me.x, me.y) * MAP_SCALE, cy = mapY(me.x, me.y) * MAP_SCALE;
    const ox = Math.round(W / 2 - cx), oy = Math.round(H / 2 - cy);
    g.drawImage(this.mapImg, ox, oy);
    const P = (x: number, y: number): Pt => [ox + mapX(x, y) * MAP_SCALE, oy + mapY(x, y) * MAP_SCALE];
    for (const ch of this.world.layout.challenges) {
      const [x, y] = P(...ch.path[0]);
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      g.fillStyle = '#000';
      g.fillRect(x - 3, y - 3, 7, 7);
      g.fillStyle = KIND_COLOR[ch.kind];
      g.fillRect(x - 2, y - 2, 5, 5);
    }
    const a = this.tracker.active;
    const target = a ? (a.ch.kind === 'sprint' ? a.ch.path[Math.min(a.idx, a.ch.path.length - 1)] : a.ch.path[a.ch.path.length - 1]) : this.waypoint;
    if (target) {
      let [x, y] = P(...target);
      x = Math.max(4, Math.min(W - 4, x));
      y = Math.max(4, Math.min(H - 4, y));
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.strokeRect(x - 4, y - 4, 8, 8);
    }
    for (const c of this.cars) {
      if (c.id === this.view.myId) continue;
      const [x, y] = P(c.x, c.y);
      g.fillStyle = '#000';
      g.fillRect(x - 3, y - 3, 6, 6);
      g.fillStyle = CARS[c.carId]?.color ?? '#fff';
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    g.fillStyle = '#000';
    g.fillRect(W / 2 - 4, H / 2 - 4, 8, 8);
    g.fillStyle = '#ffcc33';
    g.fillRect(W / 2 - 3, H / 2 - 3, 6, 6);
  }
}
