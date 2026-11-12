import { useEffect, useId, useState } from 'react';
import { useExportFeature } from '../api/hooks';
import { saveFile } from '../ui/download';
import { approxTokens } from './aiContext';
import '../share/share.css';

/**
 * «Contexto para IA» (spec exportar-e-importar, tarea 1): carga el Markdown de la última versión guardada y deja
 * copiarlo al portapapeles o descargarlo, y descargar el mismo contexto en JSON (para agentes). Muestra su tamaño
 * aproximado en tokens. Con cambios sin guardar avisa que no se incluyen. Esc o «Cerrar» lo cierran.
 */
export function AiContextDialog({ featureId, dirty, onClose }: { featureId: string; dirty: boolean; onClose: () => void }) {
  const markdown = useExportFeature(featureId);
  const json = useExportFeature(featureId);
  const { mutate: load } = markdown;
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const titleId = useId();

  useEffect(() => {
    load('ai', { onSuccess: (file) => void file.blob.text().then(setText) });
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    if (text === null) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  function downloadMarkdown() {
    if (markdown.data) saveFile(markdown.data.blob, markdown.data.fileName);
  }

  async function downloadJson() {
    try {
      const file = await json.mutateAsync('ai-json');
      saveFile(file.blob, file.fileName);
    } catch {
      // El error lo muestra `json.isError`.
    }
  }

  const tokens = text === null ? null : approxTokens(text);

  return (
    <div className="share-backdrop" onClick={onClose}>
      <div
        className="share-dialog ai-context-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Contexto para IA</h2>
        <p className="panel-help">
          Propósito, glosario, componentes con su contrato, flujos de punta a punta, reglas, relaciones y lo que falta
          documentar. Pégalo en un chat antes de pedirle que construya; el JSON sirve a agentes que leen estructura.
        </p>
        {dirty && (
          <p role="note" className="share-warning">
            Se exporta lo guardado: los cambios sin guardar no se incluyen.
          </p>
        )}
        {markdown.isError ? (
          <p role="alert" className="save-error">
            No se pudo preparar el contexto. Revisa la conexión y vuelve a intentarlo.
          </p>
        ) : text === null ? (
          <p role="status">Preparando el contexto…</p>
        ) : (
          <>
            <p role="status" className="ai-context-size">
              ≈ {tokens!.toLocaleString('es')} tokens · {text.length.toLocaleString('es')} caracteres
            </p>
            <pre className="ai-context-preview" tabIndex={0} aria-label="Vista previa del contexto">
              {text}
            </pre>
          </>
        )}
        <div className="ai-context-actions">
          <button type="button" className="pixel-button is-primary" disabled={text === null} onClick={() => void copy()}>
            {copied ? 'Copiado ✓' : 'Copiar al portapapeles'}
          </button>
          <button type="button" className="pixel-button" disabled={!markdown.data} onClick={downloadMarkdown}>
            Descargar .md
          </button>
          <button type="button" className="pixel-button" disabled={json.isPending} onClick={() => void downloadJson()}>
            Descargar JSON
          </button>
          <button type="button" className="pixel-button is-ghost share-close" onClick={onClose}>
            Cerrar
          </button>
        </div>
        {json.isError && (
          <p role="alert" className="save-error">
            No se pudo descargar el JSON. Vuelve a intentarlo.
          </p>
        )}
      </div>
    </div>
  );
}
