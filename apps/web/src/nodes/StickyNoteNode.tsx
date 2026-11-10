import { useState, type KeyboardEvent } from 'react';
import type { Node as FlowNode, NodeProps } from '@xyflow/react';
import type { StickyNote } from '../schema/walkie-graph';
import { STICKY_TEXT_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';

export type StickyFlowNode = FlowNode<
  {
    note: StickyNote;
    /** El lienzo lo activa con doble clic (o al crearla). */
    editing: boolean;
    onEditDone: () => void;
    readOnly: boolean;
  },
  'stickyNote'
>;

/**
 * Nota adhesiva: una anotación del lienzo, no un nodo del flujo. Sin puntos de conexión ni tipo; papel claro y
 * texto libre para distinguirla de las cajas. Doble clic la edita; se mueve y se borra como una caja.
 */
export function StickyNoteNode({ id, data, selected }: NodeProps<StickyFlowNode>) {
  const { note, editing, onEditDone, readOnly } = data;
  return (
    <div className="sticky-note" data-selected={selected || undefined} data-empty={!note.text || undefined}>
      {editing ? (
        <StickyInput id={id} text={note.text} onDone={onEditDone} />
      ) : (
        <p className="sticky-note-text" title={readOnly ? undefined : 'Doble clic para editar'}>
          {note.text || 'Doble clic para escribir'}
        </p>
      )}
    </div>
  );
}

/** Texto de la nota: salir del campo o Ctrl+Enter confirma; Escape cancela. */
function StickyInput({ id, text, onDone }: { id: string; text: string; onDone: () => void }) {
  const updateStickyNote = useGraphStore((s) => s.updateStickyNote);
  const [draft, setDraft] = useState(text);

  function commit() {
    updateStickyNote(id, draft);
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit();
    if (event.key === 'Escape') onDone();
    // Supr y Retroceso borran texto, no la nota.
    event.stopPropagation();
  }

  return (
    <textarea
      className="sticky-note-input nodrag nowheel"
      aria-label="Texto de la nota"
      autoFocus
      rows={4}
      value={draft}
      maxLength={STICKY_TEXT_MAX_LENGTH}
      placeholder="Escribe una anotación…"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  );
}
