import { useId, useState, type FormEvent } from 'react';
import type { Edge, Tour } from '../../schema/walkie-graph';
import { TOUR_NAME_MAX_LENGTH } from '../../store/graphStore';
import { useGraphStore } from '../../store/useGraphStore';
import type { TourKind } from '../../tours/flows';
import { TOUR_KIND_TEXT } from '../../tours/tourKinds';
import { ActionMenu } from './ActionMenu';

/** Desde cuántos tours se ofrece la búsqueda. */
export const SEARCH_FROM = 4;

const steps = (n: number) => (n === 1 ? '1 paso' : `${n} pasos`);

/** Pasos cuya conexión se eliminó (los que hay que reemplazar o quitar). */
function pendingCount(tour: Tour, edges: Record<string, Edge>): number {
  return tour.steps.filter((s) => s.removedEdge || (s.edgeId && !edges[s.edgeId])).length;
}

/**
 * Lista compacta de tours o recorridos (spec tours-compactos): una fila por tour con su nombre, sus pasos y dos acciones
 * a la vista (abrir y reproducir); renombrar, duplicar y eliminar van en «⋯». Con varios, búsqueda por nombre.
 */
export function TourList({
  kind,
  tours,
  query,
  onQuery,
  onOpen,
  onPlay,
}: {
  kind: TourKind;
  tours: Tour[];
  query: string;
  onQuery: (query: string) => void;
  onOpen: (tourId: string) => void;
  onPlay?: (tourId: string) => void;
}) {
  const edges = useGraphStore((s) => s.edges);
  const { renameTour, duplicateTour, removeTour } = useGraphStore((s) => s);
  const [renaming, setRenaming] = useState<string | null>(null);
  const text = TOUR_KIND_TEXT[kind];
  const flow = kind === 'flow';
  const searchId = useId();
  const clean = query.trim().toLocaleLowerCase('es');
  const shown = clean ? tours.filter((t) => t.name.toLocaleLowerCase('es').includes(clean)) : tours;

  return (
    <div className="tour-list">
      <p className="panel-help">{text.help}</p>
      <NewTourForm kind={kind} onCreated={onOpen} />
      {tours.length >= SEARCH_FROM && (
        <div className="panel-field tour-search">
          <label htmlFor={searchId} className="sr-only">
            {flow ? 'Buscar recorridos' : 'Buscar tours'}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder={flow ? 'Buscar recorridos…' : 'Buscar tours…'}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      )}
      {tours.length === 0 ? (
        <p className="panel-help tours-empty">{text.empty}</p>
      ) : shown.length === 0 ? (
        <div className="tours-empty" role="status">
          <p className="panel-help">
            Ningún {flow ? 'recorrido' : 'tour'} se llama «{query.trim()}».
          </p>
          <button type="button" className="link-button" onClick={() => onQuery('')}>
            Limpiar búsqueda
          </button>
        </div>
      ) : (
        <ul className="tour-rows" aria-label={text.title}>
          {shown.map((tour) => {
            const pending = pendingCount(tour, edges);
            const metaId = `tour-meta-${tour.id}`;
            const empty = tour.steps.length === 0;
            return (
              <li key={tour.id} className="tour-row">
                {renaming === tour.id ? (
                  <RenameForm
                    name={tour.name}
                    onDone={(name) => {
                      if (name !== null) renameTour(tour.id, name);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="tour-row-open"
                    title={tour.name}
                    aria-describedby={metaId}
                    onClick={() => onOpen(tour.id)}
                  >
                    {tour.name}
                  </button>
                )}
                <span className="tour-row-meta" id={metaId}>
                  {steps(tour.steps.length)}
                  {pending > 0 && <span className="tour-warning"> · ⚠ {pending} por revisar</span>}
                </span>
                {onPlay && (
                  <button
                    type="button"
                    className="pixel-button is-ghost icon-button"
                    aria-label={flow ? 'Reproducir recorrido' : 'Ver tour'}
                    aria-describedby={metaId}
                    title={empty ? 'Sin pasos todavía' : flow ? 'Reproducir' : 'Ver tour'}
                    disabled={empty}
                    onClick={() => onPlay(tour.id)}
                  >
                    ▶
                  </button>
                )}
                <ActionMenu
                  label="Más acciones"
                  describedBy={metaId}
                  actions={[
                    { label: 'Renombrar', onSelect: () => setRenaming(tour.id) },
                    {
                      label: 'Duplicar',
                      onSelect: () => {
                        const copy = duplicateTour(tour.id);
                        if (copy) onOpen(copy);
                      },
                    },
                    {
                      label: 'Eliminar',
                      danger: true,
                      onSelect: () => {
                        if (window.confirm(`¿Eliminar «${tour.name}»? Se puede deshacer con Ctrl+Z.`)) removeTour(tour.id);
                      },
                    },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Renombrar en la fila: Enter o salir del campo guarda; Esc cancela. */
function RenameForm({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(name);
  return (
    <form
      className="tour-row-rename"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(draft);
      }}
    >
      <input
        type="text"
        aria-label={`Nuevo nombre de «${name}»`}
        value={draft}
        maxLength={TOUR_NAME_MAX_LENGTH}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onDone(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onDone(null);
          }
        }}
      />
    </form>
  );
}

function NewTourForm({ kind, onCreated }: { kind: TourKind; onCreated: (tourId: string) => void }) {
  const addTour = useGraphStore((s) => s.addTour);
  const [name, setName] = useState('');
  const inputId = useId();
  const flow = kind === 'flow';

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = addTour(name, kind);
    if (id) {
      setName('');
      onCreated(id);
    }
  }

  return (
    <form className="tour-new" onSubmit={submit} aria-label={flow ? 'Nuevo recorrido' : 'Nuevo tour'}>
      <label htmlFor={inputId} className="sr-only">
        {flow ? 'Nombre del recorrido nuevo' : 'Nombre del tour nuevo'}
      </label>
      <input
        id={inputId}
        type="text"
        value={name}
        maxLength={TOUR_NAME_MAX_LENGTH}
        placeholder={flow ? 'Nombre del recorrido nuevo' : 'Nombre del tour nuevo'}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="pixel-button is-primary" disabled={!name.trim()}>
        {flow ? 'Nuevo recorrido' : 'Nuevo tour'}
      </button>
    </form>
  );
}
