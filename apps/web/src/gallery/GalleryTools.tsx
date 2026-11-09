import { useId } from 'react';
import type { FeatureSort } from './search';

/** Buscar y, si se pasa `sort`, ordenar (galerías de apps y de features). */
export function GalleryTools({
  label,
  query,
  onQuery,
  sort,
  onSort,
}: {
  label: string;
  query: string;
  onQuery: (q: string) => void;
  sort?: FeatureSort;
  onSort?: (sort: FeatureSort) => void;
}) {
  const searchId = useId();
  const sortId = useId();
  return (
    <div className="gallery-tools">
      <label className="sr-only" htmlFor={searchId}>
        {label}
      </label>
      <input id={searchId} type="search" placeholder={`${label}…`} value={query} onChange={(e) => onQuery(e.target.value)} />
      {sort && onSort && (
        <span className="gallery-sort">
          <label htmlFor={sortId}>Ordenar</label>
          <select id={sortId} value={sort} onChange={(e) => onSort(e.target.value as FeatureSort)}>
            <option value="recent">Recientes primero</option>
            <option value="name">Nombre (A–Z)</option>
          </select>
        </span>
      )}
    </div>
  );
}
