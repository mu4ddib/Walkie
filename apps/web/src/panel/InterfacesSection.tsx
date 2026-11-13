import { useId, useState } from 'react';
import { useModuleUsages } from '../api/hooks';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { interfaceKindHelp, interfaceKindLabel } from '../modules/moduleMeta';
import type { ModuleInterface, Node } from '../schema/walkie-graph';
import {
  INTERFACE_DESCRIPTION_MAX_LENGTH,
  INTERFACE_KINDS,
  INTERFACE_NAME_MAX_LENGTH,
  interfaceNameTaken,
  type InterfaceKind,
} from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { isFlowTour } from '../tours/flows';
import { TextField } from './TextField';

/** Tipo sugerido al exponer una caja: una API se ofrece; una cola o tópico, evento; lo demás, se ofrece. */
function suggestedKind(node: Node): InterfaceKind {
  if (node.type === 'resource' && (node.resource?.kind === 'queue' || node.resource?.kind === 'topic')) return 'event';
  return 'provides';
}

/**
 * Interfaces de una caja en el lienzo de un módulo (spec modulos-compartidos, criterios 14 y 15): «Exponer como
 * interfaz» y, por cada una, nombre, tipo, descripción y recorrido interno. Renombrar no rompe conexiones (van por id).
 */
export function NodeInterfaces({ node }: { node: Node }) {
  const interfaces = useGraphStore((s) => s.interfaces);
  const addInterface = useGraphStore((s) => s.addInterface);
  const mine = Object.values(interfaces).filter((i) => i.nodeId === node.id);

  function expose() {
    let name = node.title.trim().slice(0, INTERFACE_NAME_MAX_LENGTH) || 'Interfaz';
    for (let n = 2; interfaceNameTaken(interfaces, name); n++) name = `${node.title.slice(0, INTERFACE_NAME_MAX_LENGTH - 4)} ${n}`;
    addInterface({ name, kind: suggestedKind(node), nodeId: node.id });
  }

  return (
    <section className="panel-section module-interfaces" aria-label="Interfaces del módulo">
      <h4>Interfaz del módulo</h4>
      {mine.length === 0 ? (
        <p className="panel-help">Las features solo se conectan a lo que el módulo expone. Expón esta caja para usarla desde fuera.</p>
      ) : (
        mine.map((i) => <InterfaceEditor key={i.id} item={i} />)
      )}
      <button type="button" className="pixel-button" onClick={expose}>
        {mine.length === 0 ? 'Exponer como interfaz' : 'Exponer otra interfaz'}
      </button>
    </section>
  );
}

