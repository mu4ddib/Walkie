import { useParams } from 'react-router';
import { ModulePage } from './ModulePage';

/** Monta una `ModulePage` nueva (con su propio store) por cada módulo. */
export function ModuleRoute() {
  const { moduleId } = useParams();
  return <ModulePage key={moduleId} />;
}
