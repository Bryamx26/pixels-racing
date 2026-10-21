import { CARS as ATLAS_CARS } from './carAtlas';

/**
 * Toutes les voitures du jeu : les 16 de la planche de sprites, puis les voitures de drift
 * (sans sprite : leur modèle 3D est construit à partir de leurs couleurs).
 */
export interface CarDef {
  id: number;
  name: string;
  color: string;
  /** Couleur secondaire (bicolore, aileron, bandes) des voitures sans sprite. */
  accent?: string;
  /** Voiture de drift. */
  drift?: boolean;
}

export const DRIFT_CARS: CarDef[] = [
  { id: 16, name: 'Kaido', color: '#f0f0f2', accent: '#d8262e', drift: true },
  { id: 17, name: 'Touge', color: '#f4f4f4', accent: '#1c1c22', drift: true },
  { id: 18, name: 'Ronin', color: '#f2c230', accent: '#1c1c22', drift: true },
  { id: 19, name: 'Sakura', color: '#ff7a1a', accent: '#1c1c22', drift: true },
];

/** Voitures ajoutées ensuite (sans sprite non plus). */
export const EXTRA_CARS: CarDef[] = [
  // Coupé japonais bleu à grand aileron, inspiré d'une photo envoyée par bryam.
  { id: 20, name: 'Raijin', color: '#2458f0', accent: '#1c1c22' },
];

export const CARS: readonly CarDef[] = [...ATLAS_CARS, ...DRIFT_CARS, ...EXTRA_CARS];
/** Nombre de voitures dessinées sur la planche de sprites. */
export const ATLAS_COUNT = ATLAS_CARS.length;
