import type { CarInput } from '../../shared/input';
import { clamp } from '../../shared/math';

/**
 * Commandes du joueur : clavier (touches par position physique, ZQSD/WASD et flèches),
 * boutons tactiles et manette. Au clavier et au tactile, la direction monte
 * progressivement pour permettre des trajectoires fines.
 */
/** Volant (Logitech, Thrustmaster, Fanatec…) : axes repérés par le calibrage, rotation réglable. */
export interface WheelConfig {
  enabled: boolean;
  /** Rotation en jeu, butée à butée (degrés) : 900 = comme une vraie voiture. */
  rotation: number;
  /** Rotation physique du volant, butée à butée (degrés). */
  device: number;
  steerAxis: number;
  steerSign: number;
  steerCenter: number;
  gasAxis: number;
  gasRest: number;
  brakeAxis: number;
  brakeRest: number;
}

export const DEFAULT_WHEEL: WheelConfig = {
  enabled: false,
  rotation: 900,
  device: 900,
  steerAxis: 0,
  steerSign: 1,
  steerCenter: 0,
  gasAxis: 2,
  gasRest: 1,
  brakeAxis: 5,
  brakeRest: 1,
};

/** Pression d'une pédale (0..1) à partir de sa valeur au repos. */
export function pedal(v: number, rest: number): number {
  return clamp(Math.abs(v - rest) / (Math.abs(rest) > 0.5 ? 2 : 1), 0, 1);
}

/** Manette ou volant branché (le premier qui a des axes). */
export function firstPad(): Gamepad | null {
  for (const p of navigator.getGamepads?.() ?? []) if (p && p.axes.length) return p;
  return null;
}

export class Controls {
  private keys = new Set<string>();
  private touchKeys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private steer = 0;
  autoGas = false;
  wheel: WheelConfig = { ...DEFAULT_WHEEL };
  /** Vibrations (manette et téléphone). */
  rumbleOn = true;
  onEscape: () => void = () => {};

  constructor(private touchRoot: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.onEscape();
      if (GAME_KEYS.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
      this.refreshTouch();
    });

    // Tactile : on suit chaque doigt et on regarde quel bouton il recouvre, ce qui
    // permet de glisser de ◀ à ▶ sans lever le pouce.
    const btns = [...touchRoot.querySelectorAll<HTMLElement>('.tbtn')];
    const update = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.buttons === 0) this.pointers.delete(e.pointerId);
      else this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.refreshTouch(btns);
    };
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.refreshTouch(btns);
    };
    for (const b of btns) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (b.hasPointerCapture?.(e.pointerId)) b.releasePointerCapture(e.pointerId);
        update(e);
      });
    }
    addEventListener('pointermove', (e) => this.pointers.has(e.pointerId) && update(e));
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    touchRoot.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private refreshTouch(btns = [...this.touchRoot.querySelectorAll<HTMLElement>('.tbtn')]): void {
    this.touchKeys.clear();
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      const pad = 10;
      const on = [...this.pointers.values()].some(
        (p) => p.x >= r.left - pad && p.x <= r.right + pad && p.y >= r.top - pad && p.y <= r.bottom + pad,
      );
      b.classList.toggle('on', on);
      if (on) this.touchKeys.add(b.dataset.k!);
    }
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Lit les commandes pour un tick de simulation. */
  read(dt: number): CarInput {
    const t = this.touchKeys;
    let left = this.down('ArrowLeft', 'KeyA') || t.has('left');
    let right = this.down('ArrowRight', 'KeyD') || t.has('right');
    let gas = this.down('ArrowUp', 'KeyW') || t.has('gas') ? 1 : 0;
    let brake = this.down('ArrowDown', 'KeyS') || t.has('brake') ? 1 : 0;
    let boost = this.down('Space', 'ShiftLeft', 'ShiftRight') || t.has('boost');
    let item = this.down('KeyE', 'KeyF', 'Enter', 'ControlLeft', 'ControlRight') || t.has('item');
    if (this.autoGas && !brake) gas = 1;

    let analog: number | null = null;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const btn = (i: number) => pad.buttons[i]?.value ?? 0;
      const wheel = this.wheel;
      if (wheel.enabled && pad.mapping !== 'standard') {
        // Volant : braquage linéaire (sans zone morte ni filtrage), pédales séparées.
        const raw = (pad.axes[wheel.steerAxis] ?? 0) - wheel.steerCenter;
        const deg = raw * wheel.steerSign * (wheel.device / 2);
        analog = clamp(deg / (wheel.rotation / 2), -1, 1);
        gas = Math.max(gas, pedal(pad.axes[wheel.gasAxis] ?? wheel.gasRest, wheel.gasRest));
        brake = Math.max(brake, pedal(pad.axes[wheel.brakeAxis] ?? wheel.brakeRest, wheel.brakeRest));
        if (gas < 0.04) gas = 0;
        if (brake < 0.04) brake = 0;
        boost ||= btn(0) > 0.5 || btn(4) > 0.5 || btn(5) > 0.5;
        item ||= btn(1) > 0.5 || btn(2) > 0.5 || btn(3) > 0.5;
        continue;
      }
      const x = pad.axes[0] ?? 0;
      // Manette : courbe progressive (précise au centre, pleine à fond).
      if (Math.abs(x) > 0.12) {
        const u = (Math.abs(x) - 0.12) / 0.88;
        analog = Math.sign(x) * clamp(u * (0.55 + 0.45 * u), 0, 1);
      }
      gas = Math.max(gas, btn(7), btn(0));
      brake = Math.max(brake, btn(6), btn(1));
      boost ||= btn(2) > 0.5 || btn(4) > 0.5;
      item ||= btn(3) > 0.5 || btn(5) > 0.5;
      left ||= btn(14) > 0.5;
      right ||= btn(15) > 0.5;
    }

    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (analog !== null) this.steer = analog;
    else if (target === 0) this.steer -= Math.sign(this.steer) * Math.min(Math.abs(this.steer), dt * 10);
    else {
      // Contre-braquage immédiat, montée progressive sinon.
      if (Math.sign(this.steer) !== target) this.steer = 0;
      this.steer = clamp(this.steer + target * dt * 6, -1, 1);
    }
    return { throttle: gas, brake, steer: this.steer, boost, item };
  }
}

/** Vibration de la manette (et du téléphone) : `strong` 0..1, durée en ms. */
export function rumble(on: boolean, strong: number, ms: number): void {
  if (!on || strong <= 0.02) return;
  let done = false;
  for (const pad of navigator.getGamepads?.() ?? []) {
    const act = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    if (act?.playEffect) {
      void act.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(strong * 0.7, 0, 1) }).catch(() => {});
      done = true;
    }
  }
  if (!done && isTouchDevice() && strong > 0.25) navigator.vibrate?.(Math.round(ms * strong));
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/** Vrai si l'appareil est tactile (téléphone, tablette). */
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
