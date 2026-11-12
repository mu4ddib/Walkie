/**
 * Imagen del lienzo (spec exportar-e-importar, tarea 3): PNG o SVG de todo el lienzo o de lo visible, en el navegador.
 * El diálogo vive en la barra del editor y el lienzo (React Flow) en `Canvas`: el diálogo pide la imagen con un evento
 * (`requestCanvasImage`) y `Canvas` la arma (`captureCanvas`) y la devuelve.
 */
export interface ImageOptions {
  format: 'png' | 'svg';
  /** `all`: todo lo que hay en el lienzo, encuadrado; `visible`: lo que se ve ahora. */
  scope: 'all' | 'visible';
  /** Resolución de un PNG (1× o 2×); el SVG es vectorial. */
  scale: 1 | 2;
}

export const EXPORT_IMAGE_EVENT = 'walkie:export-image';

interface ImageRequest {
  options: ImageOptions;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
}

/** Pide la imagen al lienzo montado; falla si no hay lienzo que responda. */
export function requestCanvasImage(options: ImageOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const event = new CustomEvent<ImageRequest>(EXPORT_IMAGE_EVENT, {
      detail: { options, resolve, reject },
      cancelable: true,
    });
    // `Canvas` cancela el evento cuando lo atiende.
    if (window.dispatchEvent(event)) reject(new Error('No hay un lienzo abierto.'));
  });
}

/** Lo atiende `Canvas`: `capture` arma la imagen con lo que sabe del lienzo. */
export function onCanvasImageRequest(capture: (options: ImageOptions) => Promise<Blob>) {
  const listener = (event: Event) => {
    const { options, resolve, reject } = (event as CustomEvent<ImageRequest>).detail;
    event.preventDefault();
    capture(options).then(resolve, reject);
  };
  window.addEventListener(EXPORT_IMAGE_EVENT, listener);
  return () => window.removeEventListener(EXPORT_IMAGE_EVENT, listener);
}

/** Margen alrededor de todo el lienzo (px). */
export const IMAGE_PADDING = 40;
/** Lado máximo de la imagen de todo el lienzo (px, antes de la escala): más grande, se achica para entrar. */
export const IMAGE_MAX_SIDE = 8000;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Tamaño y transformación del viewport para que todo el lienzo (`bounds`) entre en la imagen con su margen, a escala 1
 * o menos si se pasa de `IMAGE_MAX_SIDE`.
 */
export function framing(bounds: Bounds): { width: number; height: number; transform: string } {
  const outerWidth = bounds.width + 2 * IMAGE_PADDING;
  const outerHeight = bounds.height + 2 * IMAGE_PADDING;
  const zoom = Math.min(1, IMAGE_MAX_SIDE / outerWidth, IMAGE_MAX_SIDE / outerHeight);
  const width = Math.ceil(outerWidth * zoom);
  const height = Math.ceil(outerHeight * zoom);
  const x = (IMAGE_PADDING - bounds.x) * zoom;
  const y = (IMAGE_PADDING - bounds.y) * zoom;
  return { width, height, transform: `translate(${x}px, ${y}px) scale(${zoom})` };
}

/** Lo que no va en la imagen: puntos de conexión, la grilla de puntos, controles y paneles de React Flow. */
export function keepInImage(node: HTMLElement): boolean {
  const classes = node.classList;
  if (!classes) return true;
  return !(
    classes.contains('react-flow__handle') ||
    classes.contains('react-flow__background') ||
    classes.contains('react-flow__panel') ||
    classes.contains('react-flow__minimap') ||
    classes.contains('react-flow__attribution')
  );
}

let fontCss: Promise<string | undefined> | null = null;

/**
 * CSS de las fuentes de la interfaz con los archivos incrustados (subconjuntos latinos), para que la imagen use IBM
 * Plex y Press Start 2P. Las hojas de Google Fonts no se pueden leer desde la página (otro origen), así que se piden
 * aparte. Sin red, `undefined`: la imagen sale con las fuentes del sistema.
 */
export function embeddedFontCss(): Promise<string | undefined> {
  fontCss ??= (async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
    if (!link) return undefined;
    try {
      const css = await (await fetch(link.href)).text();
      const faces = css.split('@font-face').slice(1).filter((face) => /unicode-range:[^;]*U\+0000-00FF/i.test(face));
      const embedded = await Promise.all(
        faces.map(async (face) => {
          const url = /url\(([^)]+)\)/.exec(face)?.[1];
          if (!url) return '';
          const blob = await (await fetch(url)).blob();
          const data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
          });
          return `@font-face${face.replace(url, data)}`;
        }),
      );
      return embedded.join('\n');
    } catch {
      return undefined;
    }
  })();
  return fontCss;
}

/**
 * Imagen de `element` (el viewport de React Flow para todo el lienzo; el lienzo entero para lo visible) con fondo
 * claro. `size` y `transform` encuadran todo el lienzo; sin ellos, se toma el elemento como se ve.
 */
export async function captureCanvas(
  element: HTMLElement,
  options: ImageOptions,
  frame: { width: number; height: number; transform?: string },
  background: string,
): Promise<Blob> {
  // La librería solo hace falta al exportar: se carga entonces, aparte del paquete principal.
  const [{ toBlob, toSvg }, fontEmbedCSS] = await Promise.all([import('html-to-image'), embeddedFontCss()]);
  const common = {
    backgroundColor: background,
    width: frame.width,
    height: frame.height,
    filter: keepInImage,
    // Sin las fuentes incrustadas, no intenta leer hojas de otro origen (fallaría en silencio).
    ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
    style: frame.transform
      ? { width: `${frame.width}px`, height: `${frame.height}px`, transform: frame.transform }
      : undefined,
  };
  if (options.format === 'svg') {
    const dataUrl = await toSvg(element, common);
    return await (await fetch(dataUrl)).blob();
  }
  const blob = await toBlob(element, { ...common, pixelRatio: options.scale });
  if (!blob) throw new Error('No se pudo generar la imagen.');
  return blob;
}

/** Nombre del archivo: el de la feature en minúsculas, sin acentos y con guiones (como el export Markdown). */
export function imageFileName(featureName: string | undefined, options: ImageOptions): string {
  const slug =
    (featureName ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'lienzo';
  const suffix = options.scope === 'visible' ? '-vista' : '';
  const scale = options.format === 'png' && options.scale === 2 ? '@2x' : '';
  return `${slug}${suffix}${scale}.${options.format}`;
}
