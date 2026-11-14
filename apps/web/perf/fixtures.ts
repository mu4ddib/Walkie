/**
 * Lienzos de prueba reproducibles para medir rendimiento (datos ficticios). Tres escalas con la misma forma: cada
 * «flujo» es Pantalla → API → Servicio → BD con sus retornos (dos respuestas HTTP, resultado y vacío: varias
 * conexiones entre las mismas cajas), su grupo de backend, un dominio que anida varios backends y una nube que los
 * contiene a todos; algunos flujos suman una decisión, un tópico y una nota. Hay pantallas con imagen, varias cajas del
 * mismo módulo y recorridos de 30 pasos o más.
 */

export type Scale = 'pequeño' | 'habitual' | 'exigente';

export const SCALES: Record<Scale, { flows: number; images: number; modules: number; tourSteps: number; collapsed: number }> = {
  pequeño: { flows: 4, images: 1, modules: 1, tourSteps: 30, collapsed: 0 },
  habitual: { flows: 16, images: 6, modules: 3, tourSteps: 40, collapsed: 2 },
  exigente: { flows: 48, images: 16, modules: 6, tourSteps: 80, collapsed: 4 },
};

const COLS = 4;
const FLOW_W = 1300;
const FLOW_H = 560;

type Json = Record<string, unknown>;

export interface Fixture {
  graph: Json & { nodes: Record<string, Json>; edges: Record<string, Json>; groups: Record<string, Json> };
  counts: { nodes: number; edges: number; groups: number; images: number; modules: number; notes: number; tourSteps: number };
  /** Ids útiles para los escenarios. */
  ids: { firstScreen: string; firstApi: string; firstGroup: string; outerGroup: string; firstQuery: string; tour: string };
}

