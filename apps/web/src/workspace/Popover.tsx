import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Botón que abre un panel flotante debajo (selectores de la barra superior). Se cierra con Escape,
 * con clic fuera o cuando el contenido llama a `close`.
 */
export function Popover({
  label,
  buttonLabel,
  className,
  children,
}: {
  /** Nombre accesible del panel. */
  label: string;
  buttonLabel: ReactNode;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className={['popover', className].filter(Boolean).join(' ')} ref={root}>
      <button
        type="button"
        className="popover-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {buttonLabel}
        <span className="popover-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div id={panelId} className="popover-panel floating" role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
