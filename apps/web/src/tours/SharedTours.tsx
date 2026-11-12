import { useState } from 'react';
import { ToursSection, type ToursSectionProps } from '../panel/ToursSection';
import { useGraphStore } from '../store/useGraphStore';
import { tourKind, type TourKind } from './flows';

/**
 * Tours y recorridos de un lienzo compartido (spec enlace-solo-lectura, criterio 7; spec tours-a-escala): la misma
 * sección compacta del editor, de solo lectura (pestañas, filas, pasos que se abren para leer la nota, localizar y
 * reproducir). Ocupa el lugar del inspector y sigue a la vista al reproducir, con el paso activo resaltado.
 */
export function SharedTours({
  onPlay,
  ui,
  onUi,
  onLocate,
  playback,
}: Pick<ToursSectionProps, 'ui' | 'onUi' | 'onLocate' | 'playback'> & { onPlay: (tourId: string) => void }) {
  const tours = Object.values(useGraphStore((s) => s.tours));
  const [openTourId, setOpenTourId] = useState<string | null>(null);
  // Si solo hay recorridos, se empieza por ellos.
  const [tab, setTab] = useState<TourKind>(() =>
    tours.length > 0 && tours.every((t) => tourKind(t) === 'flow') ? 'flow' : 'guide',
  );

  return (
    <aside className="properties-panel shared-tours" aria-label="Tours">
      {tours.length === 0 ? (
        <>
          <h4>Tours</h4>
          <p className="panel-help">Este lienzo no tiene tours ni recorridos.</p>
        </>
      ) : (
        <ToursSection
          readOnly
          openTourId={openTourId}
          onOpen={setOpenTourId}
          tab={tab}
          onTab={setTab}
          onPlay={onPlay}
          ui={ui}
          onUi={onUi}
          onLocate={onLocate}
          playback={playback}
        />
      )}
    </aside>
  );
}
