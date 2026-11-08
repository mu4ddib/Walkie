import { useGraphStore } from '../store/useGraphStore';

/**
 * Tours de un lienzo compartido (spec enlace-solo-lectura, criterio 7): solo la lista y "Ver tour".
 * Ocupa el lugar del panel de propiedades, que en un enlace no existe.
 */
export function SharedTours({ onPlay }: { onPlay: (tourId: string) => void }) {
  const tours = Object.values(useGraphStore((s) => s.tours)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="properties-panel shared-tours" aria-label="Tours">
      <h4>Tours</h4>
      {tours.length === 0 ? (
        <p className="panel-help">Este lienzo no tiene tours.</p>
      ) : (
        <ul className="panel-list tours-list">
          {tours.map((tour) => (
            <li key={tour.id}>
              <span>
                {tour.name} <span className="panel-help">({tour.steps.length} pasos)</span>
              </span>
              <button
                type="button"
                className="pixel-button"
                aria-label={`Ver tour ${tour.name}`}
                disabled={tour.steps.length === 0}
                onClick={() => onPlay(tour.id)}
              >
                Ver tour
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
