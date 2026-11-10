import type { StoreApi } from 'zustand/vanilla';
import type { GraphStore } from '../store/graphStore';

/** Texto de la confirmación al salir con cambios sin guardar (spec imagenes-portal, decisión 3). */
export const UNSAVED_CONFIRM = 'Tienes cambios sin guardar. ¿Salir igual?';
/** Lo mismo cuando el autoguardado no pudo guardar antes de salir. */
export const UNSAVED_AFTER_ERROR_CONFIRM = 'No se pudieron guardar los últimos cambios. ¿Salir igual y perderlos?';

/** Lo que el editor hace antes de dejar un lienzo: `true` si se puede salir. */
type LeaveGuard = () => Promise<boolean>;

const guards = new WeakMap<StoreApi<GraphStore>, LeaveGuard>();

/** El editor registra cómo se sale de su lienzo (con autoguardado, guardando antes); `null` lo quita. */
export function setLeaveGuard(store: StoreApi<GraphStore>, guard: LeaveGuard | null) {
  if (guard) guards.set(store, guard);
  else guards.delete(store);
}

/**
 * ¿Se puede salir del lienzo (cambiar de feature o de app)? Con cambios pendientes: con autoguardado se guardan
 * antes de salir; en modo manual la persona decide (quedarse a guardar o salir y perderlos).
 */
export async function canLeave(store: StoreApi<GraphStore>): Promise<boolean> {
  const guard = guards.get(store);
  if (guard) return guard();
  return !store.getState().dirty || window.confirm(UNSAVED_CONFIRM);
}
