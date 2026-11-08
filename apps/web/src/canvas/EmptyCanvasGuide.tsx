import type { NodeType } from '../store/graphStore';

/**
 * Lienzo vacío (spec espacio-de-trabajo, criterio 4): qué hacer primero, sin tapar la barra de herramientas.
 * Las acciones no repiten los nombres de los botones de la barra, así las pruebas los encuentran sin ambigüedad.
 */
export function EmptyCanvasGuide({ onAdd, onHelp }: { onAdd: (type: NodeType) => void; onHelp: () => void }) {
  return (
    <div className="empty-guide" role="note" aria-label="Cómo empezar">
      <h2>Empieza por la primera pantalla</h2>
      <p>
        Agrega cajas desde la barra de la izquierda (o con las teclas <kbd>1</kbd>–<kbd>7</kbd>) y únelas arrastrando
        desde el punto derecho de una caja hasta otra.
      </p>
      <div className="empty-guide-actions">
        <button type="button" className="pixel-button is-primary" onClick={() => onAdd('screen')}>
          Agregar una pantalla
        </button>
        <button type="button" className="pixel-button" onClick={() => onAdd('actor')}>
          Agregar un actor
        </button>
        <button type="button" className="pixel-button is-ghost" onClick={onHelp}>
          Ver atajos
        </button>
      </div>
    </div>
  );
}
