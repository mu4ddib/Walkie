import { getViewportForBounds, useReactFlow, useStoreApi, type FitViewOptions, type Node, type Rect } from '@xyflow/react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { createCamera, type Camera, type CameraOptions, type View } from './camera';

/** La cámara del lienzo más lo que se calcula sobre React Flow (encuadrar cajas, centrar un punto). */
export interface CanvasCamera extends Camera {
  /** «Ver todo»: encuadra las cajas visibles (grupos plegados incluidos) dejando libre `padding`. */
  fit(padding: FitViewOptions['padding'], options?: CameraOptions): Promise<boolean>;
  /**
   * Encuadra un rectángulo del lienzo. Con `floor`, si para que entre entero el zoom quedaría por debajo, usa `floor`
   * y muestra su esquina de arriba a la izquierda (lo que se lee primero) en vez de un lienzo ilegible.
   */
  fitBounds(bounds: Rect, padding: FitViewOptions['padding'], options?: CameraOptions, floor?: number): Promise<boolean>;
  /** Centra un punto del lienzo con un zoom. */
  centerOn(x: number, y: number, zoom: number, options?: CameraOptions): Promise<boolean>;
}

export const CameraContext = createContext<CanvasCamera | null>(null);

/** La cámara del lienzo en el que se está (la provee `Canvas` o `MapPage`). */
export function useCamera(): CanvasCamera {
  const camera = useContext(CameraContext);
  if (!camera) throw new Error('useCamera necesita un CameraContext (Canvas o MapPage).');
  return camera;
}

/** Crea la cámara de un lienzo de React Flow (dentro de su `ReactFlowProvider`) y la detiene al desmontarlo. */
export function useCameraController(): CanvasCamera {
  const { getViewport, setViewport, getNodes, getNodesBounds } = useReactFlow();
  const store = useStoreApi();
  const camera = useMemo(
    () => makeCamera({ getViewport, setViewport, getNodes, getNodesBounds }, store),
    [getViewport, setViewport, getNodes, getNodesBounds, store],
  );
  // Al salir del lienzo no queda ninguna transición pendiente.
  useEffect(() => () => camera.cancel(), [camera]);
  return camera;
}

/** Lo libre arriba y a la izquierda de un `padding` por lado (`'72px'`); un número (fracción) cuenta como 0. */
function paddingPx(padding: FitViewOptions['padding']): { top: number; left: number } {
  if (!padding || typeof padding !== 'object') return { top: 0, left: 0 };
  const px = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.endsWith('px') ? Number.parseFloat(v) : 0);
  const sides = padding as Record<string, unknown>;
  return { top: px(sides.top ?? sides.y), left: px(sides.left ?? sides.x) };
}

type Flow = Pick<ReturnType<typeof useReactFlow>, 'getViewport' | 'setViewport' | 'getNodes' | 'getNodesBounds'>;

function makeCamera(
  { getViewport, setViewport, getNodes, getNodesBounds }: Flow,
  store: ReturnType<typeof useStoreApi>,
): CanvasCamera {
  const size = () => ({ width: store.getState().width, height: store.getState().height });
  const base = createCamera({
    getViewport,
    setViewport: (view: View) => void setViewport(view),
    size,
  });
  const fitBounds: CanvasCamera['fitBounds'] = (bounds, padding, options, floor) => {
    const { width, height, minZoom, maxZoom } = store.getState();
    if (!width || !height) return Promise.resolve(false);
    const view = getViewportForBounds(bounds, width, height, minZoom, maxZoom, padding ?? 0.1);
    if (floor === undefined || view.zoom >= floor) return base.to(view, options);
    const { top, left } = paddingPx(padding);
    return base.to({ x: left - bounds.x * floor, y: top - bounds.y * floor, zoom: floor }, options);
  };
  return {
    get animating() {
      return base.animating;
    },
    to: base.to,
    cancel: base.cancel,
    onSettle: base.onSettle,
    fitBounds,
    fit: (padding, options) => {
      const visible = getNodes().filter((n: Node) => !n.hidden);
      if (visible.length === 0) return Promise.resolve(false);
      return fitBounds(getNodesBounds(visible), padding, options);
    },
    centerOn: (x, y, zoom, options) => {
      const { width, height } = size();
      return base.to({ x: width / 2 - x * zoom, y: height / 2 - y * zoom, zoom }, options);
    },
  };
}
