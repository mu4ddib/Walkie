import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createGraphStore, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

function renderPanel(selection: (s: GraphStore) => { nodeId?: string; edgeId?: string }) {
  const store = createGraphStore();
  const { nodeId = null, edgeId = null } = selection(store.getState());
  store.getState().markSaved(1);
  render(
    <GraphStoreProvider store={store}>
      <PropertiesPanel nodeId={nodeId} edgeId={edgeId} />
    </GraphStoreProvider>,
  );
  return { store, nodeId: nodeId!, edgeId: edgeId! };
}

describe('PropertiesPanel', () => {
  it('sin selección muestra la ayuda', () => {
    renderPanel(() => ({}));

    expect(screen.getByText(/Selecciona un nodo o una conexión/)).toBeInTheDocument();
  });

  it('edita título y descripción de un nodo al instante y marca cambios', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('screen', { x: 0, y: 0 }) }));

    const title = screen.getByLabelText('Título');
    await userEvent.clear(title);
    await userEvent.type(title, 'Login ');
    // El borrador conserva el espacio mientras se escribe; el nodo ya tiene el título recortado.
    expect(title).toHaveValue('Login ');
    expect(store.getState().nodes[nodeId]?.title).toBe('Login');

    await userEvent.type(screen.getByLabelText('Descripción'), 'Pide documento');

    expect(title).toHaveValue('Login');
    expect(store.getState().nodes[nodeId]).toMatchObject({ title: 'Login', description: 'Pide documento' });
    expect(store.getState().dirty).toBe(true);
  });

  it('un título vacío no se guarda y al salir vuelve el valor real', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('screen', { x: 0, y: 0 }) }));

    const title = screen.getByLabelText('Título');
    await userEvent.clear(title);
    await userEvent.tab();

    expect(store.getState().nodes[nodeId]?.title).toBe('Pantalla');
    expect(title).toHaveValue('Pantalla');
  });

  it('una regla tiene expresión; una pantalla no', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('rule', { x: 0, y: 0 }) }));

    await userEvent.type(screen.getByLabelText('Expresión'), 'cc: solo dígitos');

    expect(store.getState().nodes[nodeId]?.expression).toBe('cc: solo dígitos');
    expect(screen.queryByLabelText('Método')).not.toBeInTheDocument();
  });

  it('una API tiene método y ruta', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('api', { x: 0, y: 0 }) }));

    await userEvent.selectOptions(screen.getByLabelText('Método'), 'POST');
    await userEvent.type(screen.getByLabelText('Ruta HTTP'), '/clientes/{{id}');

    expect(store.getState().nodes[nodeId]?.http).toEqual({ method: 'POST', path: '/clientes/{id}' });
    expect(screen.queryByLabelText('Expresión')).not.toBeInTheDocument();
  });

  it('edita tipo, etiqueta y condición de una conexión', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const api = s.addNode('api', { x: 0, y: 0 });
      const screenId = s.addNode('screen', { x: 0, y: 0 });
      return { edgeId: s.connect(api, screenId)! };
    });

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'navigation');
    await userEvent.type(screen.getByLabelText('Etiqueta'), 'Cliente');
    await userEvent.type(screen.getByLabelText('Condición'), '404');

    expect(store.getState().edges[edgeId]).toMatchObject({ kind: 'navigation', label: 'Cliente', when: '404' });
  });

  it('refleja un cambio del store hecho por otra vía', () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('screen', { x: 0, y: 0 }) }));

    act(() => store.getState().renameNode(nodeId, 'Inicio'));

    expect(screen.getByLabelText('Título')).toHaveValue('Inicio');
  });
});
