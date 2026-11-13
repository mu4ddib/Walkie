import { useNavigate } from 'react-router';
import { useCanvasCatalog, type OpenModuleOptions } from '../catalog/catalogContext';
import { useGraphStoreApi } from '../store/useGraphStore';
import { moduleEntryPath } from '../workspace/paths';
import { canLeave } from './leaveGuard';

/**
 * Abre el lienzo de un módulo compartido (spec modulos-compartidos, criterios 19 y 20) recordando de dónde se viene: el
 * lienzo y la caja de origen, la caja interna a enfocar y, desde un recorrido, el paso al que volver. Como un portal,
 * resuelve antes los cambios pendientes (`canLeave`).
 */
export function useOpenModule(): (moduleId: string, options?: OpenModuleOptions) => void {
  const navigate = useNavigate();
  const { appId, featureId } = useCanvasCatalog();
  const store = useGraphStoreApi();
  return (moduleId, options = {}) => {
    void canLeave(store).then((ok) => {
      if (!ok) return;
      void navigate(
        moduleEntryPath(appId, moduleId, {
          from: featureId,
          node: options.nodeId,
          select: options.focus,
          play: options.play?.tourId,
          returnTour: options.play?.returnTour,
          returnStep: options.play?.returnStep,
        }),
      );
    });
  };
}
