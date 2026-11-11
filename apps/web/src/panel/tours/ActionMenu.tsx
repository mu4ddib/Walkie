import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuAction {
  label: string;
  /** Nombre accesible si el visible no basta (ej. «Quitar paso 3»). */
  ariaLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * Menú compacto de acciones secundarias (spec tours-compactos): un botón «⋯» que abre una lista. Esc o un clic fuera
 * lo cierran y el foco vuelve al botón; ↑ ↓ recorren las opciones.
 */
export function ActionMenu({ label, actions, describedBy }: { label: string; actions: MenuAction[]; describedBy?: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="action-menu" ref={root} onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className="pixel-button is-ghost icon-button action-menu-button"
        aria-label={label}
        aria-describedby={describedBy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // `title` y no `data-tip`: el globo pegado al borde ensancharía el inspector (spec tours-y-recorridos, tarea 3).
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div id={menuId} className="action-menu-list floating" role="menu" aria-label={label}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="action-menu-item"
              data-danger={action.danger || undefined}
              aria-label={action.ariaLabel}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                button.current?.focus();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
