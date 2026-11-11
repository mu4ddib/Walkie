import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createGraphStore, toGraph, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import type { StoreApi } from 'zustand/vanilla';
import { withoutIds } from '../test/steps';
import { PropertiesPanel } from './PropertiesPanel';
import { ToursSection, type ToursSectionProps } from './ToursSection';

/** Monta la sección como en el lienzo: el tour abierto lo guarda quien la contiene. */
function Harness({ store, initial, extra }: { store: StoreApi<GraphStore>; initial: string | null; extra?: Partial<ToursSectionProps> }) {
  const [open, setOpen] = useState<string | null>(initial);
  return (
    <GraphStoreProvider store={store}>
      <PropertiesPanel nodeId={null} edgeId={null} tours={{ openTourId: open, onOpen: setOpen, ...extra }} />
    </GraphStoreProvider>
  );
}

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
  const onLocate = vi.fn();
  s().markSaved(1);
  render(<Harness store={store} initial={tourId} extra={{ onPlay, onLocate, picking: { tourId: null, onToggle } }} />);
  return { store, s, tourId, req, call, reply, api, service, onPlay, onToggle, onLocate };
}

const step = (n: number) => screen.getByRole('listitem', { name: `Paso ${n}` });
/** El encabezado del paso (el que abre y cierra), no el asa ni «⋯». */
const toggle = (n: number) => step(n).querySelector<HTMLButtonElement>('.tour-step-toggle')!;
const menu = async (n: number, action: RegExp | string) => {
  await userEvent.click(screen.getByRole('button', { name: `Acciones del paso ${n}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: action }));
};

describe('editor de recorridos (acordeón)', () => {
  it('los pasos se leen cerrados: número, origen → destino y qué hacen; se reproduce desde la cabecera', async () => {
    const { tourId, onPlay } = setup();

    expect(step(1)).toHaveTextContent('Creación de cuenta → API usuarios');
    expect(step(1)).toHaveTextContent('llama');
    expect(within(step(1)).queryByLabelText('Paso 1: conexión')).not.toBeInTheDocument();
    expect(screen.getByText('✓ Los pasos están encadenados.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '▶ Reproducir recorrido' }));
    expect(onPlay).toHaveBeenCalledWith(tourId);
  });

  it('un solo paso abierto a la vez; abrir y cerrar no marca cambios; lo escrito queda al cerrar', async () => {
    const { s, tourId } = setup();

    await userEvent.click(toggle(1));
    expect(toggle(1)).toHaveAttribute('aria-expanded', 'true');
    await userEvent.type(screen.getByLabelText('Paso 1: descripción'), 'Envía el formulario');
    await userEvent.click(toggle(2));
    expect(toggle(1)).toHaveAttribute('aria-expanded', 'false');
    expect(toggle(2)).toHaveAttribute('aria-expanded', 'true');
    expect(s().tours[tourId]!.steps[0]!.note).toBe('Envía el formulario');
    // El encabezado cerrado muestra la vista previa de la nota.
    expect(step(1)).toHaveTextContent('Envía el formulario');

    s().markSaved(2);
    await userEvent.click(toggle(2));
    await userEvent.click(screen.getByRole('button', { name: 'Expandir todos' }));
    expect(screen.getByLabelText('Paso 1: descripción')).toBeInTheDocument();
    expect(screen.getByLabelText('Paso 2: descripción')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Contraer todos' }));
    expect(screen.queryByLabelText('Paso 1: descripción')).not.toBeInTheDocument();
    expect(s().dirty).toBe(false);
  });

  it('un paso nuevo se abre con el foco en su primer campo; insertar, duplicar y quitar desde el menú', async () => {
    const { s, tourId, req } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar conexión' }));
    expect(s().tours[tourId]!.steps).toHaveLength(3);
    expect(toggle(3)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Paso 3: conexión')).toHaveFocus();

    await menu(1, 'Insertar paso después del 1');
    expect(s().tours[tourId]!.steps).toHaveLength(4);
    expect(toggle(2)).toHaveAttribute('aria-expanded', 'true');

    await menu(1, 'Duplicar paso 1');
    expect(s().tours[tourId]!.steps[1]!.edgeId).toBe(req);
    expect(s().tours[tourId]!.steps[1]!.id).not.toBe(s().tours[tourId]!.steps[0]!.id);

    await menu(2, 'Quitar paso 2');
    expect(s().tours[tourId]!.steps).toHaveLength(4);
  });

  it('reordenar un paso abierto conserva su contenido y sigue abierto; el asa mueve con ↑ ↓', async () => {
    const { s, tourId, call } = setup();
    await userEvent.click(toggle(2));
    await userEvent.type(screen.getByLabelText('Paso 2: descripción'), 'Delega');

    await menu(2, 'Subir paso 2');
    expect(s().tours[tourId]!.steps[0]).toMatchObject({ edgeId: call, note: 'Delega' });
    expect(toggle(1)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Paso 1: descripción')).toHaveValue('Delega');

    const grip = screen.getByRole('button', { name: /Mover paso 1/ });
    grip.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(s().tours[tourId]!.steps[1]).toMatchObject({ edgeId: call, note: 'Delega' });
    expect(screen.getByRole('button', { name: /Mover paso 2/ })).toHaveFocus();
  });

  it('localizar en el lienzo desde el menú o el paso abierto', async () => {
    const { onLocate, call } = setup();
    await menu(2, 'Localizar paso 2 en el lienzo');
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ edgeId: call }));
    await userEvent.click(toggle(1));
    await userEvent.click(screen.getByRole('button', { name: '⌖ Localizar en lienzo' }));
    expect(onLocate).toHaveBeenCalledTimes(2);
  });

  it('una conexión eliminada: el encabezado lo dice, la nota se conserva, se reemplaza o se quita', async () => {
    const { s, tourId, call, api, service } = setup();
    act(() => {
      s().updateStepNote(tourId, 1, 'Delega');
      s().removeEdge(call);
    });

    expect(step(2)).toHaveTextContent('Conexión eliminada');
    await userEvent.click(toggle(2));
    expect(within(step(2)).getByText(/La nota se conserva/)).toBeInTheDocument();
    expect(screen.getByLabelText('Paso 2: descripción')).toHaveValue('Delega');

    let again = '';
    act(() => {
      again = s().connect(api, service, 'event')!;
    });
    await userEvent.selectOptions(within(step(2)).getByLabelText('Paso 2: reemplazar por'), again);
    expect(withoutIds(s().tours[tourId]!.steps[1])).toEqual({ edgeId: again, note: 'Delega' });
  });

  it('señala la respuesta adelantada y aplica el orden sugerido', async () => {
    const { s, tourId, req, reply } = setup('mixed');
    expect(step(1)).toHaveTextContent('Respuesta antes de su solicitud');
    act(() => s().removeStep(tourId, 1));
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar orden sugerido' }));
    expect(s().tours[tourId]!.steps.map((x) => x.edgeId)).toEqual([req, reply]);
  });
});

describe('lista de tours', () => {
  function renderList(count: number) {
    const store = createGraphStore();
    const s = () => store.getState();
    const a = s().addNode('screen', { x: 0, y: 0 });
    for (let i = 1; i <= count; i++) {
      const t = s().addTour(`Tour ${String(i).padStart(2, '0')}${i === 3 ? ' con un nombre muy largo que no cabe en la fila' : ''}`)!;
      s().addStep(t, a);
    }
    render(<Harness store={store} initial={null} extra={{ onPlay: vi.fn() }} />);
    return { s };
  }

  it('filas compactas con pasos, ▶ y «⋯»; búsqueda con estado vacío; volver recupera la búsqueda', async () => {
    renderList(6);
    const rows = screen.getByRole('list', { name: 'Tours' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(6);
    expect(within(rows).getAllByRole('button', { name: 'Ver tour' })[0]).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Buscar tours'), 'largo');
    expect(within(screen.getByRole('list', { name: 'Tours' })).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Tour 03/ }));
    expect(screen.getByLabelText('Nombre del tour')).toHaveValue('Tour 03 con un nombre muy largo que no cabe en la fila');
    await userEvent.click(screen.getByRole('button', { name: '← Volver a tours' }));
    expect(screen.getByLabelText('Buscar tours')).toHaveValue('largo');

    await userEvent.clear(screen.getByLabelText('Buscar tours'));
    await userEvent.type(screen.getByLabelText('Buscar tours'), 'nada');
    expect(screen.getByRole('status')).toHaveTextContent('Ningún tour se llama «nada»');
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(within(screen.getByRole('list', { name: 'Tours' })).getAllByRole('listitem')).toHaveLength(6);
  });

  it('renombrar, duplicar y eliminar desde «⋯»', async () => {
    const { s } = renderList(2);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const first = within(screen.getByRole('list', { name: 'Tours' })).getAllByRole('listitem')[0]!;

    await userEvent.click(within(first).getByRole('button', { name: 'Más acciones' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Renombrar' }));
    await userEvent.clear(screen.getByLabelText('Nuevo nombre de «Tour 01»'));
    await userEvent.type(screen.getByLabelText('Nuevo nombre de «Tour 01»'), 'Inicio{Enter}');
    expect(Object.values(s().tours).map((t) => t.name)).toContain('Inicio');

    const row = () => within(screen.getByRole('list', { name: 'Tours' })).getAllByRole('listitem')[0]!;
    await userEvent.click(within(row()).getByRole('button', { name: 'Más acciones' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Eliminar' }));
    expect(Object.values(s().tours).map((t) => t.name)).not.toContain('Inicio');
  });

  it('el menú se maneja con teclado: abre, recorre con flechas y Esc vuelve al botón', async () => {
    renderList(1);
    const more = screen.getByRole('button', { name: 'Más acciones' });
    more.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Renombrar' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Duplicar' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});

describe('pestañas y editores separados', () => {
  it('separa tours y recorridos; un recorrido nuevo nace vacío y es un recorrido', async () => {
    const store = createGraphStore();
    const s = () => store.getState();
    const a = s().addNode('screen', { x: 0, y: 0 });
    const b = s().addNode('api', { x: 0, y: 0 });
    const e = s().connect(a, b, 'request')!;
    s().addTour('Conoce la pantalla');
    s().addFlowTour('Alta', [e]);
    render(<Harness store={store} initial={null} />);

    expect(screen.getByRole('tab', { name: 'Tours 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('list', { name: 'Tours' })).toHaveTextContent('Conoce la pantalla');
    await userEvent.click(screen.getByRole('tab', { name: 'Recorridos 1' }));
    expect(screen.getByRole('list', { name: 'Recorridos' })).toHaveTextContent('Alta');

    await userEvent.type(screen.getByLabelText('Nombre del recorrido nuevo'), 'Error de correo');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo recorrido' }));
    expect(screen.getByLabelText('Nombre del recorrido')).toHaveValue('Error de correo');
    expect(screen.getByText(/Este recorrido aún no tiene pasos/)).toBeInTheDocument();
    expect(Object.values(s().tours).find((t) => t.name === 'Error de correo')).toMatchObject({ kind: 'flow', steps: [] });
  });

  it('un tour solo ofrece nodos; un recorrido marca los pasos de nodo que trae de antes', async () => {
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
    const { unmount } = render(<Harness store={store} initial={guide} />);
    expect(screen.getByLabelText('Nodo del paso nuevo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Conexión del paso nuevo')).not.toBeInTheDocument();
    unmount();

    render(<Harness store={store} initial="old" />);
    expect(screen.getByRole('tab', { name: /Recorridos/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Conexión del paso nuevo')).toBeInTheDocument();
    await userEvent.click(toggle(1));
    expect(step(1)).toHaveTextContent('este paso de nodo viene de antes');
  });
});

describe('reproducción', () => {
  it('lista de solo lectura con el paso activo; tocar otro salta; nada se despliega', async () => {
    const store = createGraphStore();
    const s = () => store.getState();
    const a = s().addNode('screen', { x: 0, y: 0 });
    const t = s().addTour('Guía')!;
    for (let i = 0; i < 30; i++) s().addStep(t, a, `Nota ${i + 1}`);
    const onJump = vi.fn();
    render(
      <GraphStoreProvider store={store}>
        <ToursSection openTourId={null} onOpen={vi.fn()} playback={{ tourId: t, step: 4, onJump }} />
      </GraphStoreProvider>,
    );
    expect(screen.getByText('Reproduciendo · paso 5 de 30')).toBeInTheDocument();
    expect(within(step(5)).getByRole('button', { current: 'step' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mover paso/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Paso 5: nota')).not.toBeInTheDocument();
    await userEvent.click(within(step(12)).getByRole('button'));
    expect(onJump).toHaveBeenCalledWith(11);
  });
});
