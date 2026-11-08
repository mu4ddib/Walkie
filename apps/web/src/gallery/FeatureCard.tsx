import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, type CanvasPreview, type Feature, type FeatureChanges } from '../api/client';
import { featurePath } from '../workspace/paths';
import { CanvasThumbnail } from './CanvasThumbnail';
import { latest, shortDate } from './dates';

interface FeatureCardProps {
  feature: Feature;
  preview?: CanvasPreview;
  onSave: (changes: FeatureChanges) => Promise<unknown>;
}

/**
 * Tarjeta de una feature en la galería (spec espacio-de-trabajo, criterios 7 y 8): miniatura del lienzo,
 * nombre, descripción y fecha de actualización; "Editar" la renombra sin salir de la galería.
 */
export function FeatureCard({ feature, preview, onSave }: FeatureCardProps) {
  const [editing, setEditing] = useState(false);
  const updated = latest(feature.updatedAt, preview?.updatedAt);

  return (
    <li className="feature-card">
      <CanvasThumbnail preview={preview} />
      {editing ? (
        <FeatureForm feature={feature} onSave={onSave} onDone={() => setEditing(false)} />
      ) : (
        <div className="feature-card-body">
          <h3 className="feature-card-title">
            <Link to={featurePath(feature.appId, feature.id)}>{feature.name}</Link>
          </h3>
          {feature.description ? (
            <p className="feature-card-description">{feature.description}</p>
          ) : (
            <p className="feature-card-description is-empty">Sin descripción</p>
          )}
          <footer className="feature-card-meta">
            <span>
              Actualizada el <time dateTime={updated}>{shortDate(updated)}</time>
            </span>
            <button
              type="button"
              className="pixel-button is-ghost feature-card-edit"
              aria-label={`Editar ${feature.name}`}
              onClick={() => setEditing(true)}
            >
              Editar
            </button>
          </footer>
        </div>
      )}
    </li>
  );
}

function FeatureForm({
  feature,
  onSave,
  onDone,
}: {
  feature: Feature;
  onSave: FeatureCardProps['onSave'];
  onDone: () => void;
}) {
  const [name, setName] = useState(feature.name);
  const [description, setDescription] = useState(feature.description);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const descriptionId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo guardar.');
      setPending(false);
    }
  }

  return (
    <form
      className="feature-card-body feature-card-form"
      aria-label={`Editar ${feature.name}`}
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === 'Escape' && onDone()}
    >
      <label htmlFor={nameId}>Nombre</label>
      <input id={nameId} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={pending} autoFocus />
      <label htmlFor={descriptionId}>Descripción</label>
      <textarea
        id={descriptionId}
        value={description}
        maxLength={500}
        rows={3}
        placeholder="Para qué sirve esta feature"
        onChange={(e) => setDescription(e.target.value)}
        disabled={pending}
      />
      {error && <p role="alert">{error}</p>}
      <div className="feature-card-actions">
        <button type="button" className="pixel-button is-ghost" onClick={onDone} disabled={pending}>
          Cancelar
        </button>
        <button type="submit" className="pixel-button is-primary" disabled={pending}>
          Guardar
        </button>
      </div>
    </form>
  );
}
