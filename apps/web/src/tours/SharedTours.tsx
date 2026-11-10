import { TOUR_KIND_TEXT } from './tourKinds';
import { useGraphStore } from '../store/useGraphStore';
import { tourKind, type TourKind } from './flows';

/**
 * Tours y recorridos de un lienzo compartido (spec enlace-solo-lectura, criterio 7; spec tours-y-recorridos): cada
 * tipo con su lista y su botón para verlo. Ocupa el lugar del panel de propiedades, que en un enlace no existe.
 */
export function SharedTours({ onPlay }: { onPlay: (tourId: string) => void }) {
  const tours = Object.values(useGraphStore((s) => s.tours)).sort((a, b) => a.name.localeCompare(b.name));
  const kinds: TourKind[] = ['guide', 'flow'];
  const present = kinds.filter((kind) => tours.some((t) => tourKind(t) === kind));

  return (
    <aside className="properties-panel shared-tours" aria-label="Tours">
      {present.length === 0 && (
        <>
          <h4>Tours</h4>
          <p className="panel-help">Este lienzo no tiene tours ni recorridos.</p>
        </>
      )}
      {present.map((kind) => (
        <section key={kind} className="shared-tours-group" aria-label={TOUR_KIND_TEXT[kind].title}>
          <h4>{TOUR_KIND_TEXT[kind].title}</h4>
          <p className="panel-help">{TOUR_KIND_TEXT[kind].help}</p>
          <ul className="panel-list tours-list">
            {tours
              .filter((t) => tourKind(t) === kind)
              .map((tour) => (
                <li key={tour.id}>
                  <span>
                    {tour.name} <span className="panel-help">({tour.steps.length} pasos)</span>
                  </span>
                  <button
                    type="button"
                    className="pixel-button"
                    aria-label={`${kind === 'flow' ? 'Reproducir recorrido' : 'Ver tour'} ${tour.name}`}
                    disabled={tour.steps.length === 0}
                    onClick={() => onPlay(tour.id)}
                  >
                    {kind === 'flow' ? '▶ Reproducir' : 'Ver tour'}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
