import { useId } from 'react';
import { nodeLabel } from '../nodes/nodeMeta';
import {
  HTTP_METHODS,
  STICKY_TEXT_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  CATALOG_NODE_TYPES,
  type HttpMethod,
} from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { InputsSection, RuleUsages } from './InputsSection';
import { MoveToCatalog } from './MoveToCatalog';
import { PortalPanel } from './PortalPanel';
import { RefPanel } from './RefPanel';
import { ScreenImage } from './ScreenImage';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { TextField } from './TextField';
import { ToursSection, type ToursSectionProps } from './ToursSection';
import { ApiContractEditor } from './contract/ApiContractEditor';
import { DatabaseEditor } from './contract/DatabaseEditor';
import { ResourceEditor } from './contract/ResourceEditor';
import { RuntimeField } from './contract/RuntimeField';
import { NotesField } from './contract/NotesField';
import { GroupPanel } from './GroupPanel';
import { DecisionSection, RuleModeSwitch } from './DecisionSection';
import { EdgePanel, type EdgePanelActions } from './EdgePanel';
import './panel.css';

/**
 * Panel lateral de propiedades (spec panel-propiedades, criterios 3 a 7). Con un solo nodo o una sola
 * conexión seleccionados muestra sus propiedades; si no, un texto de ayuda. Cambia el grafo por el store.
 */
export function PropertiesPanel({
  nodeId,
  edgeId,
  groupId = null,
  noteId = null,
  tours,
  onSelect,
  preview,
  flows,
  onNest,
}: {
  nodeId: string | null;
  edgeId: string | null;
  /** Grupo de infraestructura seleccionado (spec espacio-de-trabajo, criterio 18). */
  groupId?: string | null;
  /** Nota adhesiva seleccionada. */
  noteId?: string | null;
  /** Meter o sacar algo de un grupo desde su inspector (el lienzo además agranda el grupo si hace falta). */
  onNest?: (id: string, groupId: string | null) => void;
  /** Sección "Tours" cuando no hay nada seleccionado (spec modo-tour); sin ella, solo la ayuda. */
  tours?: ToursSectionProps;
} & EdgePanelActions) {
  return (
    <aside className="properties-panel" aria-label="Propiedades">
      {nodeId ? (
        <NodePanel key={nodeId} id={nodeId} />
      ) : edgeId ? (
        <EdgePanel key={edgeId} id={edgeId} onSelect={onSelect} preview={preview} flows={flows} />
      ) : groupId ? (
        <GroupPanel key={groupId} id={groupId} onNest={onNest} />
      ) : noteId ? (
        <StickyPanel key={noteId} id={noteId} />
      ) : (
        <>
          <p className="panel-help">Selecciona un nodo o una conexión para ver y editar sus propiedades.</p>
          {tours && <ToursSection {...tours} />}
        </>
      )}
    </aside>
  );
}

function NodePanel({ id }: { id: string }) {
  const node = useGraphStore((s) => s.nodes[id]);
  const updateNode = useGraphStore((s) => s.updateNode);
  const setHttp = useGraphStore((s) => s.setHttp);
  const setDatabase = useGraphStore((s) => s.setDatabase);
  const setResource = useGraphStore((s) => s.setResource);
  const setRuntime = useGraphStore((s) => s.setRuntime);
  const methodId = useId();
  const { appId } = useCanvasCatalog();
  if (!node) return null;
  if (node.type === 'ref') return <RefPanel node={node} />;
  if (node.type === 'portal') return <PortalPanel node={node} />;
  const meta = nodeLabel(node);
  const decision = node.type === 'rule' && node.mode === 'decision';

  return (
    <>
      <h3>
        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
      </h3>
      {node.type === 'rule' && <RuleModeSwitch node={node} />}
      <TextField
        label={decision ? 'Pregunta' : 'Título'}
        value={node.title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(title) => updateNode(id, { title })}
      />
      <TextField
        label="Descripción"
        multiline
        value={node.description ?? ''}
        maxLength={TEXT_MAX_LENGTH}
        onChange={(description) => updateNode(id, { description })}
      />
      {node.type === 'rule' && (
        <>
          <TextField
            // En una decisión, la expresión es la condición que se evalúa.
            label={decision ? 'Condición evaluada' : 'Expresión'}
            multiline
            placeholder={decision ? 'Ej. el correo ya está registrado' : 'cc: solo dígitos, de 6 a 10'}
            value={node.expression ?? ''}
            maxLength={TEXT_MAX_LENGTH}
            onChange={(expression) => updateNode(id, { expression })}
          />
          {decision ? <DecisionSection node={node} /> : <RuleUsages ruleId={id} />}
        </>
      )}
      {appId && node.type === 'screen' && <ScreenImage appId={appId} node={node} />}
      {node.type === 'screen' && <InputsSection node={node} />}
      {node.type === 'api' && (
        <>
          <div className="panel-field">
            <label htmlFor={methodId}>Método</label>
            <select
              id={methodId}
              value={node.http?.method ?? ''}
              onChange={(e) => updateNode(id, { http: { method: (e.target.value || null) as HttpMethod | null } })}
            >
              <option value="">—</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label="Ruta HTTP"
            placeholder="/clientes/{id}"
            value={node.http?.path ?? ''}
            maxLength={TEXT_MAX_LENGTH}
            onChange={(path) => updateNode(id, { http: { path } })}
          />
        </>
      )}
      {node.type === 'api' && <ApiContractEditor value={node.http} onChange={(http) => setHttp(id, http)} />}
      {node.type === 'database' && (
        <DatabaseEditor value={node.database} onChange={(database) => setDatabase(id, database)} />
      )}
      {node.type === 'resource' && (
        <ResourceEditor
          value={node.resource}
          // El editor entrega el recurso completo: lo que no trae se quita.
          onChange={(resource) =>
            setResource(id, { label: undefined, provider: undefined, name: undefined, details: undefined, ...resource })
          }
        />
      )}
      {node.type === 'service' && <RuntimeField value={node.runtime} onChange={(runtime) => setRuntime(id, runtime)} />}
      <NotesField node={node} />
      {/* Solo con catálogo (lienzo de una app): el botón llama a la API. */}
      {appId && CATALOG_NODE_TYPES.includes(node.type) && <MoveToCatalog appId={appId} node={node} />}
    </>
  );
}

/** Nota adhesiva: su texto y poco más (es una anotación, no un nodo del flujo). */
function StickyPanel({ id }: { id: string }) {
  const note = useGraphStore((s) => s.stickyNotes[id]);
  const updateStickyNote = useGraphStore((s) => s.updateStickyNote);
  const removeStickyNote = useGraphStore((s) => s.removeStickyNote);
  if (!note) return null;
  return (
    <>
      <h3>
        <span aria-hidden="true">▤</span> Nota adhesiva
      </h3>
      <TextField
        label="Texto"
        multiline
        value={note.text}
        maxLength={STICKY_TEXT_MAX_LENGTH}
        placeholder="Una anotación para quien lea el lienzo"
        onChange={(text) => updateStickyNote(id, text)}
      />
      <button type="button" className="pixel-button" onClick={() => removeStickyNote(id)}>
        Eliminar nota
      </button>
    </>
  );
}
