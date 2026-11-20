import type { ArchitectureGroup, ArchitectureLimitation, DiscoveryArchitecture } from '../../api/client';
import { useDiscoveryArchitectureGroup, useDiscoveryEvidence, useDiscoveryRelationEvidence } from '../../api/hooks';
import type { ArchitectureSelection } from './ArchitectureCanvas';
import { ENTITY_LABELS, GROUP_KIND_LABELS, RELATION_LABELS, SEMANTIC_HELP, SEMANTIC_LABELS, count, shortKey, type Semantic } from './architectureModel';

type Evidence = { id: string; detector: string; path: string; lines?: { start: number }; note?: string; symbol?: string; confidence: string };

/** Una evidencia: archivo y línea, detector y por qué. Todo es texto del paquete: se muestra como texto. */
function EvidenceList({ items }: { items: readonly Evidence[] }) {
  if (items.length === 0) return <p className="panel-help">Sin evidencia registrada.</p>;
  return (
    <ol className="arch-evidence">
      {items.map((e) => (
        <li key={e.id}>
          <code>
            {e.path}
            {e.lines ? `:${e.lines.start}` : ''}
          </code>
          <span className="arch-evidence-note">{e.note ?? e.symbol ?? ''}</span>
          <span className="arch-evidence-meta">
            {e.detector} · confianza {e.confidence === 'high' ? 'alta' : e.confidence === 'medium' ? 'media' : 'baja'}
          </span>
        </li>
      ))}
    </ol>
  );
}

const basisText = (basis: string, confidence: string) =>
  `${basis === 'observed' ? 'Observada' : 'Inferida'} · confianza ${confidence === 'high' ? 'alta' : confidence === 'medium' ? 'media' : 'baja'}`;

function Limitations({ items }: { items: readonly ArchitectureLimitation[] }) {
  if (items.length === 0) return null;
  return (
    <section className="arch-section" aria-label="Sin resolver">
      <h4>Sin resolver ({items.length})</h4>
      <ul className="arch-limitations">
        {items.slice(0, 30).map((l, i) => (
          <li key={`${l.code}-${l.path ?? ''}-${i}`} className={l.incomplete ? 'is-incomplete' : undefined}>
            <code>{l.code}</code> {l.path && <code className="arch-path">{l.path}</code>}
            <span>{l.message}</span>
          </li>
        ))}
      </ul>
      {items.length > 30 && <p className="panel-help">Y {items.length - 30} más.</p>}
    </section>
  );
}

/**
 * Lo elegido en la vista de arquitectura (spec walkie-live-arquitectura): un grupo con su contenido y lo que quedó sin
 * resolver; un vínculo entre grupos con sus relaciones; un hallazgo o una relación con su evidencia (bajo demanda; para
 * una relación inferida, la cadena entera).
 */
