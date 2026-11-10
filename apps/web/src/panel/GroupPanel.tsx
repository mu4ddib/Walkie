import { useId } from 'react';
import { GROUP_LABELS } from '../nodes/groupMeta';
import { GROUP_KINDS, TITLE_MAX_LENGTH, type GroupKind } from '../store/graphStore';
import { ancestorsOf, canNest } from '../store/hierarchy';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';

/**
 * Inspector de un grupo de infraestructura (spec espacio-de-trabajo, criterios 18 a 20; spec recorridos-y-grupos,
 * parte 1): nombre, tipo, plegado, en qué grupo está y lo que contiene (nodos, notas y grupos). Un grupo es parte del
 * lienzo de la feature: no es una app ni una feature.
 */
export function GroupPanel({ id, onNest }: { id: string; onNest?: (id: string, groupId: string | null) => void }) {
  const group = useGraphStore((s) => s.groups[id]);
  const groups = useGraphStore((s) => s.groups);
  const allNodes = useGraphStore((s) => s.nodes);
  const stickyNotes = useGraphStore((s) => s.stickyNotes);
  const updateGroup = useGraphStore((s) => s.updateGroup);
  const storeSetParent = useGraphStore((s) => s.setParent);
  // Desde el lienzo, meter algo en un grupo también lo agranda si queda afuera de su caja.
  const setParent = onNest ?? storeSetParent;
  const removeGroup = useGraphStore((s) => s.removeGroup);
  const kindId = useId();
  const parentId = useId();
  if (!group) return null;
  const h = { nodes: allNodes, groups, stickyNotes };
  const path = (g: string) => [...ancestorsOf(h, g).reverse(), g].map((x) => groups[x]?.title ?? '').join(' › ');
  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'es');
  const members = Object.values(allNodes).filter((n) => n.groupId === id).sort(byTitle);
  const subgroups = Object.values(groups).filter((g) => g.parentId === id).sort(byTitle);
  const notes = Object.values(stickyNotes).filter((n) => n.groupId === id);
  // Sacar algo lo deja un nivel más afuera (en el grupo padre de este, o en el lienzo).
  const outside = group.parentId && groups[group.parentId] ? group.parentId : null;
  // Posibles padres: cualquier grupo menos este y los que están dentro de él (no hay ciclos).
  const parents = Object.values(groups)
    .filter((g) => canNest(h, id, g.id))
    .map((g) => ({ id: g.id, label: path(g.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const count = members.length + subgroups.length + notes.length;

  return (
    <>
      <h3>
        <span aria-hidden="true">⬚</span> Grupo · {GROUP_LABELS[group.kind]}
      </h3>
      <p className="panel-help">Agrupa cajas de una misma capa o entorno dentro de este lienzo.</p>
      {outside && <p className="group-path">Dentro de {path(outside)}</p>}
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
      <div className="panel-field">
        <label htmlFor={parentId}>Dentro del grupo</label>
        <select id={parentId} value={group.parentId ?? ''} onChange={(e) => setParent(id, e.target.value || null)}>
          <option value="">— Ninguno (suelto en el lienzo)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
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
        Plegado (oculta todo lo de dentro; sus conexiones llegan a la caja)
      </label>
      <section className="panel-section" aria-label="Contenido del grupo">
        <h4>{members.length === 1 ? '1 nodo' : `${members.length} nodos`}{subgroups.length > 0 && ` · ${subgroups.length === 1 ? '1 grupo' : `${subgroups.length} grupos`}`}</h4>
        {count === 0 ? (
          <p className="panel-help">Arrastra cajas, notas o grupos dentro del grupo para incluirlos.</p>
        ) : (
          <ul className="panel-list">
            {[...subgroups.map((g) => ({ id: g.id, title: g.title, glyph: '⬚ ' })), ...members.map((n) => ({ id: n.id, title: n.title, glyph: '' })), ...notes.map((n) => ({ id: n.id, title: n.text.slice(0, 40) || 'Nota', glyph: '✎ ' }))].map((item) => (
              <li key={item.id} className="group-member">
                <span>
                  {item.glyph}
                  {item.title}
                </span>
                <button
                  type="button"
                  className="pixel-button is-ghost"
                  aria-label={`Sacar ${item.title} del grupo`}
                  onClick={() => setParent(item.id, outside)}
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
      <p className="panel-help">Desagrupar quita el grupo y deja lo que contenía donde está, en el grupo de afuera.</p>
    </>
  );
}
