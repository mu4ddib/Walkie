import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createGraphStore, toGraph } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

/** Pantalla → API → Servicio, con la respuesta de la API, y un recorrido sobre esas conexiones. */
function setup(order: 'ok' | 'mixed' = 'ok') {
  const store = createGraphStore();
  const s = () => store.getState();
  const screenId = s().addNode('screen', { x: 0, y: 0 });
  s().renameNode(screenId, 'Creación de cuenta');
  const api = s().addNode('api', { x: 0, y: 0 });
  s().renameNode(api, 'API usuarios');
  const service = s().addNode('service', { x: 0, y: 0 });
  s().renameNode(service, 'Servicio usuarios');
  const req = s().connect(screenId, api, 'request')!;
  const call = s().connect(api, service, 'request')!;
  const reply = s().addResponse(req, { status: 201 })!;
  const steps = order === 'ok' ? [req, call] : [reply, call, req];
  const tourId = s().addFlowTour('Alta', steps)!;
  const onPlay = vi.fn();
  const onToggle = vi.fn();
  render(
    <GraphStoreProvider store={store}>
      <PropertiesPanel
        nodeId={null}
        edgeId={null}
        tours={{ openTourId: tourId, onOpen: vi.fn(), onPlay, picking: { tourId: null, onToggle } }}
      />
    </GraphStoreProvider>,
  );
  return { store, s, tourId, req, call, reply, api, service, onPlay, onToggle };
}

