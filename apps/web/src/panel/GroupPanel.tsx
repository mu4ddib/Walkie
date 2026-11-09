import { useId } from 'react';
import { GROUP_LABELS } from '../nodes/groupMeta';
import { GROUP_KINDS, TITLE_MAX_LENGTH, type GroupKind } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';

/**
 * Inspector de un grupo de infraestructura (spec espacio-de-trabajo, criterios 18 a 20): nombre, tipo, plegado y
 * sus nodos. Un grupo es parte del lienzo de la feature: no es una app ni una feature.
 */
export function GroupPanel({ id }: { id: string }) {
  const group = useGraphStore((s) => s.groups[id]);
  const allNodes = useGraphStore((s) => s.nodes);
  const updateGroup = useGraphStore((s) => s.updateGroup);
  const setNodeGroup = useGraphStore((s) => s.setNodeGroup);
  const removeGroup = useGraphStore((s) => s.removeGroup);
  const kindId = useId();
  if (!group) return null;
  const members = Object.values(allNodes)
    .filter((n) => n.groupId === id)
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));

  return (
    <>
      <h3>
        <span aria-hidden="true">⬚</span> Grupo · {GROUP_LABELS[group.kind]}
      </h3>
      <p className="panel-help">Agrupa cajas de una misma capa o entorno dentro de este lienzo.</p>
      <TextField
        label="Nombre del grupo"
        value={group.title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(title) => updateGroup(id, { title })}
      />
      <div className="panel-field">
        <label htmlFor={kindId}>Tipo de grupo</label>
        <select id={kindId} value={group.kind} onChange={(e) => updateGroup(id, { kind: e.target.value as GroupKind })}>
          {GROUP_KINDS.map((k) => (
            <option key={k} value={k}>
              {GROUP_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <label className="panel-check">
        <input
          type="checkbox"
          checked={!!group.collapsed}
          onChange={(e) => updateGroup(id, { collapsed: e.target.checked })}
        />
        Plegado (se ve como una caja con sus conexiones)
      </label>
      <section className="panel-section" aria-label="Nodos del grupo">
        <h4>{members.length === 1 ? '1 nodo' : `${members.length} nodos`}</h4>
        {members.length === 0 ? (
          <p className="panel-help">Arrastra cajas dentro del grupo para incluirlas.</p>
        ) : (
          <ul className="panel-list">
            {members.map((n) => (
              <li key={n.id} className="group-member">
                <span>{n.title}</span>
                <button
                  type="button"
                  className="pixel-button is-ghost"
                  aria-label={`Sacar ${n.title} del grupo`}
                  onClick={() => setNodeGroup(n.id, null)}
                >
                  Sacar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button type="button" className="pixel-button" onClick={() => removeGroup(id)}>
        Desagrupar
      </button>
      <p className="panel-help">Desagrupar quita el grupo y deja sus cajas donde están.</p>
    </>
  );
}
