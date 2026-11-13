import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { ApiError } from '../api/client';
import { useExtractModule } from '../api/hooks';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { KIND_LABELS } from '../edges/edgeMeta';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { toGraph } from '../store/graphStore';
import { useGraphStoreApi } from '../store/useGraphStore';
import { interfaceKindLabel } from './moduleMeta';
import { planExtraction } from './extract';
import '../share/share.css';
import './modules.css';

const STEPS = ['Nombre', 'Elementos', 'Conexiones', 'Interfaces', 'Confirmar'] as const;

/**
 * «Convertir en módulo» (spec modulos-compartidos, criterios 5 a 10): cinco pasos breves —nombre y descripción, lo
 * incluido (con grupos anidados), las conexiones que cruzan el límite (cada caja de fuera se incluye o queda como
 * dependencia), las interfaces y dependencias propuestas con lo que pasa con tours y recorridos, y confirmar—. La API
 * crea el módulo y guarda la feature a la vez o no deja nada; un reintento usa los mismos ids y no duplica. Se deshace
 * con Ctrl+Z (la feature vuelve a tener lo que había).
 */
export function ExtractModuleDialog({
  roots,
  onClose,
  onDone,
}: {
  roots: readonly string[];
  onClose: () => void;
  /** La caja del módulo que quedó en el lienzo. */
  onDone: (moduleNodeId: string, moduleName: string) => void;
}) {
  const store = useGraphStoreApi();
  const { appId, featureId } = useCanvasCatalog();
  const extract = useExtractModule(appId);
  // Ids fijos mientras el diálogo esté abierto: reintentar no crea otro módulo ni otras interfaces.
  const [moduleId] = useState(() => uuidv7());
  const [moduleNodeId] = useState(() => uuidv7());
  const [graph] = useState(() => toGraph(store.getState()));
  const singleGroup = roots.length === 1 ? graph.groups?.[roots[0]!] : undefined;
  const [name, setName] = useState(singleGroup?.title ?? 'Nuevo módulo');
  const [description, setDescription] = useState('');
  const [include, setInclude] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  // Ids de interfaces y tours internos: los mismos en cada cálculo y en un reintento.
  const [ids] = useState<Record<string, string>>(() => ({}));
  const plan = useMemo(
    () => planExtraction(graph, { roots, include, names, moduleId, moduleName: name, moduleNodeId, ids, newId: uuidv7 }),
    [graph, roots, include, names, moduleId, name, moduleNodeId, ids],
  );
  const titleId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const nameError = name.trim() ? null : 'El nombre es obligatorio.';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !extract.isPending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, extract.isPending]);

  const title = (id: string) => graph.nodes[id]?.title ?? id;
  const typeLabel = (id: string) => (graph.nodes[id] ? NODE_LABELS[graph.nodes[id].type].label : '');

  async function confirm() {
    if (!featureId || nameError) return;
    // El grafo de ahora (puede haber cambiado desde que se abrió el diálogo: la versión manda).
    const current = toGraph(store.getState());
    const latest = planExtraction(current, {
      roots,
      include,
      names,
      moduleId,
      moduleName: name,
      moduleNodeId,
      ids,
      newId: uuidv7,
    });
    try {
      const result = await extract.mutateAsync({
        moduleId,
        name: name.trim(),
        description: description.trim() || undefined,
        module: latest.module,
        featureId,
        feature: latest.feature,
      });
      // Un solo paso del historial (Ctrl+Z devuelve las cajas) y queda guardado con la versión que dio la API.
      store.getState().replaceGraph(result.feature);
      store.getState().markSaved(result.feature.version, store.getState());
      onDone(moduleNodeId, result.module.name);
    } catch {
      // El error se muestra abajo; no quedó nada a medias y se puede reintentar.
    }
  }

  // Lo incluido como árbol: los grupos anidados con sus cajas (lo que no está en un grupo incluido va arriba).
  const inPlan = new Set(plan.groups);
  const groupTree = (parent: string | undefined): ReactNode => {
    const groups = plan.groups.filter((g) => {
      const p = graph.groups?.[g]?.parentId;
      return parent === undefined ? !p || !inPlan.has(p) : p === parent;
    });
    const nodes = plan.nodes.filter((n) => {
      const g = graph.nodes[n]?.groupId;
      return parent === undefined ? !g || !inPlan.has(g) : g === parent;
    });
    return (
      <ul className="extract-tree">
        {groups.map((g) => (
          <li key={g}>
            <span className="extract-group">⬚ {graph.groups![g]!.title}</span>
            {groupTree(g)}
          </li>
        ))}
        {nodes.map((n) => (
          <li key={n}>
            <span className="extract-node-type">{typeLabel(n)}</span> {title(n)}
            {include.includes(n) && <span className="extract-tag">incluida desde fuera</span>}
          </li>
        ))}
      </ul>
    );
  };

  const errorMessage = (() => {
    const e = extract.error;
    if (!e) return null;
    if (e instanceof ApiError && e.status === 409) {
      return 'El lienzo cambió mientras tanto (otro guardado). Espera a que termine de guardarse y vuelve a intentarlo: no se creó nada.';
    }
    if (e instanceof ApiError && e.status === 400) {
      const [path, messages] = Object.entries(e.problem?.errors ?? {})[0] ?? [];
      return `La API rechazó la conversión${path ? ` (${path}: ${messages?.[0]})` : ''}. No se creó nada.`;
    }
    return 'No se pudo convertir: no quedó nada a medias. Revisa la conexión y vuelve a intentarlo.';
  })();

  const canNext = step === 0 ? !nameError : true;
  return (
    <div className="share-backdrop" onClick={() => !extract.isPending && onClose()}>
      <div
        className="share-dialog extract-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Convertir en módulo</h2>
        <ol className="extract-steps" aria-label="Pasos">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined} data-done={i < step || undefined}>
              <button type="button" className="link-button" disabled={i > step && !canNext} onClick={() => setStep(i)}>
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="extract-section" aria-label="Nombre y descripción">
            <p className="panel-help">
              Lo seleccionado pasa a un lienzo propio y en su lugar queda una caja que lo referencia. Otras features podrán
              usar el mismo módulo.
            </p>
            <label htmlFor={nameId}>Nombre del módulo</label>
            <input id={nameId} autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
            {nameError && <p className="save-error">{nameError}</p>}
            <label htmlFor={descriptionId}>Descripción (opcional)</label>
            <textarea id={descriptionId} rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </section>
        )}

        {step === 1 && (
          <section className="extract-section" aria-label="Elementos incluidos">
            <p className="panel-help">
              {plan.nodes.length} {plan.nodes.length === 1 ? 'caja' : 'cajas'}, {plan.groups.length}{' '}
              {plan.groups.length === 1 ? 'grupo' : 'grupos'} (con los anidados), {plan.notes.length}{' '}
              {plan.notes.length === 1 ? 'nota' : 'notas'} y {plan.internalEdges.length}{' '}
              {plan.internalEdges.length === 1 ? 'conexión interna' : 'conexiones internas'}. Conservan sus posiciones, contratos y
              notas.
            </p>
            {plan.nodes.length === 0 ? <p className="save-error">No hay cajas en la selección.</p> : groupTree(undefined)}
          </section>
        )}

        {step === 2 && (
          <section className="extract-section" aria-label="Conexiones que cruzan el límite">
            {plan.external.length === 0 && plan.crossing.length === 0 ? (
              <p className="panel-help">Ninguna conexión cruza el límite: el módulo no necesita interfaces todavía.</p>
            ) : (
              <>
                <p className="panel-help">
                  Cada caja de fuera conectada con la selección puede entrar al módulo o quedar fuera: entonces la conexión
                  sigue, ahora hacia la caja del módulo, por una interfaz.
                </p>
                <ul className="extract-external">
                  {[...new Set([...plan.external, ...include])].map((id) => {
                    const edges = plan.crossing.filter((c) => c.outside === id);
                    const included = include.includes(id);
                    return (
                      <li key={id}>
                        <strong>
                          {title(id)} <span className="extract-node-type">{typeLabel(id)}</span>
                        </strong>
                        <span className="panel-help">
                          {included
                            ? 'Entra al módulo.'
                            : edges.map((c) => `${title(c.edge.from)} ${KIND_LABELS[c.edge.kind]} ${title(c.edge.to)}`).join(' · ')}
                        </span>
                        <div className="extract-choice" role="radiogroup" aria-label={`Qué hacer con ${title(id)}`}>
                          <label>
                            <input type="radio" name={`ext-${id}`} checked={!included} onChange={() => setInclude(include.filter((x) => x !== id))} />
                            {edges.some((c) => c.direction === 'out') ? 'Dependencia externa' : 'Queda fuera'}
                          </label>
                          <label>
                            <input type="radio" name={`ext-${id}`} checked={included} onChange={() => setInclude([...include, id])} />
                            Incluir en el módulo
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="extract-section" aria-label="Interfaces y dependencias">
            {plan.interfaces.length === 0 ? (
              <p className="panel-help">Sin conexiones que crucen, no se propone ninguna interfaz. Podrás exponerlas después.</p>
            ) : (
              <>
                <p className="panel-help">Las conexiones de fuera llegan a estas interfaces (con el contrato de su caja). Puedes renombrarlas.</p>
                <ul className="extract-interfaces">
                  {plan.interfaces.map((p) => (
                    <li key={p.key}>
                      <span className="module-iface-kind" data-kind={p.kind}>
                        {interfaceKindLabel(p.kind)}
                      </span>
                      <input
                        aria-label={`Nombre de la interfaz de ${title(p.nodeId)}`}
                        value={names[p.key] ?? p.name}
                        maxLength={60}
                        onChange={(e) => setNames({ ...names, [p.key]: e.target.value })}
                      />
                      <span className="panel-help">
                        {p.kind === 'requires' ? `${title(p.nodeId)} depende de ${title(p.dependsOn!)}` : `Caja: ${title(p.nodeId)}`} ·{' '}
                        {p.edges.length} {p.edges.length === 1 ? 'conexión' : 'conexiones'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {(plan.tourNotes.length > 0 || plan.warnings.length > 0) && (
              <div className="extract-notes">
                {plan.tourNotes.length > 0 && (
                  <>
                    <h3>Tours y recorridos</h3>
                    <ul>
                      {plan.tourNotes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </>
                )}
                {plan.warnings.length > 0 && (
                  <div role="note" className="share-warning">
                    <p>Necesita revisión:</p>
                    <ul>
                      {plan.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="extract-section" aria-label="Confirmar">
            <p>
              Se creará el módulo <strong>{name.trim()}</strong> con {plan.nodes.length}{' '}
              {plan.nodes.length === 1 ? 'caja' : 'cajas'} y {plan.interfaces.length}{' '}
              {plan.interfaces.length === 1 ? 'interfaz' : 'interfaces'}. En este lienzo, lo seleccionado se reemplaza por su caja
              y {plan.crossing.length === 1 ? 'la conexión externa sigue unida' : `las ${plan.crossing.length} conexiones externas siguen unidas`}.
            </p>
            <p className="panel-help">Se guarda al confirmar. Ctrl+Z devuelve las cajas a este lienzo (el módulo queda en el catálogo).</p>
            {errorMessage && (
              <p role="alert" className="save-error">
                {errorMessage}
              </p>
            )}
          </section>
        )}

        <div className="extract-actions">
          {step > 0 && (
            <button type="button" className="pixel-button is-ghost" disabled={extract.isPending} onClick={() => setStep(step - 1)}>
              Atrás
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="pixel-button is-primary" disabled={!canNext || plan.nodes.length === 0} onClick={() => setStep(step + 1)}>
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              className="pixel-button is-primary"
              disabled={extract.isPending || !!nameError || plan.nodes.length === 0}
              onClick={() => void confirm()}
            >
              {extract.isPending ? 'Convirtiendo…' : extract.error ? 'Reintentar' : 'Convertir en módulo'}
            </button>
          )}
          <button type="button" className="pixel-button is-ghost share-close" disabled={extract.isPending} onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
