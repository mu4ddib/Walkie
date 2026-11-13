import { useMemo } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useCatalog, useCreateCatalogItem, useCreateModule, useFeatures, useModules } from '../api/hooks';
import { toCanvasCatalog, type CanvasCatalog } from '../catalog/catalogContext';

/**
 * Lo que el editor de un lienzo (feature o módulo) necesita de la app: catálogo, features (portales) y resúmenes de los
 * módulos compartidos (spec modulos-compartidos), cada cosa con una sola consulta compartida por todas las cajas.
 */
export function useEditorCatalog(appId: string, canvasId: string, currentModuleId?: string) {
  const features = useFeatures(appId);
  const catalogQuery = useCatalog(appId);
  const modulesQuery = useModules(appId);
  const { mutateAsync: createItem } = useCreateCatalogItem(appId);
  const { mutateAsync: createModuleNow } = useCreateModule(appId);
  const catalog = useMemo<CanvasCatalog | undefined>(
    () =>
      catalogQuery.data && modulesQuery.data
        ? {
            ...toCanvasCatalog(appId, catalogQuery.data, features.data ?? [], canvasId),
            createItem,
            modules: Object.fromEntries(modulesQuery.data.map((m) => [m.id, m])),
            currentModuleId,
            // El id lo genera el cliente: si la respuesta se pierde y se reintenta, no se duplica.
            createModule: (module) => createModuleNow({ id: uuidv7(), ...module }),
          }
        : undefined,
    [appId, catalogQuery.data, modulesQuery.data, features.data, canvasId, createItem, currentModuleId, createModuleNow],
  );
  return { catalog, features, modules: modulesQuery, error: features.error ?? catalogQuery.error ?? modulesQuery.error };
}
