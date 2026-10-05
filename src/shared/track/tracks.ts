/**
 * Circuits : une boucle fermée de points de contrôle (unités monde), lissée en spline.
 * Le premier point est la ligne de départ ; la course tourne dans l'ordre des points.
 * Pour ajouter un circuit : un nouvel objet ici. `npm test` vérifie que les portions
 * de piste ne se chevauchent pas et que les virages ne sont pas trop serrés.
 */
export interface TrackDef {
  id: string;
  name: string;
  /** Taille de l'image du circuit (monde). */
  width: number;
  height: number;
  points: [number, number][];
  /** Graine du décor (arbres, tribunes). */
  seed: number;
  grass: string;
  /** Pont : la piste se croise en ce point, le second passage est en hauteur. */
  bridge?: [number, number];
}

export const TRACKS: TrackDef[] = [
  {
    id: 'neon',
    name: 'Circuit Néon',
    width: 3100,
    height: 2150,
    seed: 7,
    grass: '#3f8f3a',
    points: [
      [1000, 1900], [1500, 1900], [1950, 1900], [2400, 1880], [2700, 1700], [2780, 1350], [2600, 1050],
      [2700, 760], [2830, 520], [2740, 290], [2350, 200], [1950, 250], [1700, 450], [1600, 800],
      [1400, 1000], [1150, 900], [1080, 600], [950, 320], [650, 220], [350, 300], [250, 600],
      [400, 850], [700, 950], [800, 1200], [660, 1450], [440, 1515], [295, 1578], [235, 1720], [295, 1862], [440, 1915], [660, 1910],
    ],
  },
  {
    id: 'lac',
    name: 'Anneau du Lac',
    width: 2900,
    height: 1800,
    seed: 23,
    grass: '#4a9a3c',
    points: [
      [1100, 1550], [1600, 1550], [2100, 1540], [2500, 1400], [2650, 1050], [2500, 700], [2100, 520],
      [1750, 640], [1500, 520], [1250, 330], [850, 300], [480, 420], [280, 780], [300, 1180],
      [450, 1450], [700, 1550],
    ],
  },
  {
    id: 'huit',
    name: 'Le Grand Huit',
    width: 3100,
    height: 2050,
    seed: 41,
    grass: '#3d8a44',
    bridge: [1500, 1000],
    points: [
      [800, 1600], [1150, 1420], [1500, 1000], [1850, 620], [2300, 420], [2750, 620], [2850, 1050],
      [2650, 1480], [2200, 1620], [1850, 1400], [1500, 1000], [1150, 620], [750, 420], [330, 580],
      [230, 1000], [330, 1420], [500, 1600],
    ],
  },
];

/** Circuits créés dans l'éditeur (envoyés par l'hôte d'une salle ou chargés en solo). */
const custom = new Map<string, TrackDef>();

export function registerTrack(def: TrackDef): void {
  custom.set(def.id, def);
}

export function getTrackDef(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? custom.get(id) ?? TRACKS[0];
}

export const isOfficialTrack = (id: string) => TRACKS.some((t) => t.id === id);

/** Taille du monde de l'éditeur. */
export const EDITOR_WIDTH = 3000;
export const EDITOR_HEIGHT = 2000;

/** Construit la définition d'un circuit personnalisé ; l'id dépend des points (même tracé = même id). */
export function customTrackDef(name: string, points: [number, number][]): TrackDef {
  let h = 2166136261;
  for (const [x, y] of points) h = Math.imul(h ^ (Math.round(x) * 31 + Math.round(y)), 16777619);
  return {
    id: 'perso-' + (h >>> 0).toString(36),
    name: name.slice(0, 24) || 'Mon circuit',
    width: EDITOR_WIDTH,
    height: EDITOR_HEIGHT,
    seed: h >>> 0,
    grass: '#43913d',
    points: points.map(([x, y]) => [Math.round(x), Math.round(y)]),
  };
}

/** Modèle de départ : un ovale allongé avec une petite chicane. */
export const EDITOR_TEMPLATE: [number, number][] = [
  [1200, 1650], [1800, 1650], [2350, 1600], [2650, 1300], [2650, 800], [2350, 450], [1800, 380],
  [1450, 520], [1150, 380], [650, 420], [350, 750], [350, 1250], [650, 1600],
];
