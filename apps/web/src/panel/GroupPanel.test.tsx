import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { GroupNode, type GroupFlowNode } from '../nodes/GroupNode';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

function renderGroup() {
  const store = createGraphStore();
  const api = store.getState().addNode('api', { x: 40, y: 40 });
  store.getState().renameNode(api, 'Transferir');
  const groupId = store.getState().addGroup({ x: 0, y: 0, w: 400, h: 240 }, { members: [api] });
  store.getState().markSaved(1);
  render(
    <GraphStoreProvider store={store}>
      <PropertiesPanel nodeId={null} edgeId={null} groupId={groupId} />
    </GraphStoreProvider>,
  );
  return { store, groupId, api };
}

describe('inspector de un grupo', () => {
  it('cambia nombre, tipo y plegado, y lista sus nodos', async () => {
    const { store, groupId } = renderGroup();

    await userEvent.clear(screen.getByLabelText('Nombre del grupo'));
    await userEvent.type(screen.getByLabelText('Nombre del grupo'), 'Core bancario');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de grupo'), 'backend');
    await userEvent.click(screen.getByRole('checkbox', { name: /Plegado/ }));

    expect(store.getState().groups[groupId]).toEqual({ id: groupId, title: 'Core bancario', kind: 'backend', collapsed: true });
    const members = screen.getByRole('region', { name: 'Contenido del grupo' });
    expect(members).toHaveTextContent('1 nodo');
    expect(within(members).getByText('Transferir')).toBeInTheDocument();
  });

  it('saca un nodo y "Desagrupar" deja las cajas sin grupo', async () => {
    const { store, groupId, api } = renderGroup();

    await userEvent.click(screen.getByRole('button', { name: 'Sacar Transferir del grupo' }));
    expect(store.getState().nodes[api]).not.toHaveProperty('groupId');

    await userEvent.click(screen.getByRole('button', { name: 'Desagrupar' }));
    expect(store.getState().groups[groupId]).toBeUndefined();
    expect(store.getState().nodes[api]).toBeDefined();
  });
});

describe('caja de un grupo', () => {
  it('muestra tipo, nombre y cantidad de nodos, y pliega con su botón', async () => {
    const onToggle = vi.fn();
    const props = {
      id: 'g',
      data: { group: { id: 'g', title: 'Core', kind: 'data', collapsed: true }, count: 3, onToggle, resizable: true },
      selected: false,
    } as unknown as NodeProps<GroupFlowNode>;
    render(
      <ReactFlowProvider>
        <GroupNode {...props} />
      </ReactFlowProvider>,
    );

    expect(document.querySelector('.group-node')).toHaveAttribute('data-collapsed', 'true');
    expect(document.querySelector('.group-node-header')).toHaveTextContent('DatosCore3 nodos');
    await userEvent.click(screen.getByRole('button', { name: 'Desplegar grupo Core' }));
    expect(onToggle).toHaveBeenCalled();
  });
});
