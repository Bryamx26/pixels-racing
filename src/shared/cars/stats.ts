/**
 * Réglages par voiture : chaque voiture de l'atlas appartient à une famille.
 * Les valeurs sont des multiplicateurs des réglages communs (CAR dans physics.ts).
 */
export interface CarStats {
  /** Accélération. */
  accel: number;
  /** Vitesse de pointe. */
  top: number;
  /** Adhérence en virage (accélération latérale maximale). */
  grip: number;
  /** Masse : une voiture lourde pousse les autres et encaisse mieux les chocs. */
  mass: number;
  /** Voiture de drift (0..1) : décroche plus facilement et tient la glisse à l'accélérateur. */
  drift?: number;
}

export interface CarClass {
  id: 'equilibree' | 'vitesse' | 'agile' | 'lourde' | 'drift';
  name: string;
  hint: string;
  stats: CarStats;
}

export const CLASSES: Record<CarClass['id'], CarClass> = {
  equilibree: { id: 'equilibree', name: 'Équilibrée', hint: 'Bonne partout', stats: { accel: 1, top: 1, grip: 1, mass: 1 } },
  vitesse: { id: 'vitesse', name: 'Vitesse', hint: 'Très rapide, glisse en virage', stats: { accel: 0.97, top: 1.06, grip: 0.88, mass: 0.95 } },
  agile: { id: 'agile', name: 'Agile', hint: 'Vive et collée à la route, moins rapide', stats: { accel: 1.08, top: 0.96, grip: 1.12, mass: 0.85 } },
  lourde: { id: 'lourde', name: 'Lourde', hint: 'Lente à lancer, stable, gagne les chocs', stats: { accel: 0.9, top: 1.02, grip: 1.02, mass: 1.5 } },
  drift: { id: 'drift', name: 'Drift', hint: 'Propulsion qui part en glisse : un coup de frein, puis gaz et contre-braquage', stats: { accel: 1.04, top: 0.98, grip: 0.95, mass: 0.95, drift: 1 } },
};

/** Famille de chaque voiture de l'atlas (même ordre que CARS). */
const CAR_CLASS: CarClass['id'][] = [
  'vitesse', 'lourde', 'agile', 'equilibree',
  'agile', 'equilibree', 'vitesse', 'agile',
  'equilibree', 'agile', 'vitesse', 'equilibree',
  'lourde', 'lourde', 'vitesse', 'lourde',
  'drift', 'drift', 'drift', 'drift',
  'vitesse',
];

export function carClass(carId: number): CarClass {
  return CLASSES[CAR_CLASS[carId] ?? 'equilibree'];
}

export const carStats = (carId: number): CarStats => carClass(carId).stats;
