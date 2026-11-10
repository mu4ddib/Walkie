import { useEffect, useRef } from 'react';

/**
 * Menú contextual de una caja o una nota (clic derecho): duplicar, editar y eliminar. Se cierra al elegir,
 * con Escape o al hacer clic fuera.
 */
export function NodeMenu({
  x,
  y,
  count,
  editLabel,
  onDuplicate,
  onEdit,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  /** Cuántas cajas se duplican (la selección, si el clic fue sobre una caja seleccionada). */
  count: number;
  /** "Editar título" o "Editar texto"; `null` si no se edita en el lienzo (componentes y portales). */
  editLabel: string | null;
  onDuplicate: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={ref}
      className="node-menu floating"
      role="menu"
      aria-label="Acciones de la caja"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [...(ref.current?.querySelectorAll('button') ?? [])];
        const next = items.indexOf(document.activeElement as HTMLButtonElement) + (event.key === 'ArrowDown' ? 1 : -1);
        items[(next + items.length) % items.length]?.focus();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={run(onDuplicate)}>
        <span>{count > 1 ? `Duplicar ${count} cajas` : 'Duplicar'}</span>
        <kbd>Ctrl D</kbd>
      </button>
      {editLabel && count <= 1 && (
        <button type="button" role="menuitem" onClick={run(onEdit)}>
          <span>{editLabel}</span>
          <kbd>Doble clic</kbd>
        </button>
      )}
      <button type="button" role="menuitem" className="is-danger" onClick={run(onRemove)}>
        <span>Eliminar</span>
        <kbd>Supr</kbd>
      </button>
    </div>
  );
}
