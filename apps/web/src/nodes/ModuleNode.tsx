import { memo, useState, type CSSProperties } from 'react';
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react';
import { moduleTarget, useCanvasCatalog } from '../catalog/catalogContext';
import type { ModuleInterfaceSummary } from '../api/client';
import { useGraphStore } from '../store/useGraphStore';
import { nodeColors } from '../theme/palette';
import { MODULE_MIN_WIDTH, interfaceKindLabel, interfaceSignature, usedInterfaces } from '../modules/moduleMeta';
import { useOpenModule } from '../canvas/useOpenModule';
import type { WalkieFlowNode } from './PixelNode';

/** Interfaces usadas que se ven en la caja; el resto, en «Ver interfaces» o en el inspector. */
export const MAX_BOX_INTERFACES = 4;

/**
 * Caja de un módulo compartido (spec modulos-compartidos, criterio 17): nombre, distintivo «Módulo», descripción breve y
 * solo las interfaces que usa este lienzo, con «Abrir módulo» y «Ver interfaces». Lee el resumen del módulo por
 * contexto (una sola consulta para todas las cajas) y las conexiones de esta caja del store; nunca su lienzo completo.
 */
export const ModuleNode = memo(function ModuleNode({ id, data, selected }: NodeProps<WalkieFlowNode>) {
  const { node } = data;
  const { modules, share } = useCanvasCatalog();
  const openModule = useOpenModule();
  const summary = moduleTarget(node, modules);
  // Clave en texto: el componente solo se vuelve a dibujar si cambian las interfaces que usa, no con cada movimiento.
  const usedKey = useGraphStore((s) => usedInterfaces(s.edges, id).join('\n'));
  const [listOpen, setListOpen] = useState(false);
  const known = modules !== undefined && !share;
  const missing = known && !summary;
  const used = usedKey ? usedKey.split('\n').map((pair) => JSON.parse(pair) as { id: string; name: string }) : [];
  const usedShown = used.slice(0, MAX_BOX_INTERFACES);
  const showDescription = node.display?.description !== false;
  const showInterfaces = node.display?.interfaces !== false;
  const total = summary?.interfaces.length ?? 0;
  const connectTip = share ? undefined : 'Arrastra hasta aquí para conectar con una interfaz del módulo';

  return (
    <div
      className="pixel-node module-node"
      data-type="module"
      data-ref={missing ? 'missing' : 'ok'}
      data-selected={selected || undefined}
      style={{ '--node-color': nodeColors.module } as CSSProperties}
    >
      {!share && selected && (
        <NodeResizeControl
          position="right"
          resizeDirection="horizontal"
          minWidth={MODULE_MIN_WIDTH}
          className="module-node-resize"
          aria-label="Cambiar el ancho de la caja"
        />
      )}
      <Handle type="target" position={Position.Left} title={connectTip} />
      <Handle type="source" position={Position.Top} id="top" className="pixel-node-handle-extra" title={connectTip} />
      <Handle type="source" position={Position.Bottom} id="bottom" className="pixel-node-handle-extra" title={connectTip} />
      <div className="pixel-node-kind module-node-kind">
        <span aria-hidden="true">[::]</span> {missing ? 'Módulo no encontrado' : 'Módulo'}
        <span className="pixel-node-badge" title="Definición compartida: cambia en todas las features que la usan">
          compartido
        </span>
      </div>
      <div className="pixel-node-title">{summary?.name ?? node.title}</div>
      {showDescription && summary?.description && <p className="pixel-node-description module-node-description">{summary.description}</p>}
      {missing && (
        <p className="pixel-node-description">Ya no existe en la app. Selecciónalo para reasignarlo a otro módulo.</p>
      )}
      {showInterfaces && summary && (
        <div className="module-node-interfaces">
          {usedShown.length > 0 ? (
            <ul aria-label="Interfaces usadas en este lienzo">
              {usedShown.map((ref) => {
                const iface = summary.interfaces.find((i) => i.id === ref.id);
                return (
                  <li key={ref.id} data-pending={iface ? undefined : 'true'} title={iface ? interfaceKindLabel(iface.kind) : 'Interfaz que ya no existe'}>
                    <span className="module-node-iface-name">{iface?.name ?? `⚠ ${ref.name}`}</span>
                    {iface && interfaceSignature(iface) && <span className="module-node-iface-sig">{interfaceSignature(iface)}</span>}
                  </li>
                );
              })}
              {used.length > usedShown.length && <li className="pixel-node-muted">+{used.length - usedShown.length} más</li>}
            </ul>
          ) : (
            <p className="pixel-node-muted module-node-empty">
              {total === 0 ? 'Aún no expone interfaces.' : `${total} ${total === 1 ? 'interfaz' : 'interfaces'} · ninguna usada aquí`}
            </p>
          )}
        </div>
      )}
      {summary && !share && (
        <div className="module-node-actions nodrag">
          <button type="button" className="link-button" onClick={() => openModule(summary.id, { nodeId: id })}>
            Abrir módulo
          </button>
          <button type="button" className="link-button" aria-expanded={listOpen} onClick={() => setListOpen((o) => !o)}>
            Ver interfaces
          </button>
        </div>
      )}
      {listOpen && summary && (
        <InterfaceList
          interfaces={summary.interfaces}
          onOpen={(iface) => openModule(summary.id, { nodeId: id, focus: iface.nodeId })}
          onClose={() => setListOpen(false)}
        />
      )}
      <Handle type="source" position={Position.Right} title={connectTip} />
    </div>
  );
});

/** Lista contextual de todas las interfaces del módulo: abrir cada una enfoca su caja interna. */
function InterfaceList({
  interfaces,
  onOpen,
  onClose,
}: {
  interfaces: ModuleInterfaceSummary[];
  onOpen: (iface: ModuleInterfaceSummary) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="module-node-popover nodrag nowheel"
      role="dialog"
      aria-label="Interfaces del módulo"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {interfaces.length === 0 ? (
        <p className="pixel-node-muted">Este módulo aún no expone interfaces: ábrelo para elegir qué cajas se conectan desde fuera.</p>
      ) : (
        <ul>
          {interfaces.map((iface) => (
            <li key={iface.id}>
              <button type="button" className="module-iface-option" onClick={() => onOpen(iface)} title="Abrir en el módulo">
                <span className="module-iface-kind" data-kind={iface.kind}>
                  {interfaceKindLabel(iface.kind)}
                </span>
                <span className="module-node-iface-name">{iface.name}</span>
                {interfaceSignature(iface) && <span className="module-node-iface-sig">{interfaceSignature(iface)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="module-node-popover-help">Para conectar con una, arrastra una conexión hasta la caja.</p>
    </div>
  );
}
