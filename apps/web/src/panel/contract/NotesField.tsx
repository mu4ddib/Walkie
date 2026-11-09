import type { Node } from '../../schema/walkie-graph';
import { NOTES_MAX_LENGTH } from '../../store/graphStore';
import { useGraphStore } from '../../store/useGraphStore';
import { TextField } from '../TextField';

/** "Responsabilidades" de un actor o servicio, "Notas" del resto (spec espacio-de-trabajo, criterio 16). */
export function NotesField({ node }: { node: Node }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const responsibilities = node.type === 'actor' || node.type === 'service';
  return (
    <TextField
      label={responsibilities ? 'Responsabilidades' : 'Notas'}
      multiline
      placeholder={responsibilities ? 'Qué hace y de qué responde' : 'Decisiones, supuestos, enlaces'}
      value={node.notes ?? ''}
      maxLength={NOTES_MAX_LENGTH}
      onChange={(notes) => updateNode(node.id, { notes })}
    />
  );
}
