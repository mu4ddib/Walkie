import { expect, type CDPSession, type Page } from '@playwright/test';
import { png } from '../e2e/helpers';
import { buildFixture, type Fixture, type Scale } from './fixtures';

/**
 * Banco de medición de rendimiento (no es una prueba de aciertos): instrumenta la página, siembra lienzos por la API y
 * mide escenarios. Las cifras dependen de la máquina; sirven para comparar antes y después en el mismo entorno.
 */

const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

/**
 * Instrumentación en la página: un bucle de `requestAnimationFrame` anota cada cuadro (y la transformación del
 * viewport del lienzo, para ver saltos de cámara), y dos observadores anotan tareas largas y eventos lentos
 * (Event Timing: del evento al cuadro que lo muestra).
 */
export const INSTRUMENT = `
(() => {
  const p = (window.__perf = { on: false, frames: [], long: [], events: [], boot: [] });
  const tick = (t) => {
    if (p.on) {
      const vp = document.querySelector('.react-flow__viewport');
      p.frames.push([t, vp ? vp.style.transform : '']);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    // \`boot\`: las tareas largas desde que carga la página (abrir un lienzo o navegar).
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        p.boot.push([e.startTime, e.duration]);
        if (p.on) p.long.push([e.startTime, e.duration]);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      if (p.on) for (const e of l.getEntries()) p.events.push([e.name, e.duration, e.processingEnd - e.processingStart]);
    }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  } catch {}
})();
`;

export interface Result {
  scenario: string;
  /** ms desde el comienzo hasta que la página queda quieta. */
  duration: number;
  frames: number;
  /** Intervalos entre cuadros (ms). */
  p50: number;
  p95: number;
  max: number;
  /** Cuadros que pasan de 33 ms (se nota) y de 50 ms (salto). */
  over33: number;
  over50: number;
  longTasks: number;
  longTaskMs: number;
  longTaskMax: number;
  /** Peor evento (Event Timing): del evento al cuadro que lo muestra, y su procesamiento. */
  eventMax: number;
  eventProcessingMax: number;
  /** CDP: tiempo de script, layout y estilo dentro del escenario (ms). */
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  layouts: number;
  /** Cámara: cuánto del recorrido ya está hecho en el primer cuadro que cambia (0–1) y si retrocede. */
  camera?: { firstStep: number; biggestStep: number; reverses: number; moveMs: number; stepsMoving: number };
}

/** CDP solo existe en Chromium: en WebKit (Safari) se mide con la instrumentación de la página y sin frenar la CPU. */
export async function instrument(page: Page): Promise<CDPSession | null> {
  await page.addInitScript(INSTRUMENT);
  if (page.context().browser()?.browserType().name() !== 'chromium') return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const rate = Number(process.env.WALKIE_CPU ?? '4');
  if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
}

async function metrics(cdp: CDPSession | null): Promise<Record<string, number>> {
  if (!cdp) return {};
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

const pct = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0);
const round = (n: number) => Math.round(n * 100) / 100;

function parse(transform: string): { x: number; y: number; z: number } | null {
  const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(transform);
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
}

/**
 * Recorrido de la cámara cuadro a cuadro, en progreso (0–1) del punto que se ve en el centro y del zoom (en escala
 * logarítmica): el primer paso (¿arranca con un salto?), el mayor paso de un cuadro y si alguna vez retrocede.
 */
function cameraOf(frames: [number, string][], pane: { width: number; height: number }): Result['camera'] {
  const points = frames.map(([t, s]) => ({ t, v: parse(s) })).filter((f) => f.v) as { t: number; v: { x: number; y: number; z: number } }[];
  if (points.length < 2) return undefined;
  const a = points[0]!.v;
  const b = points[points.length - 1]!.v;
  const center = (v: { x: number; y: number; z: number }) => ({ x: (pane.width / 2 - v.x) / v.z, y: (pane.height / 2 - v.y) / v.z });
  const ca = center(a);
  const cb = center(b);
  const span = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  const zspan = Math.abs(Math.log(b.z / a.z));
  if (span < 1 && zspan < 0.002) return { firstStep: 0, biggestStep: 0, reverses: 0, moveMs: 0, stepsMoving: 0 };
  const progress = (v: { x: number; y: number; z: number }) => {
    const c = center(v);
    const pc = span < 1 ? 1 : 1 - Math.hypot(cb.x - c.x, cb.y - c.y) / span;
    const pz = zspan < 0.002 ? 1 : 1 - Math.abs(Math.log(b.z / v.z)) / zspan;
    return Math.min(pc, pz);
  };
  const steps: { t: number; d: number }[] = [];
  let reverses = 0;
  let last = progress(a);
  for (let i = 1; i < points.length; i++) {
    const p = progress(points[i]!.v);
    if (Math.abs(p - last) > 0.001) steps.push({ t: points[i]!.t, d: p - last });
    if (p < last - 0.01) reverses++;
    last = p;
  }
  if (steps.length === 0) return { firstStep: 0, biggestStep: 0, reverses: 0, moveMs: 0, stepsMoving: 0 };
  return {
    firstStep: round(steps[0]!.d),
    biggestStep: round(Math.max(...steps.map((s) => Math.abs(s.d)))),
    reverses,
    moveMs: round(steps.at(-1)!.t - steps[0]!.t),
    stepsMoving: steps.length,
  };
}

