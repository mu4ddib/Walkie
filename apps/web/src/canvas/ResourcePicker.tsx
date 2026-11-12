import { useEffect, useRef, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { RESOURCE_KINDS, type ResourceKind } from '../nodes/resourceMeta';
import { nodeColors } from '../theme/palette';
import { PALETTE_RESOURCE_MIME } from './paletteTypes';

/**
 * Lista de subtipos de recurso (spec nodos-de-infraestructura): cada uno con su glifo y una línea de qué es. Un clic
 * (o Enter) lo pone en el centro; arrastrarlo, donde lo sueltes. Se abre con el botón «Recurso» o la tecla 8; las
 * flechas recorren la lista, Esc la cierra y el foco vuelve al botón.
 */
export function ResourcePicker({
  id,
  onPick,
  onClose,
}: {
  id: string;
  onPick: (kind: ResourceKind) => void;
  onClose: (refocus: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);

  // Al abrirse, el foco va al primer subtipo; un clic afuera la cierra.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!list.current?.contains(target) && !target.closest('[data-resource-trigger]')) onClose(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Escape') onClose(true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onDragStart(event: DragEvent, kind: ResourceKind) {
    event.dataTransfer.setData(PALETTE_RESOURCE_MIME, kind);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      id={id}
      ref={list}
      className="resource-picker floating"
      role="menu"
      aria-label="Recursos"
      onKeyDown={onKeyDown}
      style={{ '--node-color': nodeColors.resource } as CSSProperties}
    >
      <p className="resource-picker-help" aria-hidden="true">
        Recurso de infraestructura: elige qué es (o arrástralo al lienzo).
      </p>
      {RESOURCE_KINDS.map(({ kind, label, glyph, help }) => (
        <button
          key={kind}
          type="button"
          role="menuitem"
          className="resource-option"
          draggable
          aria-description={help}
          title={help}
          onDragStart={(e) => onDragStart(e, kind)}
          onClick={() => onPick(kind)}
        >
          <span className="resource-option-glyph" aria-hidden="true">
            {glyph}
          </span>
          <span className="resource-option-text">
            <span className="resource-option-label">{label}</span>
            <span className="resource-option-help" aria-hidden="true">
              {help}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
