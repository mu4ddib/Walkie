import { useId } from 'react';
import { refTarget, useCanvasCatalog } from '../catalog/catalogContext';
import type { Node } from '../schema/walkie-graph';
import { BRANCHES_MAX, EDGE_TEXT_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';

/** Regla o decisión: el modo de la caja. Convertir conserva el título, la posición y las conexiones. */
export function RuleModeSwitch({ node }: { node: Node }) {
  const setRuleMode = useGraphStore((s) => s.setRuleMode);
  const decision = node.mode === 'decision';
  return (
    <div className="segmented" role="group" aria-label="Modo de la caja">
      <button
        type="button"
        aria-pressed={!decision}
        data-tip="Documenta una validación o una restricción"
        onClick={() => setRuleMode(node.id, 'rule')}
      >
        § Regla
      </button>
      <button
        type="button"
        aria-pressed={decision}
        data-tip="Bifurca el flujo: cada salida lleva su etiqueta"
        onClick={() => setRuleMode(node.id, 'decision')}
      >
        ◇ Decisión
      </button>
    </div>
  );
}

/**
 * Salidas de una decisión: renombrar, agregar y quitar ramas, y asignar a mano la salida de cada conexión
 * saliente (las de una regla recién convertida llegan sin asignar).
 */
export function DecisionSection({ node }: { node: Node }) {
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const { addBranch, renameBranch, removeBranch, updateEdge } = useGraphStore((s) => s);
  const { items } = useCanvasCatalog();
  const baseId = useId();
  const branches = node.branches ?? [];
  const outgoing = Object.values(edges).filter((e) => e.from === node.id);
  const titleOf = (id: string) => {
    const target = nodes[id];
    return target ? (refTarget(target, items)?.title ?? target.title) : '—';
  };

  return (
    <>
      <section className="panel-section" aria-label="Salidas">
        <h4>Salidas</h4>
        {branches.map((branch, i) => (
          <div key={branch.id} className="branch-row">
            <TextField
              label={`Salida ${i + 1}`}
              value={branch.label}
              maxLength={EDGE_TEXT_MAX_LENGTH}
              onChange={(label) => renameBranch(node.id, branch.id, label)}
            />
            <button
              type="button"
              className="pixel-button is-ghost icon-button"
              aria-label={`Quitar salida ${branch.label}`}
              data-tip="Quitar (sus conexiones quedan sin asignar)"
              onClick={() => removeBranch(node.id, branch.id)}
            >
              ✕
            </button>
          </div>
        ))}
        {branches.length < BRANCHES_MAX && (
          <button type="button" className="pixel-button is-ghost contract-add" onClick={() => addBranch(node.id)}>
            + Agregar rama
          </button>
        )}
      </section>
      {outgoing.length > 0 && (
        <section className="panel-section" aria-label="Conexiones salientes">
          <h4>Conexiones salientes</h4>
          {outgoing.map((edge, i) => (
            <div key={edge.id} className="branch-assign">
              <label htmlFor={`${baseId}-${i}`}>→ {titleOf(edge.to)}</label>
              <select
                id={`${baseId}-${i}`}
                value={branches.some((b) => b.id === edge.branch) ? edge.branch : ''}
                onChange={(e) => updateEdge(edge.id, { branch: e.target.value || null })}
              >
                <option value="">Sin asignar</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