/** Espera a que la página quede quieta: `ms` sin cambios del viewport ni del DOM del lienzo. */
async function settle(page: Page, ms = 500) {
  await page.evaluate(
    (quiet) =>
      new Promise<void>((resolve) => {
        let last = performance.now();
        const root = document.querySelector('.react-flow') ?? document.body;
        const obs = new MutationObserver(() => (last = performance.now()));
        obs.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
        const check = () => {
          if (performance.now() - last > quiet) {
            obs.disconnect();
            resolve();
          } else setTimeout(check, 50);
        };
        setTimeout(check, 50);
      }),
    ms,
  );
}

/** Mide `action` (el escenario) y devuelve sus métricas. */
export async function measure(
  page: Page,
  cdp: CDPSession | null,
  scenario: string,
  action: () => Promise<void>,
  opts: { camera?: boolean; quiet?: number; navigation?: boolean } = {},
): Promise<Result> {
  await settle(page, 300);
  const before = await metrics(cdp);
  await page.evaluate(() => {
    const p = (window as unknown as { __perf: { on: boolean; frames: unknown[]; long: unknown[]; events: unknown[] } }).__perf;
    p.frames = [];
    p.long = [];
    p.events = [];
    p.on = true;
  });
  const t0 = Date.now();
  await action();
  await settle(page, opts.quiet ?? 400);
  const duration = Date.now() - t0;
  const data = await page.evaluate((nav) => {
    const p = (
      window as unknown as {
        __perf: { on: boolean; frames: [number, string][]; long: [number, number][]; events: [string, number, number][]; boot: [number, number][] };
      }
    ).__perf;
    p.on = false;
    // Tras navegar, la página es otra: cuentan las tareas largas desde que cargó.
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    return { frames: p.frames, long: nav ? p.boot : p.long, events: p.events, pane: { width: pane?.width ?? 0, height: pane?.height ?? 0 } };
  }, !!opts.navigation);
  const after = await metrics(cdp);
  const gaps = data.frames.slice(1).map(([t], i) => t - data.frames[i]![0]).sort((a, b) => a - b);
  // Al navegar, CDP reinicia sus contadores: esas cifras no se comparan (quedan en 0).
  const d = (k: string) => (opts.navigation || !cdp ? 0 : (after[k]! - before[k]!) * 1000);
  return {
    scenario,
    duration,
    frames: data.frames.length,
    p50: round(pct(gaps, 0.5)),
    p95: round(pct(gaps, 0.95)),
    max: round(gaps.at(-1) ?? 0),
    over33: gaps.filter((g) => g > 33.4).length,
    over50: gaps.filter((g) => g > 50).length,
    longTasks: data.long.length,
    longTaskMs: round(data.long.reduce((s, [, dur]) => s + dur, 0)),
    longTaskMax: round(Math.max(0, ...data.long.map(([, dur]) => dur))),
    eventMax: round(Math.max(0, ...data.events.map(([, dur]) => dur))),
    eventProcessingMax: round(Math.max(0, ...data.events.map(([, , proc]) => proc))),
    scriptMs: round(d('ScriptDuration')),
    layoutMs: round(d('LayoutDuration')),
    styleMs: round(d('RecalcStyleDuration')),
    layouts: opts.navigation || !cdp ? 0 : Math.round(after.LayoutCount! - before.LayoutCount!),
    ...(opts.camera ? { camera: cameraOf(data.frames, data.pane) } : {}),
  };
}

