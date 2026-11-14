import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { login } from '../e2e/helpers';
import { SCALES, type Scale } from './fixtures';
import { seed } from './harness';

/**
 * Cámara cuadro a cuadro: «Ver todo» (tecla 0) desde una vista acercada, y un paso de recorrido para comparar.
 * Anota cada cuadro (tiempo, transformación del viewport) y el avance de la cámara; sirve en Chromium y en WebKit
 * (`WALKIE_BROWSER=webkit pnpm perf camara`). Resultado en perf/results/camara-<navegador>-<escala>.json.
 */

const scales = (process.env.WALKIE_SCALES?.split(',') as Scale[] | undefined) ?? (Object.keys(SCALES) as Scale[]);

// Cada cambio del viewport tal como lo escribe la cámara (un MutationObserver: no se pierde ninguno aunque los cuadros
// tarden) y el tiempo de JavaScript de los callbacks de cuadro desde el cambio anterior.
const FRAMES = `
(() => {
  const p = (window.__cam = { on: false, frames: [], js: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    try { cb(t); } finally { if (p.on) p.js += performance.now() - s; }
  });
  let watched = null;
  const watch = () => {
    const vp = document.querySelector('.react-flow__viewport');
    if (vp && vp !== watched) {
      watched = vp;
      new MutationObserver(() => {
        if (!p.on) return;
        p.frames.push([Math.round(performance.now()), vp.style.transform, Math.round(p.js)]);
        p.js = 0;
      }).observe(vp, { attributes: true, attributeFilter: ['style'] });
    }
    setTimeout(watch, 200);
  };
  watch();
})();
`;

type Frame = [number, string, number?];

function parse(s: string) {
  const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(s);
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
}

/** Avance (0–1) de cada cuadro entre la primera y la última vista: centro en línea recta y zoom en escala log. */
function progress(frames: Frame[], pane: { width: number; height: number }) {
  const pts = frames.map(([t, s]) => ({ t, v: parse(s) })).filter((f) => f.v) as { t: number; v: { x: number; y: number; z: number } }[];
  const a = pts[0]!.v;
  const b = pts.at(-1)!.v;
  const c = (v: typeof a) => ({ x: (pane.width / 2 - v.x) / v.z, y: (pane.height / 2 - v.y) / v.z });
  const ca = c(a);
  const cb = c(b);
  const span = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  const zspan = Math.abs(Math.log(b.z / a.z));
  return pts.map(({ t, v }) => {
    const cv = c(v);
    const pc = span < 1 ? 1 : 1 - Math.hypot(cb.x - cv.x, cb.y - cv.y) / span;
    const pz = zspan < 0.002 ? 1 : 1 - Math.abs(Math.log(b.z / v.z)) / zspan;
    return { t: t - pts[0]!.t, p: Math.round(Math.min(pc, pz) * 100) / 100 };
  });
}

for (const scale of scales) {
  test(`cámara ${scale}`, async ({ page, browserName }) => {
    test.setTimeout(300_000);
    await page.addInitScript(FRAMES);
    await login(page);
    const { path } = await seed(page, scale, `camara-${browserName}`);
    await page.goto(path);
    await page.locator('.react-flow__node').first().waitFor();
    await page.waitForTimeout(1500);
    await page.keyboard.press('0');
    await page.waitForTimeout(800);

    const record = async (action: () => Promise<void>) => {
      await page.evaluate(() => {
        const p = (window as unknown as { __cam: { on: boolean; frames: Frame[] } }).__cam;
        const vp = document.querySelector('.react-flow__viewport') as HTMLElement;
        p.frames = [[Math.round(performance.now()), vp.style.transform, 0]];
        p.on = true;
      });
      const pressed = await page.evaluate(() => Math.round(performance.now()));
      await action();
      await page.waitForTimeout(3000);
      const { frames, pane } = await page.evaluate(() => {
        const p = (window as unknown as { __cam: { on: boolean; frames: Frame[] } }).__cam;
        p.on = false;
        const r = document.querySelector('.react-flow')!.getBoundingClientRect();
        return { frames: p.frames, pane: { width: r.width, height: r.height } };
      });
      // La vista de partida y cada cambio de la cámara hasta llegar.
      const changed = frames.length > 1 ? 1 : -1;
      const moving = frames;
      const steps = moving.length > 1 ? progress(moving, pane) : [];
      const gaps = moving.slice(2).map(([t], i) => t - moving[i + 1]![0]);
      const jumps = steps.slice(1).map((s, i) => Math.round((s.p - steps[i]!.p) * 100) / 100);
      return {
        delayToFirstChange: changed < 0 ? null : frames[changed]![0] - pressed,
        moveMs: moving.length > 1 ? moving.at(-1)![0] - moving[1]![0] : 0,
        frames: moving.length - 1,
        worstGap: Math.max(0, ...gaps),
        firstStep: jumps[0] ?? 0,
        biggestStep: Math.max(0, ...jumps),
        steps,
        gaps,
        js: moving.map((f) => f[2] ?? 0),
      };
    };

    const results: Record<string, unknown> = {};
    for (let round = 1; round <= 3; round++) {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      for (let i = 0; i < 3; i++) await page.keyboard.press('+');
      await page.waitForTimeout(1000);
      results[`ver todo ${round}`] = await record(() => page.keyboard.press('0'));
    }
    for (const [name, r] of Object.entries(results)) {
      const x = r as { js: number[]; delayToFirstChange: number; moveMs: number; frames: number; worstGap: number; firstStep: number; biggestStep: number; gaps: number[] };
      console.log(
        `${browserName} ${scale} ${name}: espera ${x.delayToFirstChange} ms · movimiento ${x.moveMs} ms en ${x.frames} cuadros · peor intervalo ${x.worstGap} ms · 1.er paso ${x.firstStep} · mayor paso ${x.biggestStep} · intervalos ${x.gaps.join(' ')} · JS por cuadro ${x.js.join(' ')}`,
      );
    }
    mkdirSync('perf/results', { recursive: true });
    writeFileSync(`perf/results/camara-${browserName}-${scale}.json`, JSON.stringify(results, null, 2));
  });
}
