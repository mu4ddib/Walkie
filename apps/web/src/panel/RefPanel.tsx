import { Link } from 'react-router';
import { refTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { httpLabel } from '../nodes/nodeContent';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { catalogPath } from '../pages/catalogPaths';
import type { Node } from '../schema/walkie-graph';

/**
 * Panel de un nodo `ref` (spec catalogo, criterios 8 y 10): datos del elemento en solo lectura y enlace
 * al catálogo, porque el lienzo y el catálogo se guardan por separado.
 */
export function RefPanel({ node }: { node: Node }) {
  const { appId, items } = useCanvasCatalog();
  const item = refTarget(node, items);

  if (!item) {
    return (
      <>
        <h3>
          <span aria-hidden="true">{NODE_LABELS.ref.glyph}</span> Elemento no encontrado
        </h3>
        <p className="panel-help">
          El elemento del catálogo ya no existe. Último título conocido: <strong>{node.title}</strong>. Puedes borrar
          este nodo con Supr.
        </p>
      </>
    );
  }

  const meta = NODE_LABELS[item.type];
  const http = httpLabel(item.http);
  return (
    <>
      <h3>
        <span aria-hidden="true">{meta.glyph}</span> {meta.label} del catálogo
      </h3>
      <dl className="panel-readonly">
        <dt>Título</dt>
        <dd>{item.title}</dd>
        {item.description && (
          <>
            <dt>Descripción</dt>
            <dd>{item.description}</dd>
          </>
        )}
        {http && (
          <>
            <dt>Método y ruta</dt>
            <dd>{http}</dd>
          </>
        )}
      </dl>
      <Link className="pixel-button" to={catalogPath(appId, item.id)}>
        Editar en el catálogo
      </Link>
      <p className="panel-help">Los cambios en el catálogo se ven en todos los lienzos que lo usan.</p>
    </>
  );
}