/** Lista de las interfaces del módulo (inspector sin selección): ir a su caja. */
export function ModuleInterfacesOverview({ onSelect }: { onSelect?: (target: { nodeId?: string }) => void }) {
  const interfaces = useGraphStore((s) => s.interfaces);
  const nodes = useGraphStore((s) => s.nodes);
  const list = Object.values(interfaces).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return (
    <section className="panel-section module-interfaces" aria-label="Interfaces del módulo">
      <h4>Interfaces del módulo ({list.length})</h4>
      {list.length === 0 ? (
        <p className="panel-help">
          Aún no expone ninguna. Selecciona una caja (una API, un servicio, una cola…) y elige «Exponer como interfaz»: así
          las features se conectan a ella.
        </p>
      ) : (
        <ul className="module-iface-list">
          {list.map((i) => (
            <li key={i.id}>
              <span className="module-iface-kind" data-kind={i.kind}>
                {interfaceKindLabel(i.kind)}
              </span>
              <button type="button" className="link-button" onClick={() => onSelect?.({ nodeId: i.nodeId })}>
                {i.name}
              </button>
              <span className="panel-help">{nodes[i.nodeId]?.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InterfaceEditor({ item }: { item: ModuleInterface }) {
  const interfaces = useGraphStore((s) => s.interfaces);
  const tours = useGraphStore((s) => s.tours);
  const updateInterface = useGraphStore((s) => s.updateInterface);
  const [removing, setRemoving] = useState(false);
  const kindId = useId();
  const tourId = useId();
  const flows = Object.values(tours).filter(isFlowTour);

  return (
    <div className="interface-editor">
      <TextField
        label="Nombre de la interfaz"
        value={item.name}
        maxLength={INTERFACE_NAME_MAX_LENGTH}
        validate={(name) =>
          !name.trim() ? 'El nombre es obligatorio.' : interfaceNameTaken(interfaces, name, item.id) ? 'Ya hay una interfaz con ese nombre.' : null
        }
        onChange={(name) => updateInterface(item.id, { name })}
      />
      <div className="panel-field">
        <label htmlFor={kindId}>Tipo</label>
        <select id={kindId} value={item.kind} onChange={(e) => updateInterface(item.id, { kind: e.target.value as InterfaceKind })}>
          {INTERFACE_KINDS.map((k) => (
            <option key={k} value={k}>
              {interfaceKindLabel(k)}
            </option>
          ))}
        </select>
        <p className="panel-help">{interfaceKindHelp(item.kind)}</p>
      </div>
      <TextField
        label="Descripción de la interfaz"
        multiline
        value={item.description ?? ''}
        maxLength={INTERFACE_DESCRIPTION_MAX_LENGTH}
        onChange={(description) => updateInterface(item.id, { description })}
      />
      <div className="panel-field">
        <label htmlFor={tourId}>Recorrido interno</label>
        <select id={tourId} value={item.tourId ?? ''} onChange={(e) => updateInterface(item.id, { tourId: e.target.value || null })}>
          <option value="">Ninguno</option>
          {flows.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="panel-help">
          {flows.length === 0
            ? 'Crea un recorrido en este módulo para mostrar qué pasa dentro cuando una feature usa la interfaz.'
            : 'Un recorrido de fuera que pase por la interfaz ofrecerá «Ver dentro del módulo».'}
        </p>
      </div>
      {removing ? (
        <RemoveInterface item={item} onDone={() => setRemoving(false)} />
      ) : (
        <button type="button" className="pixel-button is-ghost" onClick={() => setRemoving(true)}>
          Quitar interfaz…
        </button>
      )}
    </div>
  );
}

/**
 * Quitar una interfaz (spec modulos-compartidos, criterio 15): antes dice qué conexiones de qué features la usan (según
 * lo guardado) y deja pasarlas a otra interfaz, al módulo completo o dejarlas pendientes (con su último nombre). Es un
 * cambio del módulo: se deshace con Ctrl+Z y llega a las features al guardarlo, sin reescribirlas.
 */
function RemoveInterface({ item, onDone }: { item: ModuleInterface; onDone: () => void }) {
  const { currentModuleId, modules } = useCanvasCatalog();
  const interfaces = useGraphStore((s) => s.interfaces);
  const removeInterface = useGraphStore((s) => s.removeInterface);
  const usages = useModuleUsages(currentModuleId ?? null);
  const summary = currentModuleId ? modules?.[currentModuleId] : undefined;
  const [target, setTarget] = useState<string>('pending');
  const selectId = useId();
  // Conexiones guardadas que llegan a ella (directo o por una redirección anterior).
  const reaches = (id: string | undefined) =>
    !!id && (id === item.id || summary?.redirects?.some((r) => r.from === id && r.to === item.id) === true);
  const affected = (usages.data ?? [])
    .map((u) => ({ ...u, edges: u.edges.filter((e) => reaches(e.interfaceId)) }))
    .filter((u) => u.edges.length > 0);
  const count = affected.reduce((n, u) => n + u.edges.length, 0);
  const others = Object.values(interfaces).filter((i) => i.id !== item.id);

  function confirm() {
    removeInterface(item.id, target === 'pending' ? undefined : target === 'whole' ? {} : { to: target });
    onDone();
  }

  return (
    <div className="interface-remove" role="group" aria-label={`Quitar ${item.name}`}>
      {usages.isPending ? (
        <p className="panel-help">Buscando dónde se usa…</p>
      ) : count === 0 ? (
        <p className="panel-help">Ninguna feature guardada la usa: se puede quitar sin afectar a nadie.</p>
      ) : (
        <p className="panel-warning">
          {count === 1 ? '1 conexión la usa' : `${count} conexiones la usan`} en{' '}
          {affected.map((u) => `«${u.name}» (${u.edges.length})`).join(', ')}.
        </p>
      )}
      <div className="panel-field">
        <label htmlFor={selectId}>Qué hacer con esas conexiones</label>
        <select id={selectId} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="pending">Dejarlas pendientes para repararlas en cada feature</option>
          <option value="whole">Pasarlas al módulo completo</option>
          {others.map((i) => (
            <option key={i.id} value={i.id}>
              Reasignarlas a «{i.name}»
            </option>
          ))}
        </select>
      </div>
      <div className="panel-actions">
        <button type="button" className="pixel-button is-primary" onClick={confirm}>
          Quitar interfaz
        </button>
        <button type="button" className="pixel-button is-ghost" onClick={onDone}>
          Cancelar
        </button>
      </div>
      <p className="panel-help">Las features lo ven al guardar el módulo; Ctrl+Z lo deshace. No se reescribe ninguna feature.</p>
    </div>
  );
}
