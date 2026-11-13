import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createGraphStore, type GraphStore } from '../../store/graphStore';
import { GraphStoreProvider } from '../../store/GraphStoreProvider';
import { PropertiesPanel } from '../PropertiesPanel';

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

describe('contrato de una API en el inspector', () => {
  it('documenta autenticación, parámetros, request y respuestas con errores', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('api', { x: 0, y: 0 }) }));
    const contract = screen.getByRole('group', { name: 'Contrato de la API' });

    await userEvent.selectOptions(within(contract).getByLabelText('Tipo de autenticación'), 'bearer');
    await userEvent.click(within(contract).getByRole('button', { name: '+ Parámetro' }));
    await userEvent.type(within(contract).getByLabelText('Nombre'), 'id ');
    await userEvent.selectOptions(within(contract).getByLabelText('Dónde'), 'path');
    await userEvent.click(within(contract).getAllByLabelText('Obligatorio')[0]!);
    await userEvent.type(within(contract).getByLabelText('Content-Type'), 'application/json');
    await userEvent.click(within(contract).getAllByRole('button', { name: '+ Respuesta' })[0]!);
    await userEvent.click(within(contract).getAllByRole('button', { name: '+ Respuesta' })[0]!);
    const codes = within(contract).getAllByLabelText('Código');
    await userEvent.clear(codes[1]!);
    await userEvent.type(codes[1]!, '404');
    await userEvent.type(within(contract).getAllByLabelText('Significado')[1]!, 'No existe el cliente');

    // El borrador conserva el espacio; el nodo guarda lo normalizado.
    expect(within(contract).getByLabelText('Nombre')).toHaveValue('id ');
    expect(store.getState().nodes[nodeId]?.http).toEqual({
      auth: { type: 'bearer' },
      params: [{ name: 'id', in: 'path', required: true }],
      request: { contentType: 'application/json' },
      responses: [{ status: 200 }, { status: 404, description: 'No existe el cliente' }],
    });
    expect(screen.getByText('404', { selector: '.contract-status' }).closest('fieldset')).toHaveAttribute('data-error', 'true');
    expect(store.getState().dirty).toBe(true);
  });

  it('quitar el último parámetro deja el contrato sin parámetros', async () => {
    const { store, nodeId } = renderPanel((s) => {
      const id = s.addNode('api', { x: 0, y: 0 });
      s.setHttp(id, { method: 'GET', params: [{ name: 'id', in: 'path' }] });
      return { nodeId: id };
    });

    await userEvent.click(screen.getByRole('button', { name: 'Quitar parámetro id' }));

    expect(store.getState().nodes[nodeId]?.http).toEqual({ method: 'GET' });
  });
});

describe('estructura de una base de datos', () => {
  it('documenta motor, tablas, campos con clave y relaciones', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('database', { x: 0, y: 0 }) }));
    const structure = screen.getByRole('group', { name: 'Estructura de la base de datos' });

    await userEvent.type(within(structure).getByLabelText('Motor'), 'PostgreSQL');
    await userEvent.type(within(structure).getByLabelText('Schemas'), 'pagos, clientes');
    await userEvent.click(within(structure).getByRole('button', { name: '+ Tabla' }));
    await userEvent.type(within(structure).getAllByLabelText('Nombre')[0]!, 'cuentas');
    await userEvent.click(within(structure).getByRole('button', { name: '+ Campo' }));
    await userEvent.type(within(structure).getAllByLabelText('Campo')[0]!, 'id');
    await userEvent.selectOptions(within(structure).getByLabelText('Clave'), 'primary');
    await userEvent.click(within(structure).getByRole('button', { name: '+ Relación' }));
    const relation = within(structure).getByRole('group', { name: 'relación 1 de cuentas' });
    await userEvent.type(within(relation).getByLabelText('Campo'), 'cliente_id');
    await userEvent.type(within(relation).getByLabelText('Referencia'), 'clientes.id');

    expect(within(structure).getByLabelText('Schemas')).toHaveValue('pagos, clientes');
    expect(store.getState().nodes[nodeId]?.database).toEqual({
      engine: 'PostgreSQL',
      schemas: ['pagos', 'clientes'],
      tables: [
        {
          name: 'cuentas',
          fields: [{ name: 'id', key: 'primary' }],
          relations: [{ field: 'cliente_id', references: 'clientes.id' }],
        },
      ],
    });
  });
});

