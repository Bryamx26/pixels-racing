import { ROAD_WIDTH, WALL_DIST } from '../../shared/constants';
import { buildTrack } from '../../shared/track/track';
import { EDITOR_HEIGHT, EDITOR_TEMPLATE as TEMPLATE, EDITOR_WIDTH, customTrackDef, type TrackDef } from '../../shared/track/tracks';
import { MAX_POINTS, MIN_POINTS, validateTrack, type TrackProblem } from '../../shared/track/validate';
import { esc } from '../ui/screens';

export interface SavedTrack {
  name: string;
  points: [number, number][];
}

const STORE = 'pr.custom';

export function loadCustom(): SavedTrack | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as SavedTrack) : null;
  } catch {
    return null;
  }
}

function saveCustom(t: SavedTrack): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(t));
  } catch {
    /* stockage indisponible */
  }
}


const MARGIN = WALL_DIST + 40;

/**
 * Éditeur de circuit : toucher la piste vide ajoute un point (inséré dans le tronçon le plus
 * proche), glisser un point le déplace, « Supprimer » retire le point choisi. Le point 1 est
 * la ligne de départ. Les mêmes règles que les circuits officiels sont vérifiées en direct.
 */
export class Editor {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private points: [number, number][];
  private name: string;
  private selected = -1;
  private dragging = -1;
  private problems: TrackProblem[] = [];
  private def: TrackDef | null = null;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(
    private onTry: (def: TrackDef) => void,
    private onClose: () => void,
  ) {
    const saved = loadCustom();
    this.points = saved?.points.map((p) => [p[0], p[1]] as [number, number]) ?? TEMPLATE.map((p) => [...p] as [number, number]);
    this.name = saved?.name ?? 'Mon circuit';
    this.root = document.createElement('div');
    this.root.id = 'editor';
    this.root.innerHTML = `
      <div class="ed-bar">
        <input class="ed-name" maxlength="24" value="${esc(this.name)}" aria-label="Nom du circuit">
        <button class="secondary" data-ed="del">SUPPRIMER LE POINT</button>
        <button class="secondary" data-ed="reset">MODÈLE</button>
        <button data-ed="save">ENREGISTRER</button>
        <button data-ed="try">ESSAYER</button>
        <button class="secondary" data-ed="close">RETOUR</button>
      </div>
      <div class="ed-status"></div>
      <canvas class="ed-canvas"></canvas>
      <div class="ed-help">Touche la piste vide pour ajouter un point, fais glisser un point pour le déplacer. Le point 1 (drapeau) est la ligne de départ ; l'ordre des points donne le sens de la course.</div>`;
    document.getElementById('app')!.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    const on = (k: string, fn: () => void) => this.root.querySelector(`[data-ed=${k}]`)!.addEventListener('click', fn);
    on('del', () => this.deleteSelected());
    on('reset', () => {
      this.points = TEMPLATE.map((p) => [...p] as [number, number]);
      this.selected = -1;
      this.refresh();
    });
    on('save', () => this.save());
    on('try', () => {
      if (!this.def || this.problems.length) return this.flash('Corrige le circuit avant de l\'essayer.');
      this.save();
      this.onTry(this.def);
    });
    on('close', () => this.onClose());
    this.root.querySelector<HTMLInputElement>('.ed-name')!.addEventListener('input', (e) => {
      this.name = (e.target as HTMLInputElement).value;
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('pointercancel', () => this.up());
    addEventListener('resize', this.onResize);
    this.refresh();
  }

  private onResize = () => this.draw();

  destroy(): void {
    removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  private flash(msg: string): void {
    const st = this.root.querySelector('.ed-status')!;
    st.textContent = msg;
    st.className = 'ed-status bad';
  }

  private save(): void {
    this.name = this.name.trim() || 'Mon circuit';
    saveCustom({ name: this.name, points: this.points });
    this.refresh();
    if (!this.problems.length) {
      const st = this.root.querySelector('.ed-status')!;
      st.textContent = `Enregistré : « ${this.name} ». Il apparaît dans la liste des circuits (solo et salles en ligne).`;
      st.className = 'ed-status ok';
    }
  }

  private deleteSelected(): void {
    if (this.selected < 0) return this.flash('Touche d\'abord un point pour le choisir.');
    if (this.points.length <= MIN_POINTS) return this.flash(`Il faut au moins ${MIN_POINTS} points.`);
    this.points.splice(this.selected, 1);
    this.selected = -1;
    this.refresh();
  }

  private toWorld(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.scale, (e.clientY - r.top - this.oy) / this.scale];
  }

  private hit(x: number, y: number): number {
    const radius = 26 / this.scale;
    let best = -1, bd = radius;
    this.points.forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.toWorld(e);
    const i = this.hit(x, y);
    if (i >= 0) {
      this.selected = this.dragging = i;
      this.draw();
      return;
    }
    if (this.points.length >= MAX_POINTS) return this.flash(`${MAX_POINTS} points au maximum.`);
    // Insertion dans le tronçon le plus proche.
    let seg = 0, bd = Infinity;
    for (let k = 0; k < this.points.length; k++) {
      const a = this.points[k], b = this.points[(k + 1) % this.points.length];
      const d = distToSegment(x, y, a, b);
      if (d < bd) {
        bd = d;
        seg = k;
      }
    }
    this.points.splice(seg + 1, 0, clampPoint(x, y));
    this.selected = this.dragging = seg + 1;
    this.refresh();
  }

  private move(e: PointerEvent): void {
    if (this.dragging < 0) return;
    const [x, y] = this.toWorld(e);
    this.points[this.dragging] = clampPoint(x, y);
    this.refresh(false);
  }

  private up(): void {
    if (this.dragging >= 0) this.refresh();
    this.dragging = -1;
  }

  /** Recalcule le circuit et ses problèmes (la validation complète attend la fin du glisser). */
  private refresh(validate = true): void {
    this.def = customTrackDef(this.name, this.points);
    if (validate) this.problems = validateTrack(this.def);
    const st = this.root.querySelector('.ed-status')!;
    if (validate) {
      if (this.problems.length) {
        st.textContent = '✗ ' + [...new Set(this.problems.map((p) => p.message))].join(' ');
        st.className = 'ed-status bad';
      } else {
        const len = buildTrack(this.def).length;
        st.textContent = `✓ Circuit valide · ${this.points.length} points · ${(len / 1000).toFixed(1)} km de piste`;
        st.className = 'ed-status ok';
      }
    }
    this.draw();
  }

  private draw(): void {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(r.width / EDITOR_WIDTH, r.height / EDITOR_HEIGHT);
    this.ox = (r.width - EDITOR_WIDTH * this.scale) / 2;
    this.oy = (r.height - EDITOR_HEIGHT * this.scale) / 2;
    g.fillStyle = '#120f1f';
    g.fillRect(0, 0, r.width, r.height);
    g.save();
    g.translate(this.ox, this.oy);
    g.scale(this.scale, this.scale);
    g.fillStyle = '#43913d';
    g.fillRect(0, 0, EDITOR_WIDTH, EDITOR_HEIGHT);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2 / this.scale;
    g.strokeRect(MARGIN, MARGIN, EDITOR_WIDTH - 2 * MARGIN, EDITOR_HEIGHT - 2 * MARGIN);

    if (this.def && this.points.length >= 3) {
      const t = buildTrack(this.def);
      const path = () => {
        g.beginPath();
        for (let i = 0; i <= t.n; i++) g.lineTo(t.xs[i % t.n], t.ys[i % t.n]);
      };
      g.lineJoin = 'round';
      path();
      g.strokeStyle = 'rgba(30,60,20,0.35)';
      g.lineWidth = WALL_DIST * 2;
      g.stroke();
      g.strokeStyle = '#d8262e';
      g.lineWidth = ROAD_WIDTH + 12;
      g.stroke();
      g.strokeStyle = '#44464f';
      g.lineWidth = ROAD_WIDTH;
      g.stroke();
      // Flèches du sens de la course.
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 20; i < t.n; i += 60) {
        g.save();
        g.translate(t.xs[i], t.ys[i]);
        g.rotate(Math.atan2(t.tys[i], t.txs[i]));
        g.beginPath();
        g.moveTo(18, 0);
        g.lineTo(-10, -12);
        g.lineTo(-10, 12);
        g.fill();
        g.restore();
      }
    }
    // Points de contrôle.
    this.points.forEach((p, i) => {
      g.beginPath();
      g.arc(p[0], p[1], 20, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? '#fafafa' : i === this.selected ? '#ffcc33' : '#3fa7ff';
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#000';
      g.stroke();
      g.fillStyle = '#000';
      g.font = 'bold 22px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(i === 0 ? '🏁' : String(i + 1), p[0], p[1] + 1);
    });
    for (const pr of this.problems) {
      g.beginPath();
      g.arc(pr.at[0], pr.at[1], 70, 0, Math.PI * 2);
      g.lineWidth = 10;
      g.strokeStyle = '#ff4d4d';
      g.stroke();
    }
    g.restore();
  }
}

function clampPoint(x: number, y: number): [number, number] {
  return [
    Math.round(Math.max(MARGIN, Math.min(EDITOR_WIDTH - MARGIN, x))),
    Math.round(Math.max(MARGIN, Math.min(EDITOR_HEIGHT - MARGIN, y))),
  ];
}

function distToSegment(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l));
  return Math.hypot(a[0] + dx * u - x, a[1] + dy * u - y);
}
