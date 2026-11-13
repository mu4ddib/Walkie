import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { ModuleSummary } from '../api/client';
import { useApp, useCanvas } from '../api/hooks';
import { ModuleDetailsForm, ModuleUsesList } from '../modules/ModuleParts';
import { FeatureEditor } from '../canvas/FeatureEditor';
import { useEditorNavigate } from '../canvas/editorNavigation';
import { Popover } from '../workspace/Popover';
import { QueryState } from '../ui/QueryState';
import { APPS_PATH, readModuleEntry, returnPath, type ModuleEntry } from '../workspace/paths';
import { useEditorCatalog } from './editorCatalog';
import { catalogPath } from './catalogPaths';
import '../modules/modules.css';

/**
 * Lienzo de un módulo compartido (spec modulos-compartidos, criterios 19 a 21): el editor de siempre, con una franja que
 * dice qué módulo es, que su definición es compartida (y dónde se usa) y cómo volver a la feature de origen con su
 * vista, su selección y, si se venía de un recorrido, su paso.
 */
export function ModulePage() {
  const { appId = '', moduleId = '' } = useParams();
  const [search] = useSearchParams();
  const entry = readModuleEntry(search);
  const app = useApp(appId);
  const { catalog, features, modules, error } = useEditorCatalog(appId, moduleId, moduleId);
  const module = modules.data?.find((m) => m.id === moduleId);
  const canvas = useCanvas(moduleId);
  const missing = modules.data !== undefined && !module;

  if (missing || error || canvas.error) {
    return (
      <section className="workspace-problem">
        {missing ? (
          <p role="alert">Este módulo no existe en la app.</p>
        ) : (
          <QueryState isPending={false} error={error ?? canvas.error} notFound="Esta app no existe." />
        )}
        <p>
          <Link to={catalogPath(appId)}>Ver el catálogo de la app</Link> · <Link to={APPS_PATH}>Todas las apps</Link>
        </p>
      </section>
    );
  }

  if (!canvas.data || !catalog || !module) {
    return (
      <div className="workspace-loading">
        <p>Abriendo el módulo…</p>
      </div>
    );
  }

  const fromModule = entry.from ? modules.data?.find((m) => m.id === entry.from) : undefined;
  const fromName = fromModule?.name ?? features.data?.find((f) => f.id === entry.from)?.name;
  const back = returnPath(appId, entry, Boolean(fromModule));
  const backTo = back ? { path: back, name: fromName ?? 'la feature' } : null;

  return (
    <section className="feature-page module-page">
      <FeatureEditor
        featureId={moduleId}
        initialGraph={canvas.data}
        catalog={catalog}
        location={{ appId, appName: app.data?.name, featureName: `Módulo · ${module.name}` }}
        focusId={entry.select}
        focusCenter={!entry.keep}
        initialPlay={entry.play ? { tourId: entry.play, step: entry.step ?? 0 } : undefined}
        banner={<ModuleBanner appId={appId} module={module} entry={entry} back={backTo} />}
      />
    </section>
  );
}

/** Franja del módulo: volver, qué módulo es, «Definición compartida», «Ver usos» y editar nombre y descripción. */
function ModuleBanner({
  appId,
  module,
  entry,
  back,
}: {
  appId: string;
  module: ModuleSummary;
  entry: ModuleEntry;
  back: { path: string; name: string } | null;
}) {
  const onNavigate = useEditorNavigate();
  const uses = module.usedBy.length;
  // Atajo: Alt+← vuelve al lienzo de origen.
  useEffect(() => {
    if (!back) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        onNavigate(back.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, onNavigate]);

  return (
    <div className="module-banner" role="region" aria-label="Módulo compartido">
      {back && (
        <button type="button" className="pixel-button module-back" onClick={() => onNavigate(back.path)} data-tip="Alt + ←">
          ← Volver a {back.name}
        </button>
      )}
      <span className="module-banner-name">
        <span className="module-banner-kind" aria-hidden="true">
          [::] Módulo
        </span>{' '}
        <strong>{module.name}</strong>
      </span>
      <span className="module-banner-shared" title="Lo que cambies aquí se ve en todas las features que lo usan">
        Definición compartida · {uses === 0 ? 'sin usos' : uses === 1 ? 'usada en 1 lienzo' : `usada en ${uses} lienzos`}
      </span>
      <Popover label="Usos del módulo" buttonLabel={<span>Ver usos</span>} className="module-banner-uses">
        {(close) => (
          <ModuleUsesList
            moduleId={module.id}
            appId={appId}
            onOpen={(path) => {
              close();
              onNavigate(path);
            }}
          />
        )}
      </Popover>
      <Popover label="Editar el módulo" buttonLabel={<span>Editar</span>} className="module-banner-edit">
        {(close) => <ModuleDetailsForm appId={appId} module={module} onDone={close} />}
      </Popover>
      {entry.play && entry.step === undefined && <span className="module-banner-note">Reproduciendo el recorrido interno de la interfaz.</span>}
    </div>
  );
}

