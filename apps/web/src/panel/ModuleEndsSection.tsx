import { useId } from 'react';
import { interfaceTarget, moduleTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { useOpenModule } from '../canvas/useOpenModule';
import { interfaceKindLabel, interfaceSignature, interfacesForEnd } from '../modules/moduleMeta';
import type { Edge } from '../schema/walkie-graph';
import { useGraphStore } from '../store/useGraphStore';

/**
 * Extremos de una conexión que son la caja de un módulo (spec modulos-compartidos, criterios 12 y 16): dice si apunta al
 * módulo completo o a una interfaz, permite precisarlo o cambiarlo, marca la interfaz que ya no existe (con su último
 * nombre) para reasignarla y abre la interfaz o su recorrido interno en el módulo.
 */
export function ModuleEndsSection({ edge }: { edge: Edge }) {
  const nodes = useGraphStore((s) => s.nodes);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const { modules, share } = useCanvasCatalog();
  const openModule = useOpenModule();
  const baseId = useId();

  const ends = (['from', 'to'] as const).filter((end) => nodes[edge[end]]?.type === 'module');
  return (
    <section className="panel-section module-ends" aria-label="Módulo de la conexión">
      <h4>Módulo</h4>
      {ends.map((end) => {
        const node = nodes[edge[end]]!;
        const module = moduleTarget(node, modules);
        const ref = end === 'from' ? edge.fromInterface : edge.toInterface;
        const iface = interfaceTarget(node, ref, modules);
        const pending = ref && module && !iface;
        const selectId = `${baseId}-${end}`;
        if (!module) {
          return (
            <p key={end} className="panel-help panel-warning">
              {end === 'to' ? 'Destino' : 'Origen'}: el módulo «{node.title}» ya no existe.
            </p>
          );
        }
        return (
          <div key={end} className="panel-field module-end">
            <label htmlFor={selectId}>
              {end === 'to' ? `Llega a ${module.name}` : `Sale de ${module.name}`}
            </label>
            <select
              id={selectId}
              value={ref?.id ?? ''}
              disabled={Boolean(share)}
              onChange={(e) => {
                const picked = module.interfaces.find((i) => i.id === e.target.value);
                updateEdge(edge.id, {
                  [end === 'from' ? 'fromInterface' : 'toInterface']: picked ? { id: picked.id, name: picked.name } : null,
                });
              }}
            >
              <option value="">Módulo completo (relación general)</option>
              {pending && <option value={ref.id}>⚠ {ref.name} (ya no existe)</option>}
              {interfacesForEnd(module, end).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {interfaceKindLabel(i.kind)}
                  {interfaceSignature(i) ? ` · ${interfaceSignature(i)}` : ''}
                </option>
              ))}
            </select>
            <p className="panel-help">
              {pending
                ? 'Esta interfaz ya no existe en el módulo: elige otra o deja la conexión al módulo completo.'
                : iface
                  ? `Apunta a la interfaz «${iface.name}»${iface.description ? `: ${iface.description}` : ''}.`
                  : 'Apunta al módulo completo. Elige una interfaz para precisar el destino.'}
            </p>
            {iface && !share && (
              <div className="panel-actions">
                <button type="button" className="link-button" onClick={() => openModule(module.id, { nodeId: node.id, focus: iface.nodeId })}>
                  Abrir la interfaz en el módulo
                </button>
                {iface.tourId && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => openModule(module.id, { nodeId: node.id, play: { tourId: iface.tourId!, returnTour: '', returnStep: 0 } })}
                  >
                    Ver recorrido interno{iface.tourName ? ` «${iface.tourName}»` : ''}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
