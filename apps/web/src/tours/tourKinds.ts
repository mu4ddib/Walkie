import type { TourKind } from './flows';

/** Qué es cada cosa, en una frase (spec tours-y-recorridos). */
export const TOUR_KIND_TEXT: Record<TourKind, { title: string; help: string; empty: string }> = {
  guide: {
    title: 'Tours',
    help: 'El guía presenta nodos uno a uno, con una nota en cada paso.',
    empty: 'Aún no hay tours. Crea uno para presentar el lienzo a quien llega nuevo.',
  },
  flow: {
    title: 'Recorridos',
    help: 'Reproducen conexiones en orden, de la solicitud a la respuesta.',
    empty: 'Aún no hay recorridos. Selecciona conexiones con Mayús + clic y usa «Crear recorrido», o crea uno vacío.',
  },
};
