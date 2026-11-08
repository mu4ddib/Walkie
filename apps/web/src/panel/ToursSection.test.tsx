import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createGraphStore, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

function Harness({ onPlay }: { onPlay?: (id: string) => void }) {
  const [openTourId, setOpenTourId] = useState<string | null>(null);
  return <PropertiesPanel nodeId={null} edgeId={null} tours={{ openTourId, onOpen: setOpenTourId, onPlay }} />;
}

function renderTours(setup: (s: GraphStore) => void = () => {}, onPlay?: (id: string) => void) {
  const store = createGraphStore();
  setup(store.getState());
  store.getState().markSaved(1);
  render(
    <GraphStoreProvider store={store}>
      <Harness onPlay={onPlay} />
    </GraphStoreProvider>,
  );
  return { store, tours: () => Object.values(store.getState().tours) };
}

function withNodes(s: GraphStore) {
  const login = s.addNode('screen', { x: 0, y: 0 });
  s.updateNode(login, { title: 'Login' });
  const rule = s.addNode('rule', { x: 0, y: 0 });
  s.updateNode(rule, { title: 'Documento válido' });
}

describe('sección Tours del panel', () => {
  it('sin nada seleccionado muestra la ayuda y la sección vacía', () => {
    renderTours();

    expect(screen.getByText(/Selecciona un nodo o una conexión/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no hay tours/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo tour' })).toBeDisabled();
  });

  it('crea un tour y abre su editor', async () => {
    const { store, tours } = renderTours(withNodes);

    await userEvent.type(screen.getByLabelText('Nombre del tour nuevo'), 'Iniciar sesión');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo tour' }));

    expect(tours()).toEqual([{ id: expect.any(String), name: 'Iniciar sesión', steps: [] }]);
    expect(screen.getByLabelText('Nombre del tour')).toHaveValue('Iniciar sesión');
    expect(store.getState().dirty).toBe(true);
  });

  it('agrega pasos con nodo y nota, los ordena y los quita', async () => {
    const { tours } = renderTours((s) => {
      withNodes(s);
      s.addTour('Iniciar sesión');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await userEvent.selectOptions(screen.getByLabelText('Nodo del paso nuevo'), 'Pantalla: Login');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar paso' }));
    await userEvent.selectOptions(screen.getByLabelText('Nodo del paso nuevo'), 'Regla: Documento válido');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar paso' }));
    await userEvent.type(screen.getByLabelText('Paso 1: nota'), 'Aquí empieza todo');

    const titles = () => tours()[0]!.steps.map((step) => (step.nodeId && step.note ? `${step.note}` : 'sin nota'));
    expect(titles()).toEqual(['Aquí empieza todo', 'sin nota']);

    await userEvent.click(screen.getByRole('button', { name: 'Bajar paso 1' }));
    expect(titles()).toEqual(['sin nota', 'Aquí empieza todo']);
    expect(screen.getByRole('button', { name: 'Subir paso 1' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar paso 1' }));
    expect(titles()).toEqual(['Aquí empieza todo']);
    expect(within(screen.getByRole('list', { name: 'Pasos' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('renombra, vuelve a la lista y borra el tour', async () => {
    const { tours } = renderTours((s) => {
      withNodes(s);
      s.addTour('Iniciar sesión');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    const name = screen.getByLabelText('Nombre del tour');
    await userEvent.clear(name);
    expect(screen.getByRole('alert')).toHaveTextContent('El nombre no puede quedar vacío.');
    await userEvent.type(name, 'Login');
    expect(tours()[0]!.name).toBe('Login');

    await userEvent.click(screen.getByRole('button', { name: '← Todos los tours' }));
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar tour' }));
    expect(tours()).toEqual([]);
    expect(screen.getByText(/Aún no hay tours/)).toBeInTheDocument();
  });

  it('Ver tour avisa con el id y solo se habilita con pasos', async () => {
    const onPlay = vi.fn();
    let tourId = '';
    renderTours((s) => {
      withNodes(s);
      tourId = s.addTour('Iniciar sesión')!;
    }, onPlay);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(screen.getByRole('button', { name: 'Ver tour' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar paso' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver tour' }));

    expect(onPlay).toHaveBeenCalledWith(tourId);
  });

  it('sin nodos en el lienzo lo dice', async () => {
    renderTours((s) => void s.addTour('Vacío'));
    await userEvent.click(screen.getByRole('button', { name: 'Vacío' }));

    expect(screen.getByText('Agrega nodos al lienzo para armar los pasos.')).toBeInTheDocument();
  });
});
