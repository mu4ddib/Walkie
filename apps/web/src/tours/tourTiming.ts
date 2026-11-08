/** Duraciones del modo tour (ms). Con movimiento reducido no se usan: todo aparece de una vez. */
export const TOUR_TIMING = {
  /** El guía camina hasta el nodo. */
  walk: 800,
  /** Una letra del globo por cada `typing` ms mientras el guía habla. */
  typing: 25,
  /** Desplazamiento de la vista hasta el nodo. */
  pan: 500,
} as const;

/** Zoom con el que se muestra el nodo de cada paso. */
export const TOUR_ZOOM = 1.1;
