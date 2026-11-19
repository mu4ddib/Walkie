import { useId, useState, type DragEvent } from 'react';
import './discovery.css';

const SCAN = 'walkie scan .';
/** La CLI se distribuye hoy como herramienta .NET desde el repositorio de Walkie (apps/cli/CLAUDE.md). */
const INSTALL = [
  'dotnet pack apps/cli/src/Walkie.Cli -c Release -o ./walkie-cli',
  'dotnet tool install --global Walkie.Cli --add-source ./walkie-cli',
];

/**
 * Los dos pasos para traer un proyecto local (spec walkie-live, tareas 5 y 10): cómo generar el `.walkiepack` con la
 * CLI (copiable, cómo instalarla y qué lee) y elegirlo o arrastrarlo. Lo comparten «Importar proyecto local» (a una app
 * existente) y «Crear app desde proyecto local» (una app nueva); cada diálogo decide qué hace con el archivo.
 * `hidePicker` lo oculta cuando ya no se puede cambiar (después de guardar).
 */
export function PackSteps({ file, onChoose, hidePicker = false }: { file: File | null; onChoose: (file: File | null) => void; hidePicker?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    onChoose(e.dataTransfer.files[0] ?? null);
  }

  return (
        <ol className="discovery-steps">
          <li>
            En la raíz del proyecto, ejecuta:
            <Copyable text={SCAN} />
            <span>
              Genera <code>architecture.walkiepack</code> en esa carpeta.
            </span>
            <details className="discovery-details">
              <summary>Cómo instalar walkie</summary>
              <p>
                Es una herramienta de .NET (necesita el SDK de .NET 10). Hoy se instala desde el repositorio de Walkie; desde su raíz:
              </p>
              {INSTALL.map((command) => (
                <Copyable key={command} text={command} />
              ))}
              <p>
                Sin instalarla: <code>dotnet run --project apps/cli/src/Walkie.Cli -- scan &lt;carpeta&gt;</code>. Opciones:{' '}
                <code>walkie --help</code>.
              </p>
            </details>
            <p className="discovery-note">
              Solo lee archivos: no compila, no instala dependencias ni ejecuta nada del proyecto. No lee <code>.env</code>, claves ni
              certificados, y la evidencia lleva rutas relativas y líneas, sin código. La primera vez crea{' '}
              <code>.walkie/source.json</code> con el id de la fuente: versiónalo para que Walkie reconozca los análisis siguientes.
            </p>
          </li>
          <li>
            Elige el archivo generado:
            {!hidePicker && (
              <label
                htmlFor={inputId}
                className={`discovery-drop ${dragging ? 'is-dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <span>{file ? file.name : 'Arrastra aquí el .walkiepack o haz clic para elegirlo'}</span>
                <input
                  id={inputId}
                  type="file"
                  accept=".walkiepack,application/zip"
                  aria-label="Archivo .walkiepack"
                  onChange={(e) => onChoose(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </li>
        </ol>
  );
}

/** Un comando con su botón de copiar. */
function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="discovery-command">
      <code>{text}</code>
      <button
        type="button"
        className="pixel-button is-ghost"
        aria-label={`Copiar ${text}`}
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </span>
  );
}
