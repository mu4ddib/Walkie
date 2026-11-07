import { useAssetUrl } from '../api/hooks';

/** Miniatura de la imagen de una pantalla dentro del nodo (spec imagenes-portal, criterio 1). */
export function NodeImage({ assetId }: { assetId: string }) {
  const url = useAssetUrl(assetId);
  if (url.isError) return <div className="pixel-node-image pixel-node-muted">Imagen no disponible</div>;
  if (!url.data) return <div className="pixel-node-image pixel-node-muted">Cargando imagen…</div>;
  return <img className="pixel-node-image" src={url.data} alt="Imagen de la pantalla" draggable={false} />;
}
