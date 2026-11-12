import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_SIDE,
  IMAGE_PADDING,
  framing,
  imageFileName,
  keepInImage,
  onCanvasImageRequest,
  requestCanvasImage,
} from './canvasImage';

describe('imagen del lienzo (spec exportar-e-importar, tarea 3)', () => {
  it('encuadra todo el lienzo con su margen, a escala 1', () => {
    expect(framing({ x: -100, y: 50, width: 800, height: 400 })).toEqual({
      width: 800 + 2 * IMAGE_PADDING,
      height: 400 + 2 * IMAGE_PADDING,
      transform: `translate(${IMAGE_PADDING + 100}px, ${IMAGE_PADDING - 50}px) scale(1)`,
    });
  });

  it('un lienzo enorme se achica hasta el lado máximo', () => {
    const frame = framing({ x: 0, y: 0, width: 20000, height: 1000 });
    expect(frame.width).toBeLessThanOrEqual(IMAGE_MAX_SIDE);
    expect(frame.transform).toMatch(/scale\(0\.\d+\)$/);
  });

  it('nombre del archivo: slug de la feature, alcance, resolución y formato', () => {
    expect(imageFileName('Iniciar sesión', { format: 'png', scope: 'all', scale: 2 })).toBe('iniciar-sesion@2x.png');
    expect(imageFileName('Iniciar sesión', { format: 'png', scope: 'visible', scale: 1 })).toBe('iniciar-sesion-vista.png');
    expect(imageFileName(undefined, { format: 'svg', scope: 'all', scale: 2 })).toBe('lienzo.svg');
  });

  it('deja afuera puntos de conexión, grilla y paneles', () => {
    const el = (cls: string) => Object.assign(document.createElement('div'), { className: cls });
    expect(keepInImage(el('react-flow__handle react-flow__handle-right'))).toBe(false);
    expect(keepInImage(el('react-flow__background'))).toBe(false);
    expect(keepInImage(el('react-flow__panel'))).toBe(false);
    expect(keepInImage(el('pixel-node'))).toBe(true);
  });

  it('el pedido llega al lienzo y vuelve con la imagen; sin lienzo, falla', async () => {
    await expect(requestCanvasImage({ format: 'png', scope: 'all', scale: 1 })).rejects.toThrow('No hay un lienzo abierto.');
    const stop = onCanvasImageRequest(async () => new Blob(['x']));
    await expect(requestCanvasImage({ format: 'png', scope: 'all', scale: 1 })).resolves.toBeInstanceOf(Blob);
    stop();
  });
});
