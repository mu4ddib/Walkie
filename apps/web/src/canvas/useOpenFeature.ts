import { useNavigate } from 'react-router';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { useGraphStoreApi } from '../store/useGraphStore';
import { canLeave } from './leaveGuard';

export { UNSAVED_CONFIRM } from './leaveGuard';

/**
 * Abre el lienzo de otra feature de la app (un `portal`, criterio 8). La navegación es interna, así que
 * `beforeunload` no salta: los cambios pendientes se resuelven aquí (`canLeave`): con autoguardado se guardan
 * antes de salir; en modo manual se confirma.
 */
export function useOpenFeature(): (featureId: string) => void {
  const navigate = useNavigate();
  const { appId } = useCanvasCatalog();
  const store = useGraphStoreApi();
  return (featureId) => {
    void canLeave(store).then((ok) => {
      if (ok) void navigate(`/apps/${appId}/features/${featureId}`);
    });
  };
}
