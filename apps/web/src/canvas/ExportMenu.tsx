import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

/**
 * «Exportar» (spec exportar-e-importar): un menú con lo que se puede exportar, cada opción con una línea de para qué
 * sirve: el contexto para IA, la imagen del lienzo, el PDF y el Markdown con imágenes; el archivo de Walkie llega en
 * otra tarea.
 * Flechas recorren, Esc cierra y devuelve el foco al botón.
 */
export function ExportMenu({
  pending,
  onAiContext,
  onMarkdown,
  onImage,
  onPdf,
}: {
  pending: boolean;
  onAiContext: () => void;
  onMarkdown: () => void;
  /** Imagen del lienzo (spec exportar-e-importar, tarea 3). */
  onImage: () => void;
  /** PDF (tarea 4): guarda lo pendiente, genera la imagen del lienzo y la API arma el documento. */
  onPdf: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  function onKeyDown(event: KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Escape') close(true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const choose = (action: () => void) => {
    close(false);
    action();
  };

  return (
    <div className="export-menu">
      <button
        ref={button}
        type="button"
        className="pixel-button is-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
      >
        {pending ? 'Exportando…' : 'Exportar'}
      </button>
      {open && (
        <div
          id={menuId}
          ref={menu}
          className="export-menu-popup floating"
          role="menu"
          aria-label="Exportar"
          onKeyDown={onKeyDown}
        >
          <button type="button" role="menuitem" className="export-option" onClick={() => choose(onAiContext)}>
            <span className="export-option-label">Contexto para IA…</span>
            <span className="export-option-help">
              Todo lo documentado, ordenado para que una IA construya sin inventar (Markdown y JSON).
            </span>
          </button>
          <button type="button" role="menuitem" className="export-option" onClick={() => choose(onImage)}>
            <span className="export-option-label">Imagen (PNG o SVG)…</span>
            <span className="export-option-help">
              Para una presentación, un ticket o un correo: todo el lienzo o lo que se ve.
            </span>
          </button>
          <button type="button" role="menuitem" className="export-option" onClick={() => choose(onPdf)}>
            <span className="export-option-label">PDF</span>
            <span className="export-option-help">
              Documento con portada, el lienzo y tablas, para imprimir o adjuntar. Guarda antes los cambios.
            </span>
          </button>
          <button type="button" role="menuitem" className="export-option" onClick={() => choose(onMarkdown)}>
            <span className="export-option-label">Markdown e imágenes (.zip)</span>
            <span className="export-option-help">Documento para el repo o el wiki, con el diagrama y las capturas.</span>
          </button>
        </div>
      )}
    </div>
  );
}
