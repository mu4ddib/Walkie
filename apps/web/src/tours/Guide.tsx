import { useEffect, useState, type CSSProperties } from 'react';
import { GUIDE_FRAME, GUIDE_SHEETS, type GuideAnimation } from './guideSprites';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface GuideProps {
  animation: GuideAnimation;
  /** Hacia dónde mira cuando la animación es de lado; `west` refleja la hoja (dibujada mirando al este). */
  facing?: 'east' | 'west';
  /** Escala entera para que el pixel art se vea nítido (×2 = 128 px). */
  scale?: number;
  /** Al terminar una animación que no se repite (señalar, celebrar, pensar). */
  onEnd?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Walkie, el guía de los tours: reproduce una hoja de sprites cuadro a cuadro a sus fps.
 * Con movimiento reducido no anima: muestra el cuadro final (o el primero si se repite) y avisa `onEnd` al momento.
 */
export function Guide({ animation, facing = 'east', scale = 2, onEnd, className, style }: GuideProps) {
  const sheet = GUIDE_SHEETS[animation];
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState({ animation, frame: 0 });
  // Cambiar de animación vuelve al primer cuadro (ajuste durante el render, sin efecto).
  if (state.animation !== animation) setState({ animation, frame: 0 });
  const frame = reduced ? (sheet.loop ? 0 : sheet.frames - 1) : state.animation === animation ? state.frame : 0;

  useEffect(() => {
    if (reduced) {
      if (!sheet.loop) onEnd?.();
      return;
    }
    const timer = setInterval(() => {
      setState((s) => {
        if (s.frame + 1 < sheet.frames) return { ...s, frame: s.frame + 1 };
        return sheet.loop ? { ...s, frame: 0 } : s;
      });
    }, 1000 / sheet.fps);
    return () => clearInterval(timer);
  }, [animation, reduced, sheet, onEnd]);

  // Las animaciones de una vez avisan cuando llegan al último cuadro.
  const done = !reduced && !sheet.loop && state.animation === animation && state.frame === sheet.frames - 1;
  useEffect(() => {
    if (done) onEnd?.();
  }, [done, onEnd]);

  const width = GUIDE_FRAME.width * scale;
  const height = GUIDE_FRAME.height * scale;
  const mirrored = sheet.facing === 'east' && facing === 'west';

  return (
    <div
      className={['guide', className].filter(Boolean).join(' ')}
      role="img"
      aria-label="Walkie, el guía"
      data-animation={animation}
      data-frame={frame}
      style={{
        width,
        height,
        backgroundImage: `url(${sheet.url})`,
        backgroundSize: `${width * sheet.frames}px ${height}px`,
        backgroundPosition: `${-frame * width}px 0`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        transform: mirrored ? 'scaleX(-1)' : undefined,
        ...style,
      }}
    />
  );
}
