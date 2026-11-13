import { act, render, screen, within } from '@testing-library/react';
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

  it('edita operación, etiqueta y condición de una conexión', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const screenId = s.addNode('screen', { x: 0, y: 0 });
      const other = s.addNode('screen', { x: 0, y: 0 });
      return { edgeId: s.connect(screenId, other)! };
    });

    await userEvent.selectOptions(screen.getByLabelText('Operación'), 'navigation');
    await userEvent.type(screen.getByLabelText('Etiqueta'), 'Cliente');
    await userEvent.type(screen.getByLabelText('Condición'), '404');

    expect(store.getState().edges[edgeId]).toMatchObject({ kind: 'navigation', operation: 'navigation', label: 'Cliente', when: '404' });
  });

  it('refleja un cambio del store hecho por otra vía', () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('screen', { x: 0, y: 0 }) }));

    act(() => store.getState().renameNode(nodeId, 'Inicio'));

    expect(screen.getByLabelText('Título')).toHaveValue('Inicio');
  });
});

describe('regla y decisión', () => {
  it('convierte una regla en decisión y deja asignar a mano la salida de cada conexión', async () => {
    const { store, nodeId } = renderPanel((s) => {
      const rule = s.addNode('rule', { x: 0, y: 0 });
      const login = s.addNode('screen', { x: 0, y: 0 });
      s.renameNode(login, 'Login');
      s.connect(rule, login);
      return { nodeId: rule };
    });

    await userEvent.click(screen.getByRole('button', { name: /Decisión/ }));

    expect(screen.getByRole('button', { name: /Decisión/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Salida 1')).toHaveValue('Sí');
    expect(screen.getByLabelText('Salida 2')).toHaveValue('No');
    await userEvent.selectOptions(screen.getByLabelText('→ Login'), 'No');
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar rama' }));

    const node = store.getState().nodes[nodeId]!;
    expect(node.branches?.map((b) => b.label)).toEqual(['Sí', 'No', 'Rama 3']);
    expect(Object.values(store.getState().edges)[0]?.branch).toBe(node.branches![1]!.id);
  });
});

describe('inspector de una conexión', () => {
  it('resume origen → destino y, al marcar "responde" una pantalla → API, invierte el sentido y lo dice', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const screenId = s.addNode('screen', { x: 0, y: 0 });
      const api = s.addNode('api', { x: 0, y: 0 });
      return { edgeId: s.connect(screenId, api)! };
    });
    const summary = screen.getByRole('region', { name: 'Resumen de la conexión' });
    expect(summary).toHaveTextContent('Pantalla→API');
    expect(summary).toHaveTextContent('llama');

    await userEvent.type(screen.getByLabelText('Etiqueta'), 'Alta');
    await userEvent.selectOptions(screen.getByLabelText('Operación'), 'Es el retorno de otra operación');

    const edge = store.getState().edges[edgeId]!;
    expect(store.getState().nodes[edge.from]?.type).toBe('api');
    expect(edge).toMatchObject({ kind: 'response', label: 'Alta' });
    expect(summary).toHaveTextContent('API→Pantalla');
    expect(screen.getByRole('status')).toHaveTextContent('Se invirtió el sentido');

    await userEvent.click(screen.getByRole('button', { name: /Invertir sentido/ }));
    expect(store.getState().nodes[store.getState().edges[edgeId]!.from]?.type).toBe('screen');
  });

  it('una solicitud muestra el contrato de la API y añade respuestas vinculadas con su código', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const screenId = s.addNode('screen', { x: 0, y: 0 });
      const api = s.addNode('api', { x: 0, y: 0 });
      s.setHttp(api, { method: 'POST', path: '/creacionUsuario', responses: [{ status: 201 }, { status: 409 }] });
      return { edgeId: s.connect(screenId, api)! };
    });

    expect(screen.getByRole('region', { name: 'Solicitud' })).toHaveTextContent('Contrato de la API: POST /creacionUsuario');
    expect(screen.queryByLabelText('Código HTTP')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir respuesta 409' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Añadir respuesta' }));

    const responses = Object.values(store.getState().edges).filter((e) => e.replyTo === edgeId);
    expect(responses.map((r) => [r.kind, r.status])).toEqual([
      ['response', 409],
      ['response', undefined],
    ]);
    expect(within(screen.getByRole('region', { name: 'Retornos' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('una respuesta tiene código HTTP propio, solicitud asociada y "qué ocurre después"', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const screenId = s.addNode('screen', { x: 0, y: 0 });
      const api = s.addNode('api', { x: 0, y: 0 });
      const request = s.connect(screenId, api)!;
      const response = s.connect(api, screenId)!;
      s.updateEdge(response, { when: '200' });
      s.updateEdge(request, { label: 'Alta' });
      return { edgeId: response };
    });

    // Un código que venía como condición se muestra en su campo.
    const code = screen.getByLabelText('Código HTTP');
    expect(code).toHaveValue('200');
    await userEvent.clear(code);
    await userEvent.type(code, '42');
    expect(screen.getByRole('alert')).toHaveTextContent('100 a 599');
    await userEvent.type(code, '2');
    await userEvent.selectOptions(screen.getByLabelText('Operación asociada'), 'Pantalla → API · Alta');
    await userEvent.type(screen.getByLabelText('Qué ocurre después'), 'Se navega al inicio');

    const edge = store.getState().edges[edgeId]!;
    // El código pasa a su campo y deja de ser la condición.
    expect(edge.status).toBe(422);
    expect(edge.when).toBeUndefined();
    expect(edge.outcome).toBe('Se navega al inicio');
    expect(store.getState().edges[edge.replyTo!]?.label).toBe('Alta');
  });
});
