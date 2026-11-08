import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Guide } from './Guide';
import { GUIDE_SHEETS } from './guideSprites';

const guide = () => screen.getByRole('img', { name: 'Walkie, el guía' });
const frameMs = (name: keyof typeof GUIDE_SHEETS) => 1000 / GUIDE_SHEETS[name].fps;

function mockReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});
afterEach(() => vi.useRealTimers());

describe('Guide', () => {
  it('los sprites del manifest tienen hoja, cuadros y fps', () => {
    for (const sheet of Object.values(GUIDE_SHEETS)) {
      expect(sheet.url).toBeTruthy();
      expect(sheet.frames).toBeGreaterThan(0);
      expect(sheet.fps).toBe(6);
    }
  });

  it('avanza cuadro a cuadro a sus fps y repite si es en bucle', () => {
    render(<Guide animation="idle" />);
    expect(guide()).toHaveAttribute('data-frame', '0');
    expect(guide()).toHaveStyle({ width: '128px', height: '128px', backgroundPosition: '0px 0' });

    act(() => vi.advanceTimersByTime(frameMs('idle')));
    expect(guide()).toHaveAttribute('data-frame', '1');
    expect(guide()).toHaveStyle({ backgroundPosition: '-128px 0' });

    act(() => vi.advanceTimersByTime(frameMs('idle') * (GUIDE_SHEETS.idle.frames - 1)));
    expect(guide()).toHaveAttribute('data-frame', '0');
  });

  it('una animación de una vez se queda en el último cuadro y avisa', () => {
    const onEnd = vi.fn();
    render(<Guide animation="point" onEnd={onEnd} />);

    act(() => vi.advanceTimersByTime(frameMs('point') * (GUIDE_SHEETS.point.frames + 3)));

    expect(guide()).toHaveAttribute('data-frame', String(GUIDE_SHEETS.point.frames - 1));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('al cambiar de animación vuelve al primer cuadro', () => {
    const { rerender } = render(<Guide animation="walk" />);
    act(() => vi.advanceTimersByTime(frameMs('walk') * 2));
    expect(guide()).toHaveAttribute('data-frame', '2');

    rerender(<Guide animation="talk" />);

    expect(guide()).toHaveAttribute('data-animation', 'talk');
    expect(guide()).toHaveAttribute('data-frame', '0');
  });

  it('mirando al oeste refleja una animación de lado, no una de frente', () => {
    const { rerender } = render(<Guide animation="walk" facing="west" />);
    expect(guide()).toHaveStyle({ transform: 'scaleX(-1)' });

    rerender(<Guide animation="talk" facing="west" />);
    expect(guide().style.transform).toBe('');
  });

  it('con movimiento reducido no anima: cuadro final y aviso inmediato', () => {
    mockReducedMotion(true);
    const onEnd = vi.fn();
    render(<Guide animation="celebrate" onEnd={onEnd} />);

    expect(guide()).toHaveAttribute('data-frame', String(GUIDE_SHEETS.celebrate.frames - 1));
    expect(onEnd).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(guide()).toHaveAttribute('data-frame', String(GUIDE_SHEETS.celebrate.frames - 1));
  });
});
