import { useId, useState, type FormEvent } from 'react';
import { ApiError, type ModuleSummary } from '../api/client';
import { useModuleUsages, useUpdateModule } from '../api/hooks';
import { featurePath, modulePath } from '../workspace/paths';

/** Lienzos que referencian el módulo; cada uno se abre con su caja seleccionada (spec, criterio 21). */
export function ModuleUsesList({
  moduleId,
  appId,
  onOpen,
}: {
  moduleId: string;
  appId: string;
  onOpen: (path: string) => void;
}) {
  const usages = useModuleUsages(moduleId);
  if (usages.isPending) return <p className="module-uses-empty">Buscando dónde se usa…</p>;
  if (usages.error) return <p role="alert">No se pudieron cargar los usos.</p>;
  if (usages.data.length === 0) {
    return <p className="module-uses-empty">Ninguna feature lo usa todavía. Ponlo en un lienzo desde el panel del catálogo.</p>;
  }
  return (
    <ul className="module-uses">
      {usages.data.map((u) => {
        const path = (u.kind === 'module' ? modulePath(appId, u.featureId) : featurePath(appId, u.featureId)) + `?select=${u.nodes[0]}`;
        const iface = new Set(u.edges.map((e) => e.interfaceId).filter(Boolean)).size;
        return (
          <li key={u.featureId}>
            <a
              href={path}
              onClick={(e) => {
                e.preventDefault();
                onOpen(path);
              }}
            >
              {u.kind === 'module' ? `Módulo · ${u.name}` : u.name}
            </a>
            <span className="module-uses-meta">
              {u.edges.length} {u.edges.length === 1 ? 'conexión' : 'conexiones'} · {iface} {iface === 1 ? 'interfaz' : 'interfaces'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Nombre y descripción del módulo: cambian en todas las features (se dice antes de guardar). */
export function ModuleDetailsForm({ appId, module, onDone }: { appId: string; module: ModuleSummary; onDone?: () => void }) {
  const update = useUpdateModule(appId);
  const [name, setName] = useState(module.name);
  const [description, setDescription] = useState(module.description ?? '');
  const nameId = useId();
  const descriptionId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await update.mutateAsync({ moduleId: module.id, changes: { name: name.trim(), description: description.trim() } });
      onDone?.();
    } catch {
      // El error se muestra abajo.
    }
  }

  return (
    <form className="module-details-form" aria-label="Definición del módulo" onSubmit={(e) => void submit(e)}>
      <label htmlFor={nameId}>Nombre del módulo</label>
      <input id={nameId} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <label htmlFor={descriptionId}>Descripción</label>
      <textarea id={descriptionId} value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} />
      <p className="module-shared-note">
        Cambia en {module.usedBy.length === 1 ? 'el lienzo que lo usa' : `los ${module.usedBy.length} lienzos que lo usan`}.
      </p>
      <button type="submit" className="pixel-button is-primary" disabled={!name.trim() || update.isPending}>
        {update.isPending ? 'Guardando…' : 'Guardar definición'}
      </button>
      {update.error && (
        <p role="alert" className="save-error">
          {update.error instanceof ApiError ? update.error.userMessage : 'No se pudo guardar.'}
        </p>
      )}
    </form>
  );
}

