/** Fréquence de la simulation (serveur et prédiction client). */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Le serveur envoie un instantané tous les N ticks (30 Hz). */
export const SNAPSHOT_EVERY = 2;

/** Largeur d'une voiture (unités monde = pixels de l'image du circuit). */
export const CAR_WIDTH = 28;
/** Une voiture fait 1/4 de la largeur de la chaussée : quatre de front au maximum. */
export const ROAD_WIDTH = CAR_WIDTH * 4;
export const CAR_LENGTH = 50;
/** Largeur des vibreurs rouges et blancs de chaque côté de la chaussée. */
export const KERB_WIDTH = 6;
/** Distance entre l'axe de la piste et le mur de pneus. */
export const WALL_DIST = ROAD_WIDTH / 2 + KERB_WIDTH + 44;

export const MAX_PLAYERS = 8;
export const MIN_LAPS = 1;
export const MAX_LAPS = 9;
export const DEFAULT_LAPS = 3;
/** 3 secondes de feux avant le départ. */
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
/** Après l'arrivée du premier, les autres ont encore ce temps pour finir. */
export const FINISH_GRACE_TICKS = 25 * TICK_RATE;
export const RECONNECT_GRACE_MS = 30_000;
