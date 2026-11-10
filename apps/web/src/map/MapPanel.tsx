import type { AppMap, Feature } from '../api/client';
import { NODE_LABELS } from '../nodes/nodeMeta';
import type { NodeType } from '../store/graphStore';
import { contentsOf, linkKey, plural, type MapSelection } from './mapText';


/**
 * Panel lateral del mapa (spec mapa-de-la-app): sin selección, cómo se usa; con una feature, su resumen, de dónde llegan
 * y a dónde salen sus portales y sus componentes compartidos; con una conexión, cada portal que la forma, con «Abrir en
 * el lienzo»; con un componente, quién lo usa.
 */
export function MapPanel({
  map,
  features,
  selection,
  onSelect,
  onOpenFeature,
  onOpenPortal,
}: {
  map: AppMap;
  features: ReadonlyMap<string, Feature>;
  selection: MapSelection | null;
  onSelect: (selection: MapSelection) => void;
  onOpenFeature: (featureId: string) => void;
  onOpenPortal: (featureId: string, nodeId: string) => void;
}) {
  const name = (id: string) => features.get(id)?.name ?? 'Feature';

  if (!selection) {
    return (
      <aside className="map-panel floating" aria-label="Mapa">
        <h3>Mapa de la app</h3>
        <p className="panel-help">
          Cada caja es una feature; cada flecha, los portales que llevan de una a otra (con la caja desde la que se
          llega).
        </p>
        <p className="panel-help">
          Selecciona una feature o una flecha para ver sus conexiones. Doble clic abre el lienzo. Arrastra las cajas para
          acomodarlas: la distribución se guarda para todos.
        </p>
        {map.features.some((f) => f.unresolvedPortals > 0) && (
          <p className="tour-step-issue">Hay portales sin destino: se marcan en su feature.</p>
        )}
      </aside>
    );
  }

  if (selection.kind === 'link') {
    const link = map.links.find((l) => linkKey(l.from, l.to) === selection.id);
    if (!link) return null;
    return (
      <aside className="map-panel floating" aria-label="Conexión">
        <h3>
          {name(link.from)} → {name(link.to)}
        </h3>
        <p className="panel-help">{plural(link.portals.length, 'portal lleva', 'portales llevan')} de una a otra.</p>
        <ul className="panel-list map-portals">
          {link.portals.map((portal) => (
            <li key={portal.nodeId}>
              <span>
                Desde {portal.sources.length ? portal.sources.map((s) => `«${s}»`).join(', ') : 'el portal (sin conexión que llegue)'}
              </span>
              <button type="button" className="pixel-button" onClick={() => onOpenPortal(link.from, portal.nodeId)}>
                Abrir en el lienzo
              </button>
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  if (selection.kind === 'catalog') {
    const item = map.catalog.find((c) => c.itemId === selection.id);
    if (!item) return null;
    const meta = NODE_LABELS[item.type as NodeType];
    return (
      <aside className="map-panel floating" aria-label="Componente compartido">
        <h3>
          <span aria-hidden="true">{meta.glyph}</span> {item.title}
        </h3>
        <p className="panel-help">{meta.label} del catálogo de la app. Lo usan:</p>
        <ul className="panel-list">
          {item.features.map((id) => (
            <li key={id}>
              <button type="button" className="link-button" onClick={() => onSelect({ kind: 'feature', id })}>
                {name(id)}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  const summary = map.features.find((f) => f.id === selection.id);
  const feature = features.get(selection.id);
  if (!summary) return null;
  const incoming = map.links.filter((l) => l.to === selection.id);
  const outgoing = map.links.filter((l) => l.from === selection.id);
  const shared = map.catalog.filter((c) => c.features.length > 1 && c.features.includes(selection.id));
  const linkItem = (other: string, key: string, portals: number, text: string) => (
    <li key={key}>
      <button type="button" className="link-button" onClick={() => onSelect({ kind: 'link', id: key })}>
        {text}
      </button>{' '}
      <span className="panel-help">({plural(portals, 'portal', 'portales')})</span>
      <span className="sr-only"> {name(other)}</span>
    </li>
  );

  return (
    <aside className="map-panel floating" aria-label="Feature">
      <h3>{feature?.name ?? 'Feature'}</h3>
      {feature?.description && <p className="map-panel-description">{feature.description}</p>}
      <p className="panel-help">{contentsOf(summary)}</p>
      <button type="button" className="pixel-button is-primary" onClick={() => onOpenFeature(selection.id)}>
        Abrir lienzo
      </button>
      <section className="panel-section" aria-label="Llegan desde">
        <h4>Llegan desde</h4>
        {incoming.length === 0 ? (
          <p className="panel-help">Ninguna feature lleva aquí con un portal.</p>
        ) : (
          <ul className="panel-list">
            {incoming.map((l) => linkItem(l.from, linkKey(l.from, l.to), l.portals.length, `${name(l.from)} →`))}
          </ul>
        )}
      </section>
      <section className="panel-section" aria-label="Llevan a">
        <h4>Llevan a</h4>
        {outgoing.length === 0 ? (
          <p className="panel-help">Sin portales a otras features.</p>
        ) : (
          <ul className="panel-list">
            {outgoing.map((l) => linkItem(l.to, linkKey(l.from, l.to), l.portals.length, `→ ${name(l.to)}`))}
          </ul>
        )}
        {summary.unresolvedPortals > 0 && (
          <p className="tour-step-issue">
            {plural(summary.unresolvedPortals, 'portal sin destino', 'portales sin destino')}: elígelo en su lienzo.
          </p>
        )}
      </section>
      {shared.length > 0 && (
        <section className="panel-section" aria-label="Componentes compartidos">
          <h4>Componentes compartidos</h4>
          <ul className="panel-list">
            {shared.map((c) => (
              <li key={c.itemId}>
                <button type="button" className="link-button" onClick={() => onSelect({ kind: 'catalog', id: c.itemId })}>
                  {c.title}
                </button>{' '}
                <span className="panel-help">(con {plural(c.features.length - 1, 'feature más', 'features más')})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
