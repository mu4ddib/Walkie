import { useEffect, useId, useState, type ReactNode } from 'react';
import { saveFile } from '../ui/download';
import { imageFileName, requestCanvasImage, type ImageOptions } from './canvasImage';
import '../share/share.css';

/**
 * «Imagen del lienzo» (spec exportar-e-importar, tarea 3): PNG o SVG, de todo el lienzo o de lo que se ve, a 1× o 2×
 * (PNG), con fondo claro y las imágenes de las pantallas. Se genera en el navegador con lo que hay en el lienzo ahora
 * (también lo que aún no se guardó). Esc o «Cerrar» lo cierran.
 */
export function ImageExportDialog({ featureName, onClose }: { featureName?: string; onClose: () => void }) {
  const [options, setOptions] = useState<ImageOptions>({ format: 'png', scope: 'all', scale: 2 });
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function download() {
    setState('working');
    setError(null);
    try {
      const blob = await requestCanvasImage(options);
      saveFile(blob, imageFileName(featureName, options));
      setState('done');
    } catch (e) {
      const empty = e instanceof Error && e.message === 'El lienzo está vacío.';
      setError(empty ? 'El lienzo está vacío.' : 'No se pudo generar la imagen.');
      setState('error');
    }
  }

  const set = (patch: Partial<ImageOptions>) => {
    setOptions((o) => ({ ...o, ...patch }));
    setState('idle');
  };

  return (
    <div className="share-backdrop" onClick={onClose}>
      <div
        className="share-dialog image-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Imagen del lienzo</h2>
        <p className="panel-help">
          Para una presentación, un ticket o un correo. Sale con fondo claro y las imágenes de las pantallas; incluye
          lo que aún no guardaste.
        </p>
        <Choice legend="Formato">
          <Option
            name="format"
            checked={options.format === 'png'}
            onChange={() => set({ format: 'png' })}
            label="PNG"
            help="Imagen para pegar en cualquier lado."
          />
          <Option
            name="format"
            checked={options.format === 'svg'}
            onChange={() => set({ format: 'svg' })}
            label="SVG"
            help="Vectorial: se amplía sin perder nitidez."
          />
        </Choice>
        <Choice legend="Qué incluir">
          <Option
            name="scope"
            checked={options.scope === 'all'}
            onChange={() => set({ scope: 'all' })}
            label="Todo el lienzo"
            help="Todas las cajas, encuadradas."
          />
          <Option
            name="scope"
            checked={options.scope === 'visible'}
            onChange={() => set({ scope: 'visible' })}
            label="Lo que se ve"
            help="Como está en pantalla ahora."
          />
        </Choice>
        {options.format === 'png' && (
          <Choice legend="Resolución">
            <Option
              name="scale"
              checked={options.scale === 1}
              onChange={() => set({ scale: 1 })}
              label="1×"
              help="Más liviana."
            />
            <Option
              name="scale"
              checked={options.scale === 2}
              onChange={() => set({ scale: 2 })}
              label="2×"
              help="Nítida en pantallas de alta densidad."
            />
          </Choice>
        )}
        <div className="ai-context-actions">
          <button
            type="button"
            className="pixel-button is-primary"
            disabled={state === 'working'}
            onClick={() => void download()}
          >
            {state === 'working' ? 'Generando…' : 'Descargar imagen'}
          </button>
          <span role="status" className="image-export-status">
            {state === 'done' ? `Descargada: ${imageFileName(featureName, options)}` : ''}
          </span>
          <button type="button" className="pixel-button is-ghost share-close" onClick={onClose}>
            Cerrar
          </button>
        </div>
        {error && (
          <p role="alert" className="save-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Choice({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="image-export-choice">
      <legend>{legend}</legend>
      <div className="image-export-options">{children}</div>
    </fieldset>
  );
}

function Option({
  name,
  checked,
  onChange,
  label,
  help,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  help: string;
}) {
  return (
    <label className="image-export-option" data-checked={checked || undefined}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>
        <span className="image-export-option-label">{label}</span>
        <span className="image-export-option-help">{help}</span>
      </span>
    </label>
  );
}
