import { useParams } from 'react-router';
import { FeaturePage } from './FeaturePage';

/** Monta una `FeaturePage` nueva (con su propio store) por cada feature. */
export function FeatureRoute() {
  const { featureId } = useParams();
  return <FeaturePage key={featureId} />;
}
