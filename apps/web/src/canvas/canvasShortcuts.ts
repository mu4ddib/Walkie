/** Atajos del lienzo (spec espacio-de-trabajo, criterio 5); el diálogo de ayuda se arma con esta lista. */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['1', '…', '7'], label: 'Agregar un nodo del tipo de la barra (en el centro)' },
  { keys: ['G'], label: 'Agrupar: rodea las cajas seleccionadas con un grupo (o crea uno vacío)' },
  { keys: ['Mayús', 'Clic'], label: 'Sumar una caja a la selección' },
  { keys: ['Arrastrar'], label: 'Desde el punto derecho de un nodo hasta otro: conectarlos' },
  { keys: ['Doble clic'], label: 'Editar el título del nodo (en un portal, abrir su feature)' },
  { keys: ['Supr'], label: 'Borrar lo seleccionado' },
  { keys: ['Espacio', 'Arrastrar'], label: 'Desplazar el lienzo (o arrastrar el fondo)' },
  { keys: ['+', '−'], label: 'Acercar y alejar (o la rueda del ratón)' },
  { keys: ['0'], label: 'Ver todo el lienzo' },
  { keys: ['I'], label: 'Mostrar u ocultar el inspector' },
  { keys: ['M'], label: 'Animar o no el sentido de las conexiones (flujo documentado, no tráfico real)' },
  { keys: ['Ctrl', 'S'], label: 'Guardar' },
  { keys: ['?'], label: 'Mostrar estos atajos' },
];

/** ¿El evento viene de un campo de texto? Ahí las teclas son para escribir, no atajos. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Evento con el que el botón "?" de la barra superior abre los atajos del lienzo. */
export const OPEN_HELP_EVENT = 'walkie:open-help';
