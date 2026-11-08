import { useEffect } from 'react';
import { SHORTCUTS } from './canvasShortcuts';

/** "?" en el lienzo (spec espacio-de-trabajo, criterio 5): atajos y gestos del editor. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="shortcuts-dialog floating"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title">Atajos del lienzo</h2>
        <dl className="shortcuts-list">
          {SHORTCUTS.map((s) => (
            <div key={s.label}>
              <dt>
                {s.keys.map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="pixel-button" onClick={onClose} autoFocus>
          Cerrar
        </button>
      </div>
    </div>
  );
}
