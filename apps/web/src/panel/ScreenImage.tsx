import { useEffect, useState, type ChangeEvent } from 'react';
import { ApiError, ASSET_MAX_SIZE, ASSET_TYPES } from '../api/client';
import { useAssetUrl, useUploadAsset } from '../api/hooks';
import type { Node } from '../schema/walkie-graph';
import { useGraphStore } from '../store/useGraphStore';

/**
 * Imagen de una pantalla (spec imagenes-portal, criterios 1 a 4): subir con el aviso de datos reales,
 * ver en grande, reemplazar y quitar. La subida va a la API al momento; el nodo cambia por el store.
 */
export function ScreenImage({ appId, node }: { appId: string; node: Node }) {
  const upload = useUploadAsset(appId);
  const url = useAssetUrl(node.assetId);
  const updateNode = useGraphStore((s) => s.updateNode);
  const [localError, setLocalError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (!(ASSET_TYPES as readonly string[]).includes(file.type)) {
      setLocalError('Solo se aceptan imágenes PNG, JPEG o WebP.');
      return;
    }
    if (file.size > ASSET_MAX_SIZE) {
      setLocalError('La imagen no puede pesar más de 5 MB.');
      return;
    }
    setLocalError(null);
    try {
      const asset = await upload.mutateAsync(file);
      updateNode(node.id, { assetId: asset.id });
    } catch {
      // El error llega por `upload.error`.
    }
  }

  const apiError = upload.error instanceof ApiError ? upload.error.userMessage : upload.error && 'No se pudo subir.';
  const message = localError ?? apiError;

  return (
    <section className="panel-section" aria-label="Imagen">
      <h4>Imagen</h4>
      <p className="panel-warning" role="note">
        No subas capturas con datos reales de clientes.
      </p>
      {node.assetId && (
        <button type="button" className="panel-thumbnail" onClick={() => setZoomed(true)} disabled={!url.data}>
          {url.data ? <img src={url.data} alt="Imagen de la pantalla (ver en grande)" /> : 'Cargando imagen…'}
        </button>
      )}
      <label className="pixel-button panel-file">
        {node.assetId ? 'Reemplazar imagen' : 'Subir imagen'}
        <input
          type="file"
          accept={ASSET_TYPES.join(',')}
          disabled={upload.isPending}
          onChange={(e) => void onFile(e)}
        />
      </label>
      {node.assetId && (
        <button type="button" className="pixel-button" onClick={() => updateNode(node.id, { assetId: null })}>
          Quitar imagen
        </button>
      )}
      {upload.isPending && <p className="panel-help">Subiendo…</p>}
      {message && (
        <p role="alert" className="panel-error">
          {message}
        </p>
      )}
      {zoomed && url.data && <ImageDialog src={url.data} onClose={() => setZoomed(false)} />}
    </section>
  );
}

function ImageDialog({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="image-dialog" role="dialog" aria-modal="true" aria-label="Imagen de la pantalla" onClick={onClose}>
      <img src={src} alt="Imagen de la pantalla en grande" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="pixel-button" onClick={onClose} autoFocus>
        Cerrar
      </button>
    </div>
  );
}
