import { useId } from 'react';
import type { Node } from '../schema/walkie-graph';
import { INPUT_NAME_MAX_LENGTH, INPUT_TYPES, inputNameError, type Input, type InputType } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';

/** Inputs de una pantalla (spec panel-propiedades, criterios 8 a 10): agregar, editar, quitar y asociar reglas. */
export function InputsSection({ node }: { node: Node }) {
  const addInput = useGraphStore((s) => s.addInput);
  const inputs = node.inputs ?? [];

  return (
    <section className="panel-section" aria-label="Inputs">
      <h4>Inputs</h4>
      {inputs.length === 0 && <p className="panel-help">Sin inputs.</p>}
      {inputs.map((input, index) => (
        <InputEditor key={index} node={node} input={input} index={index} />
      ))}
      <button type="button" className="pixel-button" onClick={() => addInput(node.id)}>
        + Agregar input
      </button>
    </section>
  );
}

function InputEditor({ node, input, index }: { node: Node; input: Input; index: number }) {
  const updateInput = useGraphStore((s) => s.updateInput);
  const removeInput = useGraphStore((s) => s.removeInput);
  const rules = useGraphStore((s) => s.nodes);
  const typeId = useId();
  const ruleNodes = Object.values(rules).filter((n) => n.type === 'rule');
  const ruleIds = input.ruleIds ?? [];

  function toggleRule(ruleId: string, on: boolean) {
    updateInput(node.id, index, { ruleIds: on ? [...ruleIds, ruleId] : ruleIds.filter((r) => r !== ruleId) });
  }

  return (
    <fieldset className="panel-input" aria-label={`Input ${input.name}`}>
      <TextField
        label="Nombre"
        value={input.name}
        maxLength={INPUT_NAME_MAX_LENGTH}
        validate={(name) => inputNameError(node, name, index)}
        onChange={(name) => updateInput(node.id, index, { name })}
      />
      <div className="panel-field">
        <label htmlFor={typeId}>Tipo</label>
        <select
          id={typeId}
          value={input.type}
          onChange={(e) => updateInput(node.id, index, { type: e.target.value as InputType })}
        >
          {INPUT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <label className="panel-check">
        <input
          type="checkbox"
          checked={input.required ?? false}
          onChange={(e) => updateInput(node.id, index, { required: e.target.checked })}
        />
        Obligatorio
      </label>
      {input.type === 'enum' && (
        <TextField
          label="Opciones (una por línea)"
          multiline
          placeholder={'Ahorros\nCorriente'}
          value={(input.options ?? []).join('\n')}
          maxLength={INPUT_NAME_MAX_LENGTH * 50}
          onChange={(text) => updateInput(node.id, index, { options: text.split('\n') })}
        />
      )}
      <div className="panel-field" role="group" aria-label="Reglas">
        <span>Reglas</span>
        {ruleNodes.length === 0 ? (
          <span className="panel-help">No hay reglas en el lienzo.</span>
        ) : (
          ruleNodes.map((rule) => (
            <label key={rule.id} className="panel-check">
              <input
                type="checkbox"
                checked={ruleIds.includes(rule.id)}
                onChange={(e) => toggleRule(rule.id, e.target.checked)}
              />
              {rule.title}
            </label>
          ))
        )}
      </div>
      <button type="button" className="pixel-button" onClick={() => removeInput(node.id, index)}>
        Quitar input
      </button>
    </fieldset>
  );
}

/** En el panel de una regla: qué inputs la usan (criterio 9). */
export function RuleUsages({ ruleId }: { ruleId: string }) {
  const nodes = useGraphStore((s) => s.nodes);
  const usages = Object.values(nodes).flatMap((n) =>
    (n.inputs ?? []).filter((i) => i.ruleIds?.includes(ruleId)).map((i) => `${n.title} · ${i.name}`),
  );

  return (
    <section className="panel-section" aria-label="Usada por">
      <h4>Usada por</h4>
      {usages.length === 0 ? (
        <p className="panel-help">Ningún input usa esta regla.</p>
      ) : (
        <ul className="panel-list">
          {usages.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
