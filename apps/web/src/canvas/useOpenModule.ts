import { useNavigate, useSearchParams } from 'react-router';
import { useCanvasCatalog, type OpenModuleOptions } from '../catalog/catalogContext';
import { useGraphStoreApi } from '../store/useGraphStore';
import { entryQuery, moduleEntryPath, readModuleEntry, trailOf } from '../workspace/paths';
import { sharedModulePath } from '../share/sharedPath';
import { canLeave } from './leaveGuard';

/**
 * Abre el lienzo de un módulo compartido (spec modulos-compartidos, criterios 19 y 20) recordando de dónde se viene: el
 * lienzo y la caja de origen, la caja interna a enfocar, desde un recorrido el paso al que volver y, si se viene de otro
 * módulo, su entrada (el rastro para volver por cada nivel). Como un portal,
 * resuelve antes los cambios pendientes (`canLeave`).
 */
export function useOpenModule(): (moduleId: string, options?: OpenModuleOptions) => void {
  const navigate = useNavigate();
  const { appId, featureId, currentModuleId, share } = useCanvasCatalog();
  // Desde el lienzo de otro módulo, su propia entrada viaja como rastro: volver funciona en cada nivel.
  const [search] = useSearchParams();
  const store = useGraphStoreApi();
  return (moduleId, options = {}) => {
    void canLeave(store).then((ok) => {
      if (!ok) return;
      const entry = {
        // En un enlace, la feature de origen es la del enlace (`feature`); si no, la del lienzo.
        from: share ? (currentModuleId ?? 'feature') : featureId,
        node: options.nodeId,
        select: options.focus,
        play: options.play?.tourId,
        returnTour: options.play?.returnTour,
        returnStep: options.play?.returnStep,
        trail: currentModuleId ? trailOf(readModuleEntry(search)) : undefined,
      };
      void navigate(share ? sharedModulePath(share.token, moduleId) + entryQuery(entry) : moduleEntryPath(appId, moduleId, entry));
    });
  };
}
