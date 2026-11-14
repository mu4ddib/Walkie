import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogContext, toCanvasCatalog } from '../catalog/catalogContext';
import { CameraContext } from '../canvas/useCamera';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { GUIDE_SHEETS } from './guideSprites';
import { TourPlayer } from './TourPlayer';
import { TOUR_TIMING } from './tourTiming';

const flow = { getViewport: vi.fn(() => ({ x: 10, y: 20, zoom: 0.8 })) };
// La cámara del lienzo (una sola dueña de la vista): el guía centra con ella y al salir vuelve con ella.
const camera = { centerOn: vi.fn(), to: vi.fn(), fit: vi.fn(), fitBounds: vi.fn(), cancel: vi.fn(), onSettle: vi.fn(), animating: false };
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => flow,
}));

const features = [
  { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'feat-2', appId: 'app-1', name: 'Transferir', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' },
];

function mockReducedMotion(reduced: boolean) {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

/** Lienzo con pantalla, regla y portal, y un tour de tres pasos (datos ficticios). */
function renderPlayer(step = 0) {
  const store = createGraphStore();
  const s = store.getState();
  const login = s.addNode('screen', { x: 0, y: 0 });
  s.updateNode(login, { title: 'Login' });
  const rule = s.addNode('rule', { x: 240, y: 0 });
  s.updateNode(rule, { title: 'Documento válido' });
  const portal = s.addNode('portal', { x: 480, y: 0 });
  s.updateNode(portal, { targetFeatureId: 'feat-2', title: 'Transferir' });
  const tour = s.addTour('Iniciar sesión')!;
  s.addStep(tour, login, 'Escribe tu documento.');
  s.addStep(tour, rule, 'Solo dígitos.');
  s.addStep(tour, portal);
  const onStep = vi.fn();
  const onExit = vi.fn();
  const ui = render(
    <MemoryRouter>
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={toCanvasCatalog('app-1', [], features, 'feat-1')}>
          <CameraContext.Provider value={camera}>
          <TourPlayer
            tourId={tour}
            step={step}
            sizes={{ [login]: { width: 160, height: 48 } }}
            pane={{ width: 800, height: 600 }}
            onStep={onStep}
            onExit={onExit}
          />
          </CameraContext.Provider>
        </CatalogContext.Provider>
      </GraphStoreProvider>
    </MemoryRouter>,
  );
  return { ui, onStep, onExit };
}

const guide = () => screen.getByRole('img', { name: 'Walkie, el guía' });
const bubble = () => screen.getByRole('region', { name: 'Paso del tour' });
const playFrames = (name: keyof typeof GUIDE_SHEETS) =>
  act(() => vi.advanceTimersByTime((1000 / GUIDE_SHEETS[name].fps) * (GUIDE_SHEETS[name].frames + 1)));

describe('TourPlayer', () => {
  it('muestra el progreso, centra el nodo y el guía camina, señala y cuenta la nota', () => {
    renderPlayer();

    expect(screen.getByRole('status')).toHaveTextContent('Paso 1 de 3');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(camera.centerOn).toHaveBeenCalledWith(80, 24, 1.1, expect.anything());
    expect(guide()).toHaveAttribute('data-animation', 'walk');

    act(() => vi.advanceTimersByTime(TOUR_TIMING.walk));
    expect(guide()).toHaveAttribute('data-animation', 'point');

    playFrames('point');
    expect(guide()).toHaveAttribute('data-animation', 'talk');
    // Una letra por temporizador: cada act deja que React pinte y programe la siguiente.
    for (let i = 0; i < 'Escribe tu documento.'.length; i++) act(() => vi.advanceTimersByTime(TOUR_TIMING.typing));
    expect(bubble()).toHaveTextContent('Escribe tu documento.');
    expect(guide()).toHaveAttribute('data-animation', 'idle');
  });

  it('en un paso sobre una regla el guía piensa', () => {
    renderPlayer(1);

    act(() => vi.advanceTimersByTime(TOUR_TIMING.walk));

    expect(guide()).toHaveAttribute('data-animation', 'think');
  });

  it('las flechas cambian de paso y Esc sale', () => {
    const { onStep, onExit } = renderPlayer(1);

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

    expect(onStep.mock.calls).toEqual([[2], [0]]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('un portal ofrece ir a su feature; el último paso dice Terminar y celebra antes de salir', () => {
    const { onExit } = renderPlayer(2);

    expect(screen.getByRole('button', { name: 'Ir a Transferir' })).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Terminar' }).click());

    expect(guide()).toHaveAttribute('data-animation', 'celebrate');
    expect(bubble()).toHaveTextContent('¡Fin del tour!');
    expect(onExit).not.toHaveBeenCalled();
    playFrames('celebrate');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('con movimiento reducido no camina: la nota aparece entera de una vez', () => {
    mockReducedMotion(true);
    renderPlayer(1);

    expect(bubble()).toHaveTextContent('Solo dígitos.');
    expect(camera.centerOn).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ duration: 0 }),
    );
  });

  it('al salir vuelve la vista que había', () => {
    const { ui } = renderPlayer();

    ui.unmount();

    expect(camera.to).toHaveBeenCalledWith({ x: 10, y: 20, zoom: 0.8 });
  });
});