/** Grafo de la escala pedida. `assetIds` son imágenes ya subidas; `moduleId`, un módulo de la misma app. */
export function buildFixture(scale: Scale, assetIds: string[], moduleId: string | null): Fixture {
  const cfg = SCALES[scale];
  const nodes: Record<string, Json> = {};
  const edges: Record<string, Json> = {};
  const layout: Record<string, Json> = {};
  const groups: Record<string, Json> = {};
  const stickyNotes: Record<string, Json> = {};
  let e = 0;
  const edge = (from: string, to: string, kind: string, extra: Json = {}) => {
    const id = `e${++e}`;
    edges[id] = { id, from, to, kind, ...extra };
    return id;
  };
  const node = (id: string, type: string, title: string, x: number, y: number, extra: Json = {}) => {
    nodes[id] = { id, type, title, ...extra };
    layout[id] = { x, y };
  };

  const domains = Math.ceil(cfg.flows / COLS);
  const cloudH = domains * FLOW_H + 80;
  groups.cloud = { id: 'cloud', title: 'Nube', kind: 'cloud' };
  layout.cloud = { x: 220, y: -40, w: COLS * FLOW_W - 280, h: cloudH };
  for (let d = 0; d < domains; d++) {
    const id = `dom${d}`;
    groups[id] = { id, title: `Dominio ${d + 1}`, kind: 'backend', parentId: 'cloud' };
    layout[id] = { x: 240, y: d * FLOW_H - 16, w: COLS * FLOW_W - 320, h: FLOW_H - 40 };
  }

  const tourEdges: string[] = [];
  let firstQuery = '';
  for (let i = 0; i < cfg.flows; i++) {
    const x = (i % COLS) * FLOW_W;
    const y = Math.floor(i / COLS) * FLOW_H;
    const dom = `dom${Math.floor(i / COLS)}`;
    const g = `g${i}`;
    groups[g] = {
      id: g,
      title: `Backend ${i + 1}`,
      kind: 'backend',
      parentId: dom,
      ...(i < cfg.collapsed ? { collapsed: true } : {}),
    };
    layout[g] = { x: x + 280, y: y + 20, w: 960, h: 300 };

    const s = `s${i}`;
    const a = `a${i}`;
    const v = `v${i}`;
    const db = `d${i}`;
    node(s, 'screen', `Pantalla ${i + 1}`, x, y + 80, {
      description: 'Formulario del cliente con sus datos de contacto.',
      ...(i < assetIds.length ? { assetId: assetIds[i] } : {}),
      inputs: [
        { name: 'documento', type: 'string', required: true },
        { name: 'correo', type: 'string' },
      ],
    });
    node(a, 'api', `API ${i + 1}`, x + 320, y + 80, {
      groupId: g,
      http: { method: 'POST', path: `/recurso${i}`, responses: [{ status: 200 }, { status: 400 }] },
    });
    node(v, 'service', `Servicio ${i + 1}`, x + 640, y + 80, { groupId: g });
    node(db, 'database', `BD ${i + 1}`, x + 960, y + 80, {
      groupId: g,
      database: { engine: 'PostgreSQL', tables: [{ name: `tabla${i}`, fields: [{ name: 'id', type: 'uuid', key: 'primary' }] }] },
    });

    const call = edge(s, a, 'request', { operation: 'http.request' });
    const ok = edge(a, s, 'response', { replyTo: call, status: 200 });
    edge(a, s, 'response', { replyTo: call, status: 400, label: 'Datos inválidos' });
    const inv = edge(a, v, 'request', { operation: 'service.invoke' });
    const back = edge(v, a, 'response', { replyTo: inv, result: { type: 'success' } });
    const q = edge(v, db, 'request', {
      operation: 'db.query',
      exchange: { command: { language: 'sql', text: `SELECT * FROM tabla${i} WHERE id = :id` }, params: [{ name: 'id' }], timeoutMs: 3000 },
    });
    const rows = edge(db, v, 'response', { replyTo: q, result: { type: 'success' } });
    edge(db, v, 'response', { replyTo: q, result: { type: 'empty' } });
    if (!firstQuery) firstQuery = q;
    tourEdges.push(call, inv, q, rows, back, ok);

    if (i % 3 === 0) {
      const r = `r${i}`;
      node(r, 'rule', `¿Cliente válido ${i + 1}?`, x, y + 300, {
        mode: 'decision',
        branches: [
          { id: 'si', label: 'Sí' },
          { id: 'no', label: 'No' },
        ],
      });
      edge(s, r, 'uses');
      edge(r, a, 'uses', { branch: 'si' });
    }
    if (i % 4 === 1) {
      const t = `t${i}`;
      node(t, 'resource', `eventos.${i}`, x + 640, y + 380, { resource: { kind: 'topic' } });
      edge(v, t, 'event', { operation: 'message.publish' });
    }
    if (i % 5 === 2) {
      const n = `n${i}`;
      stickyNotes[n] = { id: n, text: `Revisar límites del flujo ${i + 1}.` };
      layout[n] = { x: x + 40, y: y + 420 };
    }
  }

  // Varias cajas del mismo módulo, conectadas a APIs distintas.
  if (moduleId) {
    for (let m = 0; m < cfg.modules; m++) {
      const id = `m${m}`;
      const row = Math.floor((m * cfg.flows) / Math.max(cfg.modules, 1) / COLS);
      node(id, 'module', 'Módulo Usuarios', COLS * FLOW_W - 40, row * FLOW_H + 120, { moduleId });
      layout[id] = { ...layout[id], w: 240 };
      edge(`a${Math.min(m * Math.floor(cfg.flows / cfg.modules), cfg.flows - 1)}`, id, 'request', { operation: 'service.invoke' });
    }
  }

  const steps = Array.from({ length: cfg.tourSteps }, (_, k) => ({ id: `p${k}`, edgeId: tourEdges[k % tourEdges.length] }));
  const tours = { f: { id: 'f', name: 'Recorrido largo', kind: 'flow', steps } };

  const graph = { schemaVersion: 0, version: 0, nodes, edges, layout, groups, stickyNotes, tours };
  return {
    graph,
    counts: {
      nodes: Object.keys(nodes).length,
      edges: Object.keys(edges).length,
      groups: Object.keys(groups).length,
      images: Math.min(assetIds.length, cfg.flows),
      modules: moduleId ? cfg.modules : 0,
      notes: Object.keys(stickyNotes).length,
      tourSteps: cfg.tourSteps,
    },
    ids: { firstScreen: 's0', firstApi: 'a0', firstGroup: `g${cfg.collapsed}`, outerGroup: 'dom0', firstQuery, tour: 'f' },
  };
}
