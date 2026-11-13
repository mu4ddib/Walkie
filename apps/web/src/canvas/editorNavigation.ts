import { createContext, useContext } from 'react';

/**
 * Navegar desde lo que el editor muestra alrededor del lienzo (la franja de un módulo): resuelve antes los cambios
 * pendientes, igual que la barra superior (guarda con autoguardado o pide confirmar).
 */
export const EditorNavigateContext = createContext<(path: string) => void>(() => undefined);

export function useEditorNavigate(): (path: string) => void {
  return useContext(EditorNavigateContext);
}
