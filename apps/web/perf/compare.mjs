// Compara dos corridas del banco (perf/results/<antes>-<escala>.json y <después>-<escala>.json) en una tabla Markdown.
// Uso: node perf/compare.mjs <etiqueta-antes> <etiqueta-después> [escalas separadas por coma]
import { existsSync, readFileSync } from 'node:fs';

const [before, after, only] = process.argv.slice(2);
if (!before || !after) {
  console.error('Uso: node perf/compare.mjs <antes> <después> [escalas]');
  process.exit(1);
}
const scales = (only ?? 'pequeño,habitual,exigente').split(',');
const load = (label, scale) => {
  const file = `perf/results/${label}-${scale}.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const ms = (n) => (n === undefined ? '—' : `${Math.round(n)}`);

for (const scale of scales) {
  const a = load(before, scale);
  const b = load(after, scale);
  if (!a || !b) continue;
  const c = b.counts;
  console.log(
    `\n### ${scale} — ${c.nodes} nodos, ${c.edges} conexiones, ${c.groups} grupos, ${c.images} imágenes, ${c.modules} cajas de módulo, ${c.tourSteps} pasos (CPU ×${b.cpuThrottle})\n`,
  );
  console.log('| Escenario | Peor cuadro (ms) | Cuadros >50 ms | Tareas largas: n / total (ms) | Peor evento (ms) | Script (ms) |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const r of b.results) {
    const o = a.results.find((x) => x.scenario === r.scenario);
    const pair = (f) => (o ? `${f(o)} → ${f(r)}` : `— → ${f(r)}`);
    const cam = r.camera && o?.camera ? ` · mayor paso de cámara ${o.camera.biggestStep} → ${r.camera.biggestStep}` : '';
    console.log(
      `| ${r.scenario}${cam} | ${pair((x) => ms(x.max))} | ${pair((x) => x.over50)} | ${pair((x) => `${x.longTasks} / ${ms(x.longTaskMs)}`)} | ${pair((x) => ms(x.eventMax))} | ${pair((x) => (x.scriptMs ? ms(x.scriptMs) : '—'))} |`,
    );
  }
}
