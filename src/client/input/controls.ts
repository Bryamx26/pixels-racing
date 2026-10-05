import type { CarInput } from '../../shared/input';
import { clamp } from '../../shared/math';

/**
 * Commandes du joueur : clavier (touches par position physique, ZQSD/WASD et flèches),
 * boutons tactiles et manette. Au clavier et au tactile, la direction monte
 * progressivement pour permettre des trajectoires fines.
 */
export class Controls {
  private keys = new Set<string>();
  private touchKeys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private steer = 0;
  autoGas = false;
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
    if (this.autoGas && !brake) gas = 1;

    let analog: number | null = null;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const x = pad.axes[0] ?? 0;
      if (Math.abs(x) > 0.15) analog = clamp((x - Math.sign(x) * 0.15) / 0.85, -1, 1);
      const btn = (i: number) => pad.buttons[i]?.value ?? 0;
      gas = Math.max(gas, btn(7), btn(0));
      brake = Math.max(brake, btn(6), btn(1));
      left ||= btn(14) > 0.5;
      right ||= btn(15) > 0.5;
    }

    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (analog !== null) this.steer = analog;
    else if (target === 0) this.steer = 0;
    else {
      // Contre-braquage immédiat, montée progressive sinon.
      if (Math.sign(this.steer) !== target) this.steer = 0;
      this.steer = clamp(this.steer + target * dt * 6, -1, 1);
    }
    return { throttle: gas, brake, steer: this.steer };
  }
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Vrai si l'appareil est tactile (téléphone, tablette). */
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