export function ArchitectureInspector({
  snapshotId,
  architecture,
  selection,
  onSelect,
  onOpen,
}: {
  snapshotId: string;
  architecture: DiscoveryArchitecture;
  selection: ArchitectureSelection | null;
  onSelect: (selection: ArchitectureSelection) => void;
  onOpen: (groupKey: string) => void;
}) {
  const groups = new Map(architecture.groups.map((g) => [g.key, g]));
  const linkGroup = selection?.kind === 'link' ? selection.link.from : null;
  const detail = useDiscoveryArchitectureGroup(snapshotId, linkGroup, 0, 500);
  const entity = useDiscoveryEvidence(snapshotId, selection?.kind === 'entity' ? selection.key : null);
  const relation = useDiscoveryRelationEvidence(snapshotId, selection?.kind === 'relation' ? selection.key : null);

  if (!selection) {
    return (
      <aside className="arch-inspector" aria-label="Detalle de la arquitectura">
        <h3>Cómo leer esta vista</h3>
        <p className="panel-help">
          Es lo que el análisis descubrió, no lo confirmado en Walkie. Elige un grupo para ver qué tiene; doble clic lo abre. Elige una
          flecha para ver sus relaciones y su evidencia.
        </p>
        <dl className="arch-legend">
          {(Object.keys(SEMANTIC_LABELS) as Semantic[]).map((s) => (
            <div key={s}>
              <dt>
                <span className={`arch-swatch is-${s}`} aria-hidden="true" /> {SEMANTIC_LABELS[s]}
              </dt>
              <dd>{SEMANTIC_HELP[s]}</dd>
            </div>
          ))}
          <div>
            <dt>
              <span className="arch-swatch is-execution is-inferred" aria-hidden="true" /> Inferida
            </dt>
            <dd>Deducida de varias pistas (por un hook, un servicio o un componente): más clara que la observada.</dd>
          </div>
        </dl>
        <Limitations items={architecture.limitations.filter((l) => !l.group)} />
      </aside>
    );
  }

  if (selection.kind === 'group') {
    const group: ArchitectureGroup | undefined = groups.get(selection.key);
    if (!group) return <aside className="arch-inspector" aria-label="Detalle de la arquitectura" />;
    const kinds = (Object.keys(group.counts) as (keyof typeof ENTITY_LABELS)[]).filter((k) => group.counts[k]);
    return (
      <aside className="arch-inspector" aria-label="Detalle de la arquitectura">
        <p className="arch-kicker">{GROUP_KIND_LABELS[group.kind]}</p>
        <h3>{group.title}</h3>
        <p>{kinds.map((k) => count(group.counts[k]!, k)).join(' · ')}</p>
        {Object.keys(group.internal).length > 0 && (
          <p className="panel-help">
            Dentro: {Object.entries(group.internal).map(([s, n]) => `${n} de ${SEMANTIC_LABELS[s as Semantic].toLowerCase()}`).join(', ')}.
          </p>
        )}
        <button type="button" className="pixel-button" onClick={() => onOpen(group.key)}>
          Abrir grupo
        </button>
        <Limitations items={architecture.limitations.filter((l) => l.group === group.key)} />
      </aside>
    );
  }

  if (selection.kind === 'link') {
    const { link } = selection;
    const siblings = architecture.links.filter((l) => l.from === link.from && l.to === link.to && l.kind !== link.kind);
    const relations = (detail.data?.relations ?? []).filter((r) => {
      if (r.kind !== link.kind) return false;
      const other = detail.data?.neighbors.find((n) => n.key === r.to || n.key === r.from);
      return other?.group === link.to;
    });
    return (
      <aside className="arch-inspector" aria-label="Detalle de la arquitectura">
        <p className="arch-kicker">{SEMANTIC_LABELS[link.semantic]}</p>
        <h3>
          {groups.get(link.from)?.title} {RELATION_LABELS[link.kind]} {groups.get(link.to)?.title}
        </h3>
        {siblings.length > 0 && (
          <p className="panel-help">
            Entre los mismos grupos también:{' '}
            {siblings.map((l, i) => (
              <span key={l.kind}>
                {i > 0 && ', '}
                <button type="button" className="link-button" onClick={() => onSelect({ kind: 'link', link: l })}>
                  {RELATION_LABELS[l.kind] ?? l.kind} ×{l.total}
                </button>
              </span>
            ))}
          </p>
        )}
        <p>
          {link.total} {link.total === 1 ? 'relación' : 'relaciones'}: {link.observed} observadas, {link.inferred} inferidas
          {link.low > 0 ? ` (${link.low} de confianza baja)` : ''}.
        </p>
        {detail.isPending && <p role="status">Cargando las relaciones…</p>}
        {relations.length > 0 && (
          <ul className="arch-relations" aria-label="Relaciones">
            {relations.slice(0, 50).map((r) => (
              <li key={r.key}>
                <button type="button" className="link-button" onClick={() => onSelect({ kind: 'relation', key: r.key, from: r.from, to: r.to, relation: r.kind })}>
                  {shortKey(r.from)} → {shortKey(r.to)}
                </button>
                <span className="arch-evidence-meta">{basisText(r.basis, r.confidence)}</span>
              </li>
            ))}
          </ul>
        )}
        {relations.length > 50 && <p className="panel-help">Y {relations.length - 50} más: abre el grupo para verlas todas.</p>}
      </aside>
    );
  }

  if (selection.kind === 'relation') {
    return (
      <aside className="arch-inspector" aria-label="Detalle de la arquitectura">
        <p className="arch-kicker">Relación</p>
        <h3>
          {shortKey(selection.from)} {RELATION_LABELS[selection.relation]} {shortKey(selection.to)}
        </h3>
        {relation.data && (
          <>
            <p>{basisText(relation.data.relation.basis, relation.data.relation.confidence)}</p>
            <h4>Por qué ({relation.data.evidence.length === 1 ? '1 paso' : `${relation.data.evidence.length} pasos`})</h4>
            <EvidenceList items={relation.data.evidence as Evidence[]} />
          </>
        )}
        {relation.isPending && <p role="status">Cargando la evidencia…</p>}
        {relation.isError && <p role="alert">No se pudo cargar la evidencia de esta relación.</p>}
      </aside>
    );
  }

  return (
    <aside className="arch-inspector" aria-label="Detalle de la arquitectura">
      <p className="arch-kicker">Hallazgo</p>
      <h3>{selection.title ?? shortKey(selection.key)}</h3>
      {entity.isPending && <p role="status">Cargando la evidencia…</p>}
      {entity.isError && <p role="alert">No se pudo cargar la evidencia de este hallazgo.</p>}
      {entity.data && (
        <>
          <h4>Evidencia</h4>
          <EvidenceList items={entity.data.evidence as Evidence[]} />
          {entity.data.relations.length > 0 && (
            <>
              <h4>Relaciones ({entity.data.relations.length})</h4>
              <ul className="arch-relations">
                {entity.data.relations.slice(0, 50).map((r) => (
                  <li key={r.key}>
                    <button type="button" className="link-button" onClick={() => onSelect({ kind: 'relation', key: r.key, from: r.from, to: r.to, relation: r.kind })}>
                      {r.from === selection.key ? `${RELATION_LABELS[r.kind]} ${shortKey(r.to)}` : `${shortKey(r.from)} ${RELATION_LABELS[r.kind]} esta`}
                    </button>
                    <span className="arch-evidence-meta">{basisText(r.basis, r.confidence)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </aside>
  );
}
