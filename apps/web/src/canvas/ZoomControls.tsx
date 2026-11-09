import { useReactFlow, useViewport, type FitViewOptions } from '@xyflow/react';

/** Zoom abajo a la izquierda (spec espacio-de-trabajo, criterio 5): alejar, porcentaje (vuelve al 100 %), acercar y ajustar. */
export function ZoomControls({
  fitPadding,
  motion,
}: {
  fitPadding: FitViewOptions['padding'];
  /** Interruptor de la animación de las conexiones (spec espacio-de-trabajo, criterio 21). */
  motion?: { on: boolean; onToggle: () => void };
}) {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <div className="zoom-controls floating" role="group" aria-label="Zoom">
      <button type="button" className="zoom-button" aria-label="Alejar" data-tip="Alejar · −" onClick={() => void zoomOut()}>
        −
      </button>
      <button
        type="button"
        className="zoom-button zoom-level"
        aria-label={`Zoom ${Math.round(zoom * 100)} %. Volver al 100 %`}
        data-tip="Volver al 100 %"
        onClick={() => void zoomTo(1)}
      >
        {Math.round(zoom * 100)} %
      </button>
      <button type="button" className="zoom-button" aria-label="Acercar" data-tip="Acercar · +" onClick={() => void zoomIn()}>
        +
      </button>
      <button
        type="button"
        className="zoom-button"
        aria-label="Ajustar a la vista"
        data-tip="Ver todo · 0"
        onClick={() => void fitView({ padding: fitPadding, duration: 200 })}
      >
        ⤢
      </button>
      {motion && (
        <button
          type="button"
          className="zoom-button motion-toggle"
          aria-pressed={motion.on}
          aria-label="Animar el sentido de las conexiones"
          data-tip="Animar el sentido de las conexiones · M (flujo documentado, no tráfico real)"
          onClick={motion.onToggle}
        >
          ⇢
        </button>
      )}
    </div>
  );
}