async function token(page: Page): Promise<string> {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
    return (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
  });
}

/** Crea una app con la feature de la escala, sus imágenes y un módulo, y devuelve la ruta del lienzo. */
export async function seed(page: Page, scale: Scale, label: string): Promise<{ path: string; appId: string; featureId: string; fixture: Fixture; other: string }> {
  const auth = { Authorization: `Bearer ${await token(page)}` };
  const json = { ...auth, 'Content-Type': 'application/json' };
  const post = async (url: string, body: unknown) => {
    const r = await page.request.post(`${API}${url}`, { headers: json, data: body });
    expect(r.ok(), `${url} ${r.status()}`).toBe(true);
    return r.json();
  };
  const app = await post('/api/apps', { name: `Perf ${label} ${scale} ${Date.now()}` });
  const feature = await post(`/api/apps/${app.id}/features`, { name: `Lienzo ${scale}` });
  const other = await post(`/api/apps/${app.id}/features`, { name: 'Otra feature' });
  const assets: string[] = [];
  const count = { pequeño: 1, habitual: 6, exigente: 16 }[scale];
  for (let i = 0; i < count; i++) {
    const r = await page.request.post(`${API}/api/apps/${app.id}/assets`, {
      headers: auth,
      multipart: { file: { name: `pantalla${i}.png`, mimeType: 'image/png', buffer: png(320, 200) } },
    });
    expect(r.ok()).toBe(true);
    assets.push((await r.json()).id);
  }
  const module = await post(`/api/apps/${app.id}/modules`, { name: 'Módulo Usuarios' });
  const fixture = buildFixture(scale, assets, module.id);
  const current = await (await page.request.get(`${API}/api/features/${feature.id}/canvas`, { headers: auth })).json();
  const put = await page.request.put(`${API}/api/features/${feature.id}/canvas`, {
    headers: json,
    data: { ...fixture.graph, version: current.version },
  });
  expect(put.ok(), `PUT canvas ${put.status()} ${(await put.text()).slice(0, 600)}`).toBe(true);
  return { path: `/apps/${app.id}/features/${feature.id}`, appId: app.id, featureId: feature.id, fixture, other: `/apps/${app.id}/features/${other.id}` };
}

/** Tabla legible de resultados. */
export function table(results: Result[]): string {
  const head = 'escenario | ms | cuadros | p50 | p95 | máx | >33 | >50 | tareas largas (n/total/máx) | evento máx | script | layout | estilo | cámara (1.º paso/mayor/retrocesos/ms)';
  const rows = results.map((r) =>
    [
      r.scenario,
      r.duration,
      r.frames,
      r.p50,
      r.p95,
      r.max,
      r.over33,
      r.over50,
      `${r.longTasks}/${r.longTaskMs}/${r.longTaskMax}`,
      r.eventMax,
      r.scriptMs,
      r.layoutMs,
      r.styleMs,
      r.camera ? `${r.camera.firstStep}/${r.camera.biggestStep}/${r.camera.reverses}/${r.camera.moveMs}` : '',
    ].join(' | '),
  );
  return [head, ...rows].join('\n');
}

/** Ids de cajas (no grupos ni notas) que se ven enteras en el lienzo, fuera del inspector. */
export async function visibleBoxes(page: Page, count: number, types?: string[]): Promise<string[]> {
  return page.evaluate(([n, only]) => {
    const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .filter((el) => !el.classList.contains('react-flow__node-infraGroup') && !el.classList.contains('react-flow__node-stickyNote'))
      .filter((el) => !only || only.some((t) => el.classList.contains(`react-flow__node-${t}`)))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.left > pane.left + 80 && r.right < pane.right - 380 && r.top > pane.top + 20 && r.bottom < pane.bottom - 60;
      })
      .slice(0, n)
      .map((el) => el.dataset.id!);
  }, [count, types] as const);
}

/** Un punto del lienzo sin cajas ni paneles encima (para desplazar o deseleccionar): el primero libre de una grilla. */
export async function emptyPoint(page: Page) {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
    for (let y = pane.top + 40; y < pane.bottom - 80; y += 24) {
      for (let x = pane.left + 100; x < pane.right - 400; x += 24) {
        const el = document.elementFromPoint(x, y);
        // El cuerpo de un grupo deja pasar el puntero: debajo está el lienzo.
        if (el?.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error('No hay un punto libre en el lienzo');
  return point;
}

