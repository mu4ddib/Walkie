import type { DeletionImpact } from '../api/client';

/** Una línea por concepto del impacto de eliminar una feature, solo lo que existe (spec eliminar-apps-y-features). */
export function featureFacts(impact: DeletionImpact): string[] {
  const c = (key: string) => impact.counts[key] ?? 0;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const facts = [
    c('nodes') + c('edges') > 0
      ? `Su lienzo: ${plural(c('nodes'), 'caja', 'cajas')} y ${plural(c('edges'), 'conexión', 'conexiones')}.`
      : 'Su lienzo está vacío.',
  ];
  if (c('tours') + c('flows') > 0) facts.push(`${plural(c('tours'), 'tour', 'tours')} y ${plural(c('flows'), 'recorrido', 'recorridos')}.`);
  if (c('shares') > 0) facts.push(`${plural(c('shares'), 'enlace público dejará', 'enlaces públicos dejarán')} de funcionar.`);
  if (c('images') > 0) facts.push(`${plural(c('images'), 'imagen que solo usaba esta feature se borra', 'imágenes que solo usaba esta feature se borran')}.`);
  if (c('imagesShared') > 0) facts.push(`${plural(c('imagesShared'), 'imagen se conserva', 'imágenes se conservan')}: la usan otras features.`);
  if (c('mapPosition') > 0) facts.push('Sale del mapa de la app.');
  if (c('provenance') > 0)
    facts.push('Vino de Walkie Live: su vínculo se conserva y la próxima revisión dirá que ya no existe, para que decidas de nuevo.');
  facts.push('El catálogo y las demás features no cambian.');
  return facts;
}

/** Lo que contiene una app, para confirmar su eliminación. */
export function appFacts(impact: DeletionImpact): string[] {
  const c = (key: string) => impact.counts[key] ?? 0;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const facts = [
    `${plural(c('features'), 'feature', 'features')} y ${plural(c('modules'), 'módulo', 'módulos')}, con sus lienzos, tours y recorridos.`,
    `${plural(c('catalogItems'), 'elemento', 'elementos')} del catálogo y ${plural(c('images'), 'imagen', 'imágenes')}.`,
  ];
  if (c('shares') > 0) facts.push(`${plural(c('shares'), 'enlace público dejará', 'enlaces públicos dejarán')} de funcionar.`);
  if (c('members') > 1) facts.push(`${plural(c('members') - 1, 'persona más pierde', 'personas más pierden')} el acceso.`);
  if (c('snapshots') > 0)
    facts.push(`${plural(c('snapshots'), 'análisis', 'análisis')} de Walkie Live, con su evidencia y ${plural(c('decisions'), 'decisión', 'decisiones')}.`);
  return facts;
}
