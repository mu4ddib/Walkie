import { useDiscoveryProvenance } from '../api/hooks';
import { Popover } from '../workspace/Popover';
import { ItemProvenance } from './ItemProvenance';

/**
 * «De dónde viene» en el lienzo de un módulo o una feature creados o vinculados desde Walkie Live (tarea 9): un botón
 * que abre la procedencia (fuente, hallazgo, evidencia y enlace a la revisión). Sin Discovery o sin vínculos no se
 * muestra nada. Solo informa: no cambia el lienzo ni bloquea editarlo.
 */
export function OriginPopover({ appId, target }: { appId: string; target: string }) {
  const provenance = useDiscoveryProvenance(appId, target);
  if ((provenance.data?.bindings ?? []).length === 0) return null;
  return (
    <Popover label="De dónde viene" buttonLabel={<span>De dónde viene</span>} className="discovery-origin">
      {() => <ItemProvenance appId={appId} target={target} />}
    </Popover>
  );
}

/** La franja de una feature que viene de Walkie Live (en `FeaturePage`, como la de un módulo). */
export function FeatureOrigin({ appId, featureId }: { appId: string; featureId: string }) {
  const provenance = useDiscoveryProvenance(appId, `feature:${featureId}`);
  if ((provenance.data?.bindings ?? []).length === 0) return null;
  return (
    <div className="discovery-origin-banner" role="region" aria-label="Origen de la feature">
      <span>Creada o vinculada desde un análisis de Walkie Live.</span>
      <OriginPopover appId={appId} target={`feature:${featureId}`} />
    </div>
  );
}