describe('editor de recorridos', () => {
  it('muestra cada paso con origen → destino, encadenados, y lo reproduce', async () => {
    const { tourId, onPlay } = setup();

    const steps = screen.getByRole('list', { name: 'Pasos' });
    expect(within(steps).getByRole('listitem', { name: 'Paso 1' })).toHaveTextContent(
      'Creación de cuenta → API usuarios · llama',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Los pasos están encadenados');
    await userEvent.click(screen.getByRole('button', { name: '▶ Reproducir recorrido' }));
    expect(onPlay).toHaveBeenCalledWith(tourId);
  });

  it('agrega la continuación desde el último nodo y la descripción de un paso', async () => {
    const { s, tourId, onToggle } = setup();
    await userEvent.click(screen.getByRole('button', { name: '＋ Elegir pasos en el lienzo' }));
    expect(onToggle).toHaveBeenCalledWith(tourId);

    // El recorrido termina en el servicio, que no tiene salidas: se agrega con la lista de conexiones.
    await userEvent.selectOptions(screen.getByLabelText('Conexión del paso nuevo'), s().tours[tourId]!.steps[0]!.edgeId!);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar conexión' }));
    expect(s().tours[tourId]!.steps).toHaveLength(3);
    // Repetir la solicitud (reintento) señala el salto desde el servicio.
    expect(screen.getByRole('listitem', { name: 'Paso 3' })).toHaveTextContent('Salto');

    await userEvent.type(screen.getByLabelText('Paso 1: descripción'), 'Envía el formulario');
    expect(s().tours[tourId]!.steps[0]!.note).toBe('Envía el formulario');
  });

  it('ofrece el orden sugerido cuando la secuencia es única y señala la respuesta adelantada', async () => {
    const { s, tourId, req, call, reply } = setup('mixed');

    expect(screen.getByRole('listitem', { name: 'Paso 1' })).toHaveTextContent('va antes de su solicitud');
    // req → reply y req → call: dos continuaciones desde la API, no hay un único orden... salvo que la respuesta cierre.
    expect(screen.getByRole('status')).toHaveTextContent(/define tú el orden|único orden/);
    act(() => s().removeStep(tourId, 1));
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar orden sugerido' }));
    expect(s().tours[tourId]!.steps.map((x) => x.edgeId)).toEqual([req, reply]);
    expect(call).toBeDefined();
  });

  it('una conexión eliminada deja el paso marcado: se reemplaza o se quita', async () => {
    const { s, tourId, call, api, service } = setup();
    act(() => s().removeEdge(call));

    const step = await screen.findByRole('listitem', { name: 'Paso 2' });
    expect(step).toHaveTextContent('Conexión eliminada: API usuarios → Servicio usuarios');
    expect(step).toHaveTextContent('reemplázala o quita el paso');

    let again = '';
    act(() => {
      again = s().connect(api, service, 'event')!;
    });
    await userEvent.selectOptions(within(step).getByLabelText('Paso 2: reemplazar por'), again);
    expect(s().tours[tourId]!.steps[1]).toEqual({ edgeId: again });
  });
});

describe('pestañas de tours y recorridos', () => {
  function renderLists() {
    const store = createGraphStore();
    const s = () => store.getState();
    const a = s().addNode('screen', { x: 0, y: 0 });
    const b = s().addNode('api', { x: 0, y: 0 });
    const e = s().connect(a, b, 'request')!;
    s().addTour('Conoce la pantalla');
    s().addFlowTour('Alta', [e]);
    const onOpen = vi.fn();
    render(
      <GraphStoreProvider store={store}>
        <PropertiesPanel nodeId={null} edgeId={null} tours={{ openTourId: null, onOpen }} />
      </GraphStoreProvider>,
    );
    return { s, onOpen };
  }

  it('separa tours y recorridos, cada uno con su cantidad, su explicación y su alta', async () => {
    const { s, onOpen } = renderLists();

    expect(screen.getByRole('tab', { name: 'Tours 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Recorridos 1' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('list', { name: 'Tours' })).toHaveTextContent('Conoce la pantalla');
    expect(screen.queryByText('Alta')).not.toBeInTheDocument();
    expect(screen.getByText(/El guía presenta nodos/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Recorridos 1' }));
    expect(screen.getByRole('list', { name: 'Recorridos' })).toHaveTextContent('Alta');
    expect(screen.getByText(/Reproducen conexiones en orden/)).toBeInTheDocument();

    // Un recorrido nuevo nace vacío y es un recorrido.
    await userEvent.type(screen.getByLabelText('Nombre del recorrido nuevo'), 'Error de correo');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo recorrido' }));
    const created = onOpen.mock.calls[0]![0] as string;
    expect(s().tours[created]).toMatchObject({ name: 'Error de correo', kind: 'flow', steps: [] });
  });
});

describe('editores separados', () => {
  it('un tour solo ofrece nodos; un recorrido, conexiones (y marca los pasos de nodo que trae de antes)', () => {
    const store = createGraphStore();
    const s = () => store.getState();
    const a = s().addNode('screen', { x: 0, y: 0 });
    const b = s().addNode('api', { x: 0, y: 0 });
    const e = s().connect(a, b, 'request')!;
    const guide = s().addTour('Clásico')!;
    s().addStep(guide, a);
    s().loadGraph({
      ...toGraph(s()),
      tours: { ...s().tours, old: { id: 'old', name: 'Anterior', steps: [{ nodeId: a }, { edgeId: e }] } },
    });
    const { rerender } = render(
      <GraphStoreProvider store={store}>
        <PropertiesPanel nodeId={null} edgeId={null} tours={{ openTourId: guide, onOpen: vi.fn() }} />
      </GraphStoreProvider>,
    );
    expect(screen.getByLabelText('Nodo del paso nuevo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Conexión del paso nuevo')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Tours/ })).toHaveAttribute('aria-selected', 'true');

    rerender(
      <GraphStoreProvider store={store}>
        <PropertiesPanel nodeId={null} edgeId={null} tours={{ openTourId: 'old', onOpen: vi.fn() }} />
      </GraphStoreProvider>,
    );
    expect(screen.getByRole('tab', { name: /Recorridos/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Conexión del paso nuevo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nodo del paso nuevo')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Paso 1' })).toHaveTextContent('Paso de nodo');
  });
});
