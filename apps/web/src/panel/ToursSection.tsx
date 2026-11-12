import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { tourKind, type TourKind, type TourStep } from '../tours/flows';
import { TOUR_KIND_TEXT } from '../tours/tourKinds';
import { TourDetail } from './tours/TourDetail';
import { TourList } from './tours/TourList';
import { EMPTY_TOURS_UI, type ToursUi } from './tours/toursUi';

export interface ToursSectionProps {
  /** Tour o recorrido abierto en el editor (lo guarda el lienzo para no perderlo al seleccionar un nodo). */
  openTourId: string | null;
  onOpen: (tourId: string | null) => void;
  /** Pestaña visible (la guarda el lienzo); sin ella, la sección la recuerda mientras está montada. */
  tab?: TourKind;
  onTab?: (tab: TourKind) => void;
  /** "Ver tour" / "Reproducir recorrido"; sin él, el botón no aparece. */
  onPlay?: (tourId: string) => void;
  /** Recorrido recién creado: su nombre se enfoca para escribirlo. */
  createdTourId?: string | null;
  /** Agregar pasos tocando conexiones en el lienzo (lo atiende el lienzo); sin él, la opción no aparece. */
  picking?: { tourId: string | null; onToggle: (tourId: string | null) => void };
  /** Estado de interfaz (pasos abiertos, búsquedas, desplazamiento): lo guarda el lienzo; sin él, la sección. */
  ui?: ToursUi;
  onUi?: (update: (ui: ToursUi) => ToursUi) => void;
  /** Centrar y resaltar en el lienzo el nodo o la conexión de un paso. */
  onLocate?: (step: TourStep) => void;
  /** Reproducción en curso: se muestra ese tour, de solo lectura, con su paso activo. */
  playback?: { tourId: string; step: number; onJump: (step: number) => void } | null;
  /** Solo lectura (enlace compartido): lista y pasos para leer, localizar y reproducir; nada se edita. */
  readOnly?: boolean;
}

/**
 * Tours y recorridos de la feature (spec modo-tour; recorridos-y-grupos; tours-y-recorridos; tours-compactos): dos
 * pestañas y dos niveles. La lista compacta (con búsqueda) y, al abrir uno, su detalle en el mismo panel con «Volver»;
 * al volver se recuperan la búsqueda y el desplazamiento. Todo cambio del grafo pasa por el store; lo demás es interfaz.
 */
export function ToursSection(props: ToursSectionProps) {
  const { openTourId, onOpen, tab, onTab, onPlay, createdTourId, picking, playback } = props;
  const tours = useGraphStore((s) => s.tours);
  const [localTab, setLocalTab] = useState<TourKind>('guide');
  const [localUi, setLocalUi] = useState<ToursUi>(EMPTY_TOURS_UI);
  const ui = props.ui ?? localUi;
  const setUi = props.onUi ?? ((update: (ui: ToursUi) => ToursUi) => setLocalUi(update));
  const root = useRef<HTMLElement>(null);
  const panelId = useId();

  // Durante la reproducción se ve ese tour; si no, el abierto (si existe).
  const shownId = playback?.tourId ?? openTourId;
  const shown = shownId ? tours[shownId] : undefined;
  const active: TourKind = shown ? tourKind(shown) : (tab ?? localTab);
  const byKind = (kind: TourKind) =>
    Object.values(tours)
      .filter((t) => tourKind(t) === kind)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  /** El contenedor que se desplaza: el inspector. */
  const scroller = () => root.current?.closest<HTMLElement>('.properties-panel') ?? null;

  // Abrir un tour lleva al principio del detalle; volver recupera el lugar de la lista.
  const previous = useRef(shownId);
  useLayoutEffect(() => {
    const container = scroller();
    if (container && previous.current !== shownId) {
      container.scrollTop = shownId ? 0 : ui.listScroll[active];
    }
    previous.current = shownId;
    // Solo al cambiar de vista (lista ↔ detalle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  const select = (next: TourKind) => {
    setLocalTab(next);
    onTab?.(next);
    if (shown && tourKind(shown) !== next) onOpen(null);
  };
  const open = (tourId: string) => {
    const top = scroller()?.scrollTop ?? 0;
    setUi((u) => ({ ...u, listScroll: { ...u.listScroll, [active]: top } }));
    onOpen(tourId);
  };
  const back = () => {
    if (shown) select(tourKind(shown));
    onOpen(null);
  };

  return (
    <section className="panel-section tours-section" aria-label="Tours y recorridos" ref={root}>
      <div className="tours-tabs" role="tablist" aria-label="Tours y recorridos">
        {(['guide', 'flow'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            id={`${panelId}-${kind}`}
            aria-selected={active === kind}
            aria-controls={panelId}
            className="tours-tab"
            disabled={!!playback && active !== kind}
            onClick={() => select(kind)}
          >
            {TOUR_KIND_TEXT[kind].title} <span className="tours-tab-count">{byKind(kind).length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${active}`} className="tours-panel">
        {shown ? (
          <TourDetail
            key={shown.id}
            tourId={shown.id}
            kind={tourKind(shown)}
            onBack={back}
            onPlay={onPlay}
            focusName={createdTourId === shown.id}
            open={ui.open[shown.id] ?? []}
            onOpen={(next) => setUi((u) => ({ ...u, open: { ...u.open, [shown.id]: next } }))}
            onLocate={props.onLocate}
            picking={picking}
            playback={playback ? { step: playback.step, onJump: playback.onJump } : undefined}
            onOpenTour={open}
            readOnly={props.readOnly}
          />
        ) : (
          <TourList
            kind={active}
            tours={byKind(active)}
            query={ui.query[active]}
            onQuery={(query) => setUi((u) => ({ ...u, query: { ...u.query, [active]: query } }))}
            onOpen={open}
            onPlay={onPlay}
            readOnly={props.readOnly}
          />
        )}
      </div>
    </section>
  );
}
