import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { v7 as uuidv7 } from 'uuid';
import { ApiError, type ModuleSummary } from '../api/client';
import { useCreateModule, useDeleteModule, useModules } from '../api/hooks';
import { QueryState } from '../ui/QueryState';
import { modulePath } from '../workspace/paths';
import { interfaceKindLabel, interfaceSignature } from './moduleMeta';
import './modules.css';

/**
 * «Módulos» en la página del catálogo (spec modulos-compartidos, criterio 2): cada módulo con su descripción,
 * interfaces y usos, «Abrir», «Nuevo módulo» (uno vacío, que se abre) y «Eliminar», que antes dice dónde se usa.
 */
export function ModulesSection({ appId }: { appId: string }) {
  const modules = useModules(appId);
  return (
    <section className="catalog-group catalog-modules" aria-label="Módulos">
      <h3>Módulos</h3>
      <p className="panel-help">
        Conjuntos de componentes conectados con lienzo propio. Las features los usan con una caja que se conecta por sus
        interfaces; si cambias el módulo, cambia en todas.
      </p>
      <NewModuleForm appId={appId} />
      <QueryState isPending={modules.isPending} error={modules.error} notFound="Esta app no existe." />
      {modules.data?.length === 0 && (
        <p className="panel-help">
          Aún no hay módulos. Crea uno vacío o, en un lienzo, selecciona cajas (o un grupo) y elige «Convertir en módulo».
        </p>
      )}
      <ul className="catalog-module-list">
        {[...(modules.data ?? [])]
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
          .map((m) => (
            <ModuleRow key={m.id} appId={appId} module={m} />
          ))}
      </ul>
    </section>
  );
}

function ModuleRow({ appId, module }: { appId: string; module: ModuleSummary }) {
  const remove = useDeleteModule(appId);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    const uses = module.usedBy.length;
    const message =
      uses === 0
        ? `¿Eliminar el módulo «${module.name}»? Su lienzo se borra.`
        : `«${module.name}» se usa en ${uses === 1 ? '1 lienzo' : `${uses} lienzos`}. Si lo eliminas, sus cajas quedan como referencias pendientes (con su último nombre) hasta reasignarlas. ¿Eliminar igual?`;
    if (!window.confirm(message)) return;
    setError(null);
    try {
      await remove.mutateAsync({ moduleId: module.id, force: uses > 0 });
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo eliminar el módulo.');
    }
  }

  return (
    <li className="catalog-module">
      <div className="catalog-module-head">
        <Link to={modulePath(appId, module.id)}>
          <strong>{module.name}</strong>
        </Link>
        <span className="panel-help">
          {module.interfaces.length} {module.interfaces.length === 1 ? 'interfaz' : 'interfaces'} ·{' '}
          {module.usedBy.length === 0 ? 'sin usos' : `usado en ${module.usedBy.length}`}
        </span>
      </div>
      {module.description && <p className="catalog-module-description">{module.description}</p>}
      {module.interfaces.length > 0 && (
        <ul className="module-iface-list">
          {module.interfaces.map((i) => (
            <li key={i.id}>
              <span className="module-iface-kind" data-kind={i.kind}>
                {interfaceKindLabel(i.kind)}
              </span>
              <span>{i.name}</span>
              <code className="module-node-iface-sig">{interfaceSignature(i)}</code>
            </li>
          ))}
        </ul>
      )}
      <div className="panel-actions">
        <Link className="pixel-button" to={modulePath(appId, module.id)}>
          Abrir
        </Link>
        <button type="button" className="pixel-button is-ghost" disabled={remove.isPending} onClick={() => void onDelete()}>
          Eliminar
        </button>
      </div>
      {error && (
        <p role="alert" className="save-error">
          {error}
        </p>
      )}
    </li>
  );
}

function NewModuleForm({ appId }: { appId: string }) {
  const create = useCreateModule(appId);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setError(null);
    try {
      const created = await create.mutateAsync({ id: uuidv7(), name: name.trim(), description: description.trim() || undefined });
      void navigate(modulePath(appId, created.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo crear el módulo.');
    }
  }

  return (
    <form className="catalog-form" aria-label="Nuevo módulo" onSubmit={(e) => void submit(e)}>
      <label>
        Nombre del módulo
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ej. Usuarios" />
      </label>
      <label>
        Descripción
        <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" />
      </label>
      <button type="submit" className="pixel-button" disabled={create.isPending}>
        Nuevo módulo
      </button>
      {error && (
        <p role="alert" className="save-error">
          {error}
        </p>
      )}
    </form>
  );
}
