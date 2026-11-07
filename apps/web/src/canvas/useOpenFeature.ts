import { useNavigate } from 'react-router';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { useGraphStoreApi } from '../store/useGraphStore';

/** Texto de la confirmación al salir con cambios sin guardar (spec imagenes-portal, decisión 3). */
export const UNSAVED_CONFIRM = 'Tienes cambios sin guardar. ¿Salir igual?';

/**
 * Abre el lienzo de otra feature de la app (un `portal`, criterio 8). La navegación es interna, así que
 * `beforeunload` no salta: si hay cambios sin guardar se confirma aquí y no se guarda solo.
 */
export function useOpenFeature(): (featureId: string) => void {
  const navigate = useNavigate();
  const { appId } = useCanvasCatalog();
  const store = useGraphStoreApi();
  return (featureId) => {
    if (store.getState().dirty && !window.confirm(UNSAVED_CONFIRM)) return;
    void navigate(`/apps/${appId}/features/${featureId}`);
  };
}
