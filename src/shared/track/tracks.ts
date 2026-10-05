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
      [2700, 750], [2850, 500], [2700, 250], [2350, 200], [1950, 250], [1700, 450], [1600, 800],
      [1400, 1000], [1150, 900], [1080, 600], [950, 320], [650, 220], [350, 300], [250, 600],
      [400, 850], [700, 950], [800, 1200], [650, 1460], [430, 1530], [296, 1586], [240, 1720], [296, 1854], [430, 1910], [650, 1910],
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
];

export function getTrackDef(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
