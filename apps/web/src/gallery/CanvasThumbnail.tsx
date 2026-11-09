import type { CanvasPreview } from '../api/client';
import { nodeColors } from '../theme/palette';

/** Tamaño de una caja sin `w`/`h` guardados: el mínimo del nodo en el lienzo. */
const NODE_W = 184;
const NODE_H = 72;
const PAD = 40;

interface CanvasThumbnailProps {
  preview?: CanvasPreview;
}

/**
 * Miniatura real del último lienzo guardado (spec espacio-de-trabajo, criterio 7): cada caja en su posición
 * y con el color de su tipo, y las conexiones como líneas entre centros. Sin lienzo, una arena vacía.
 */
export function CanvasThumbnail({ preview }: CanvasThumbnailProps) {
  const nodes = preview?.nodes ?? [];
  if (nodes.length === 0) {
    return (
      <div className="thumbnail is-empty" role="img" aria-label="Lienzo vacío">
        <span aria-hidden="true">Lienzo vacío</span>
      </div>
    );
  }

  const boxes = new Map(
    nodes.map((n) => [n.id, { ...n, w: n.w ?? NODE_W, h: n.h ?? NODE_H }] as const),
  );
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x)) - PAD;
  const minY = Math.min(...all.map((b) => b.y)) - PAD;
  const width = Math.max(...all.map((b) => b.x + b.w)) + PAD - minX;
  const height = Math.max(...all.map((b) => b.y + b.h)) + PAD - minY;
  const edges = (preview?.edges ?? []).flatMap((e) => {
    const from = boxes.get(e.from);
    const to = boxes.get(e.to);
    return from && to ? [{ key: `${e.from}-${e.to}`, from, to }] : [];
  });
  const label = `Vista previa: ${count(nodes.length, 'caja', 'cajas')} y ${count(edges.length, 'conexión', 'conexiones')}`;

  return (
    <svg
      className="thumbnail"
      role="img"
      aria-label={label}
      viewBox={`${minX} ${minY} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {edges.map(({ key, from, to }) => (
        <line
          key={key}
          className="thumbnail-edge"
          x1={from.x + from.w / 2}
          y1={from.y + from.h / 2}
          x2={to.x + to.w / 2}
          y2={to.y + to.h / 2}
        />
      ))}
      {all.map((b) => (
        <rect
          key={b.id}
          className="thumbnail-node"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={8}
          style={{ stroke: nodeColors[b.type as keyof typeof nodeColors] ?? nodeColors.ref }}
        />
      ))}
    </svg>
  );
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