describe('notas y detalle de las conexiones', () => {
  it('un actor documenta sus responsabilidades y una regla sus notas', async () => {
    const { store, nodeId } = renderPanel((s) => ({ nodeId: s.addNode('actor', { x: 0, y: 0 }) }));

    await userEvent.type(screen.getByLabelText('Responsabilidades'), 'Aprueba la transferencia');

    expect(store.getState().nodes[nodeId]?.notes).toBe('Aprueba la transferencia');
    expect(screen.queryByRole('group', { name: 'Contrato de la API' })).not.toBeInTheDocument();
  });

  it('una conexión documenta notas, su operación con entidades y un ejemplo propio', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const api = s.addNode('api', { x: 0, y: 0 });
      const db = s.addNode('database', { x: 0, y: 0 });
      return { edgeId: s.connect(api, db)! };
    });

    await userEvent.type(screen.getByLabelText('Notas de la interacción'), 'En una transacción');
    await userEvent.selectOptions(screen.getByLabelText('Operación'), 'db.write');
    await userEvent.type(screen.getByLabelText('Tablas o entidades'), 'cuentas, movimientos');
    await userEvent.type(screen.getByLabelText('Ejemplo de payload'), 'INSERT');

    expect(store.getState().edges[edgeId]).toMatchObject({
      kind: 'request',
      operation: 'db.write',
      notes: 'En una transacción',
      exchange: { entities: ['cuentas', 'movimientos'] },
      example: 'INSERT',
    });
    expect(store.getState().edges[edgeId]!.data).toBeUndefined();
  });

  it('un tipo «lee» con acceso «escribe» se señala y se resuelve eligiendo, sin deducir', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const api = s.addNode('api', { x: 0, y: 0 });
      const db = s.addNode('database', { x: 0, y: 0 });
      const id = s.connect(api, db, 'reads')!;
      s.updateEdge(id, { data: { operation: 'write', entities: ['cuentas'] } });
      return { edgeId: id };
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Necesita revisión');
    expect(store.getState().edges[edgeId]).toMatchObject({ kind: 'reads', data: { operation: 'write' } });
    await userEvent.click(screen.getByRole('button', { name: 'Escribir' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(store.getState().edges[edgeId]).toMatchObject({ kind: 'request', operation: 'db.write', exchange: { entities: ['cuentas'] } });
    expect(store.getState().edges[edgeId]!.data).toBeUndefined();
  });

  it('una consulta añade sus resultados (no «respuestas») con su tipo', async () => {
    const { store, edgeId } = renderPanel((s) => {
      const api = s.addNode('api', { x: 0, y: 0 });
      const db = s.addNode('database', { x: 0, y: 0 });
      const id = s.connect(api, db)!;
      s.updateEdge(id, { operation: 'db.query', kind: 'request' });
      return { edgeId: id };
    });

    expect(screen.queryByRole('button', { name: /Añadir respuesta/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Añadir resultado' }));
    await userEvent.click(screen.getByRole('button', { name: 'Añadir retorno resultado vacío' }));

    const returns = Object.values(store.getState().edges).filter((e) => e.replyTo === edgeId);
    expect(returns.map((r) => [r.kind, r.from, r.result?.type])).toEqual([
      ['response', store.getState().edges[edgeId]!.to, 'success'],
      ['response', store.getState().edges[edgeId]!.to, 'empty'],
    ]);
  });
});
