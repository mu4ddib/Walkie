import { useMemo } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApp, useCatalog, useCreateCatalogItem, useCreateModule, useFeatures, useModules } from '../api/hooks';
import { toCanvasCatalog, type CanvasCatalog } from '../catalog/catalogContext';

/**
 * Lo que el editor de un lienzo (feature o módulo) necesita de la app: catálogo, features (portales) y resúmenes de los
 * módulos compartidos (spec modulos-compartidos), cada cosa con una sola consulta compartida por todas las cajas. Con mi
 * rol en la app (ADR-0015): un `viewer` abre el lienzo en solo lectura y sin crear en el catálogo.
 */
export function useEditorCatalog(appId: string, canvasId: string, currentModuleId?: string) {
  const app = useApp(appId);
  const role = app.data?.role;
  const canEdit = role === 'owner' || role === 'editor';
  const features = useFeatures(appId);
  const catalogQuery = useCatalog(appId);
  const modulesQuery = useModules(appId);
  const { mutateAsync: createItem } = useCreateCatalogItem(appId);
  const { mutateAsync: createModuleNow } = useCreateModule(appId);
  const catalog = useMemo<CanvasCatalog | undefined>(
    () =>
      catalogQuery.data && modulesQuery.data && app.data
        ? {
            ...toCanvasCatalog(appId, catalogQuery.data, features.data ?? [], canvasId),
            createItem: canEdit ? createItem : undefined,
            modules: Object.fromEntries(modulesQuery.data.map((m) => [m.id, m])),
            currentModuleId,
            // El id lo genera el cliente: si la respuesta se pierde y se reintenta, no se duplica.
            createModule: canEdit ? (module) => createModuleNow({ id: uuidv7(), ...module }) : undefined,
            readOnly: !canEdit,
          }
        : undefined,
    [appId, catalogQuery.data, modulesQuery.data, app.data, features.data, canvasId, createItem, currentModuleId, createModuleNow, canEdit],
  );
  return {
    catalog,
    features,
    modules: modulesQuery,
    isOwner: role === 'owner',
    error: app.error ?? features.error ?? catalogQuery.error ?? modulesQuery.error,
  };
}
