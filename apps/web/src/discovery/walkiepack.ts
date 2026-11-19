import { WALKIEPACK_MAX_BYTES } from '../api/client';

/** Lo que el navegador puede revisar de un `.walkiepack` antes de subirlo (la API lo valida entero): extensión y tamaño. */
export function walkiepackError(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.walkiepack')) return 'Elige un archivo .walkiepack (lo genera «walkie scan»).';
  if (file.size > WALKIEPACK_MAX_BYTES) {
    return 'El paquete pasa de 50 MB. Analiza una parte del proyecto («walkie scan <carpeta>» o --detectors).';
  }
  return null;
}
