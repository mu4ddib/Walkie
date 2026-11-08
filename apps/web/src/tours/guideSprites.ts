import manifest from '@sprites/guia/manifest.json';
import celebrate from '@sprites/guia/celebrate.png';
import idle from '@sprites/guia/idle.png';
import point from '@sprites/guia/point.png';
import talk from '@sprites/guia/talk.png';
import think from '@sprites/guia/think.png';
import walk from '@sprites/guia/walk.png';

/** Animaciones del guía (packages/sprites/guia/manifest.json). `jump` se agrega cuando exista su hoja. */
export type GuideAnimation = 'idle' | 'walk' | 'point' | 'talk' | 'celebrate' | 'think';

export interface GuideSheet {
  url: string;
  frames: number;
  fps: number;
  /** Hacia dónde mira en la hoja: `east` (de lado) o `south` (de frente). */
  facing: 'east' | 'south';
  /** `false`: se reproduce una vez y queda en el último cuadro. */
  loop: boolean;
}

const urls: Record<GuideAnimation, string> = { idle, walk, point, talk, celebrate, think };

export const GUIDE_FRAME = manifest.frame;

export const GUIDE_SHEETS = Object.fromEntries(
  (Object.keys(urls) as GuideAnimation[]).map((name) => {
    const a = manifest.animations[name];
    return [
      name,
      { url: urls[name], frames: a.frames, fps: a.fps, facing: a.facing as GuideSheet['facing'], loop: a.loop },
    ];
  }),
) as Record<GuideAnimation, GuideSheet>;
