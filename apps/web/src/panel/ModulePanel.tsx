import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { v7 as uuidv7 } from 'uuid';
import { ApiError, getCanvas, saveCanvas, type ModuleSummary } from '../api/client';
import { useCreateModule, useDeleteModule, useToken } from '../api/hooks';
import { moduleTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { useOpenModule } from '../canvas/useOpenModule';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { interfaceKindLabel, interfaceSignature, matchesInterface, placeableModules, usedInterfaces } from '../modules/moduleMeta';
import { ModuleDetailsForm, ModuleUsesList } from '../modules/ModuleParts';
import type { Node } from '../schema/walkie-graph';
import { useGraphStore } from '../store/useGraphStore';

/**
 * Inspector de la caja de un módulo (spec modulos-compartidos, criterio 18): separa «En este lienzo» (presentación local
 * y las interfaces que usa aquí) de «Definición compartida» (nombre, descripción, interfaces y usos, que cambian en todas
 * las features). «Crear copia independiente» es la única forma de separarse del módulo.
 */
export function ModulePanel({ node }: { node: Node }) {
  const { appId, modules, share } = useCanvasCatalog();
  const module = moduleTarget(node, modules);
  const openModule = useOpenModule();

  if (!module) return <MissingModule node={node} />;
  return (
    <>
      <h3>
        <span aria-hidden="true">{NODE_LABELS.module.glyph}</span> Módulo · {module.name}
      </h3>
      <p className="panel-help">
        Caja de un módulo compartido: su contenido y sus interfaces son los mismos en todos los lienzos que lo usan. La
        posición, el tamaño y lo que se muestra son de este lienzo.
      </p>
      {!share && (
        <div className="panel-actions">
          <button type="button" className="pixel-button is-primary" onClick={() => openModule(module.id, { nodeId: node.id })}>
            Abrir módulo
          </button>
        </div>
      )}
      <InThisCanvas node={node} module={module} />
      <AllInterfaces node={node} module={module} onOpen={(focus) => openModule(module.id, { nodeId: node.id, focus })} />
      {appId && !share && (
        <section className="panel-section shared-definition" aria-label="Definición compartida">
          <h4>Definición compartida</h4>
          <p className="panel-help">
            {module.usedBy.length <= 1
              ? 'Editar el nombre o la descripción cambia el módulo para todos.'
              : `Editar el nombre o la descripción cambia el módulo en los ${module.usedBy.length} lienzos que lo usan.`}
          </p>
          <ModuleDetailsForm key={`${module.name}\n${module.description ?? ''}`} appId={appId} module={module} />
          <details className="panel-details">
            <summary>Ver usos ({module.usedBy.length})</summary>
            <UsesHere appId={appId} moduleId={module.id} />
          </details>
          <IndependentCopy node={node} module={module} />
        </section>
      )}
    </>
  );
}

/** «En este lienzo»: qué se muestra en la caja y qué interfaces usa aquí. */
function InThisCanvas({ node, module }: { node: Node; module: ModuleSummary }) {
  const setModuleDisplay = useGraphStore((s) => s.setModuleDisplay);
  const usedKey = useGraphStore((s) => usedInterfaces(s.edges, node.id).join('\n'));
  const used = usedKey ? usedKey.split('\n').map((pair) => JSON.parse(pair) as { id: string; name: string }) : [];
  return (
    <section className="panel-section" aria-label="En este lienzo">
      <h4>En este lienzo</h4>
      <label className="panel-check">
        <input
          type="checkbox"
          checked={node.display?.description !== false}
          onChange={(e) => setModuleDisplay(node.id, { description: e.target.checked })}
        />
        Mostrar la descripción
      </label>
      <label className="panel-check">
        <input
          type="checkbox"
          checked={node.display?.interfaces !== false}
          onChange={(e) => setModuleDisplay(node.id, { interfaces: e.target.checked })}
        />
        Mostrar las interfaces usadas
      </label>
      {used.length === 0 ? (
        <p className="panel-help">Ninguna conexión de este lienzo llega a una interfaz concreta.</p>
      ) : (
        <ul className="panel-list" aria-label="Interfaces usadas aquí">
          {used.map((ref) => {
            const iface = module.interfaces.find((i) => i.id === ref.id);
            return (
              <li key={ref.id} className={iface ? undefined : 'panel-warning'}>
                {iface ? iface.name : `⚠ ${ref.name} (ya no existe: reasígnala en la conexión)`}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Todas las interfaces del módulo, con búsqueda; cada una se abre en el módulo con su caja enfocada. */
function AllInterfaces({ module, onOpen }: { node: Node; module: ModuleSummary; onOpen: (nodeId: string) => void }) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const shown = module.interfaces.filter((i) => matchesInterface(i, query));
  return (
    <section className="panel-section" aria-label="Interfaces del módulo">
      <h4>Interfaces ({module.interfaces.length})</h4>
      {module.interfaces.length === 0 ? (
        <p className="panel-help">El módulo aún no expone interfaces. Ábrelo y, en una caja, elige «Exponer como interfaz».</p>
      ) : (
        <>
          {module.interfaces.length > 4 && (
            <>
              <label className="sr-only" htmlFor={searchId}>
                Buscar interfaces del módulo
              </label>
              <input id={searchId} type="search" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </>
          )}
          <ul className="module-iface-list">
            {shown.map((iface) => (
              <li key={iface.id}>
                <span className="module-iface-kind" data-kind={iface.kind}>
                  {interfaceKindLabel(iface.kind)}
                </span>
                <span>
                  <strong>{iface.name}</strong>
                  {interfaceSignature(iface) && <code className="module-node-iface-sig"> {interfaceSignature(iface)}</code>}
                </span>
                <button type="button" className="link-button" onClick={() => onOpen(iface.nodeId)} aria-label={`Abrir ${iface.name} en el módulo`}>
                  Abrir
                </button>
              </li>
            ))}
          </ul>
          <p className="panel-help">Para conectar con una, arrastra una conexión hasta la caja y elígela en el selector.</p>
        </>
      )}
    </section>
  );
}

function UsesHere({ appId, moduleId }: { appId: string; moduleId: string }) {
  const navigate = useNavigate();
  return <ModuleUsesList appId={appId} moduleId={moduleId} onOpen={(path) => void navigate(path)} />;
}

/**
 * «Crear copia independiente»: un módulo nuevo con el mismo lienzo (y los mismos ids de interfaz, así las conexiones de
 * esta caja siguen unidas). Solo esta caja pasa a la copia; las demás siguen con el original.
 */
function IndependentCopy({ node, module }: { node: Node; module: ModuleSummary }) {
  const { appId } = useCanvasCatalog();
  const token = useToken();
  const create = useCreateModule(appId);
  const remove = useDeleteModule(appId);
  const relinkModule = useGraphStore((s) => s.relinkModule);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    if (!window.confirm(`Esta caja dejará de usar «${module.name}» y pasará a una copia propia. Los cambios a una no llegarán a la otra.`)) return;
    setPending(true);
    setError(null);
    let created: ModuleSummary | null = null;
    try {
      created = await create.mutateAsync({ id: uuidv7(), name: `${module.name} (copia)`.slice(0, 120), description: module.description });
      const graph = await getCanvas(token, module.id);
      await saveCanvas(token, created.id, { ...graph, version: 0 });
      relinkModule(node.id, { id: created.id, name: created.name }, { keepInterfaces: true });
    } catch (e) {
      // Sin lienzo, la copia no sirve: se borra (no queda un módulo vacío suelto).
      if (created) await remove.mutateAsync({ moduleId: created.id, force: true }).catch(() => undefined);
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo crear la copia.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel-subsection">
      <button type="button" className="pixel-button" disabled={pending} onClick={() => void copy()}>
        {pending ? 'Copiando…' : 'Crear copia independiente'}
      </button>
      {error && (
        <p role="alert" className="save-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Caja de un módulo que ya no existe: lo dice con su último nombre y deja apuntarla a otro (spec, criterio 16). */
function MissingModule({ node }: { node: Node }) {
  const { modules, currentModuleId } = useCanvasCatalog();
  const relinkModule = useGraphStore((s) => s.relinkModule);
  const options = useMemo(() => (modules ? placeableModules(modules, currentModuleId) : []), [modules, currentModuleId]);
  const selectId = useId();
  return (
    <>
      <h3>
        <span aria-hidden="true">{NODE_LABELS.module.glyph}</span> Módulo no encontrado
      </h3>
      <p className="panel-help">
        El módulo ya no existe en la app. Último nombre conocido: <strong>{node.title}</strong>. Sus conexiones se conservan:
        apunta la caja a otro módulo o bórrala con Supr.
      </p>
      {options.length > 0 && (
        <div className="panel-field">
          <label htmlFor={selectId}>Reasignar a</label>
          <select
            id={selectId}
            value=""
            onChange={(e) => {
              const target = modules?.[e.target.value];
              if (target) relinkModule(node.id, { id: target.id, name: target.name });
            }}
          >
            <option value="">Elige un módulo…</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
