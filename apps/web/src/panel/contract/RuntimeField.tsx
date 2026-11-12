import { RUNTIMES, type Runtime } from '../../nodes/resourceMeta';
import { Choice } from './rows';

const OPTIONS = Object.keys(RUNTIMES) as Runtime[];

/** Dónde corre un servicio (spec nodos-de-infraestructura): contenedor, VM, serverless, gestionado u otro. */
export function RuntimeField({ value, onChange }: { value: Runtime | undefined; onChange: (runtime: Runtime | undefined) => void }) {
  return (
    <div className="contract-grid">
      <Choice label="Dónde corre" value={value} options={OPTIONS} labels={RUNTIMES} empty="—" onChange={onChange} />
    </div>
  );
}
