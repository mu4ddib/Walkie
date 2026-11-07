import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createGraphStore, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

function renderNodePanel(setup: (s: GraphStore) => string) {
  const store = createGraphStore();
  const nodeId = setup(store.getState());
  render(
    <GraphStoreProvider store={store}>
      <PropertiesPanel nodeId={nodeId} edgeId={null} />
    </GraphStoreProvider>,
  );
  return { store, nodeId, inputs: () => store.getState().nodes[nodeId]?.inputs };
}

describe('inputs en el panel', () => {
  it('agrega un input y edita nombre, tipo y obligatorio', async () => {
    const { inputs } = renderNodePanel((s) => s.addNode('screen', { x: 0, y: 0 }));

    expect(screen.getByText('Sin inputs.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar input' }));
    const name = screen.getByLabelText('Nombre');
    await userEvent.clear(name);
    await userEvent.type(name, 'documento');
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'number');
    await userEvent.click(screen.getByLabelText('Obligatorio'));

    expect(inputs()).toEqual([{ name: 'documento', type: 'number', required: true }]);
  });

  it('avisa y no guarda un nombre repetido', async () => {
    const { inputs } = renderNodePanel((s) => {
      const id = s.addNode('screen', { x: 0, y: 0 });
      s.addInput(id, { name: 'cc' });
      s.addInput(id, { name: 'clave' });
      return id;
    });

    const second = screen.getAllByLabelText('Nombre')[1]!;
    await userEvent.clear(second);
    await userEvent.type(second, 'cc');

    expect(screen.getByRole('alert')).toHaveTextContent('Ya hay un input con ese nombre.');
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(inputs()?.map((i) => i.name)).toEqual(['cc', 'c']);

    await userEvent.tab();
    expect(second).toHaveValue('c');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un enum guarda sus opciones, una por línea, y las descarta al cambiar de tipo', async () => {
    const { inputs } = renderNodePanel((s) => {
      const id = s.addNode('screen', { x: 0, y: 0 });
      s.addInput(id, { name: 'cuenta' });
      return id;
    });

    expect(screen.queryByLabelText('Opciones (una por línea)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'enum');
    await userEvent.type(screen.getByLabelText('Opciones (una por línea)'), 'Ahorros{Enter}Corriente');
    expect(inputs()?.[0]?.options).toEqual(['Ahorros', 'Corriente']);

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'string');
    expect(inputs()).toEqual([{ name: 'cuenta', type: 'string' }]);
  });

  it('asocia solo reglas del lienzo y quita el input', async () => {
    let ruleId = '';
    const { inputs } = renderNodePanel((s) => {
      const id = s.addNode('screen', { x: 0, y: 0 });
      ruleId = s.addNode('rule', { x: 0, y: 0 });
      s.updateNode(ruleId, { title: 'Documento válido' });
      s.addNode('api', { x: 0, y: 0 });
      s.addInput(id, { name: 'cc' });
      return id;
    });

    const rules = screen.getByRole('group', { name: 'Reglas' });
    expect(within(rules).getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(within(rules).getByLabelText('Documento válido'));
    expect(inputs()?.[0]?.ruleIds).toEqual([ruleId]);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar input' }));
    expect(inputs()).toBeUndefined();
  });

  it('sin reglas en el lienzo lo dice', async () => {
    renderNodePanel((s) => {
      const id = s.addNode('screen', { x: 0, y: 0 });
      s.addInput(id);
      return id;
    });

    expect(screen.getByText('No hay reglas en el lienzo.')).toBeInTheDocument();
  });

  it('el panel de una regla lista los inputs que la usan', () => {
    renderNodePanel((s) => {
      const login = s.addNode('screen', { x: 0, y: 0 });
      const rule = s.addNode('rule', { x: 0, y: 0 });
      s.updateNode(login, { title: 'Login' });
      s.addInput(login, { name: 'documento', ruleIds: [rule] });
      s.addInput(login, { name: 'clave' });
      return rule;
    });

    const usages = screen.getByRole('region', { name: 'Usada por' });
    expect(
      within(usages)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Login · documento']);
    expect(screen.queryByRole('region', { name: 'Inputs' })).not.toBeInTheDocument();
  });
});
