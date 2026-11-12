import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createGraphStore, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

function renderPanel(create: (s: GraphStore) => string) {
  const store = createGraphStore();
  const nodeId = create(store.getState());
  store.getState().markSaved(1);
  render(
    <GraphStoreProvider store={store}>
      <PropertiesPanel nodeId={nodeId} edgeId={null} />
    </GraphStoreProvider>,
  );
  return { node: () => store.getState().nodes[nodeId]!, store };
}

describe('inspector de infraestructura (spec nodos-de-infraestructura)', () => {
  it('un recurso: subtipo, proveedor, nombre y detalles; el encabezado dice el subtipo', async () => {
    const { node, store } = renderPanel((s) => s.addResource('queue', { x: 0, y: 0 }));
    expect(screen.getByRole('heading', { name: /Cola/ })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), 'AWS');
    await userEvent.type(screen.getByLabelText('Nombre del recurso'), 'pagos-pendientes');
    await userEvent.click(screen.getByRole('button', { name: '+ Detalle' }));
    // Una fila sin clave no se pierde mientras se escribe (borrador local).
    expect(screen.getByLabelText('Clave')).toHaveValue('');
    await userEvent.type(screen.getByLabelText('Clave'), 'retención');
    await userEvent.type(screen.getByLabelText('Valor'), '4 días');

    expect(node().resource).toEqual({
      kind: 'queue',
      provider: 'aws',
      name: 'pagos-pendientes',
      details: [{ key: 'retención', value: '4 días' }],
    });
    expect(store.getState().dirty).toBe(true);

    // Cambiar el subtipo conserva lo demás; quitar el nombre lo quita del grafo.
    await userEvent.selectOptions(screen.getByLabelText('Subtipo'), 'Tópico / bus');
    await userEvent.clear(screen.getByLabelText('Nombre del recurso'));
    expect(node().resource).toEqual({ kind: 'topic', provider: 'aws', details: [{ key: 'retención', value: '4 días' }] });
    expect(screen.getByRole('heading', { name: /Tópico/ })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('group', { name: 'detalle 1' })).getByRole('button', { name: 'Quitar detalle 1' }));
    expect(node().resource!.details).toBeUndefined();
  });

  it('personalizado: el nombre del subtipo anterior queda como el suyo y se puede cambiar', async () => {
    const { node } = renderPanel((s) => s.addResource('cache', { x: 0, y: 0 }));

    await userEvent.selectOptions(screen.getByLabelText('Subtipo'), 'Personalizado');
    expect(screen.getByLabelText('Nombre del subtipo')).toHaveValue('Caché');
    await userEvent.clear(screen.getByLabelText('Nombre del subtipo'));
    await userEvent.type(screen.getByLabelText('Nombre del subtipo'), 'Step Functions');

    expect(node().resource).toEqual({ kind: 'custom', label: 'Step Functions' });
    expect(screen.getByRole('heading', { name: /Step Functions/ })).toBeInTheDocument();
  });

  it('un servicio dice dónde corre; una base, su modelo', async () => {
    const service = renderPanel((s) => s.addNode('service', { x: 0, y: 0 }));
    await userEvent.selectOptions(screen.getByLabelText('Dónde corre'), 'Contenedor');
    expect(service.node().runtime).toBe('container');
    await userEvent.selectOptions(screen.getByLabelText('Dónde corre'), '—');
    expect(service.node().runtime).toBeUndefined();
  });

  it('el modelo de una base de datos', async () => {
    const db = renderPanel((s) => s.addNode('database', { x: 0, y: 0 }));
    await userEvent.selectOptions(screen.getByLabelText('Modelo'), 'Clave-valor');
    expect(db.node().database).toEqual({ model: 'key-value' });
  });
});
