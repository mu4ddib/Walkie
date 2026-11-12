# ADR-0008: PDF en la API con PDFsharp/MigraDoc 6.2.4 y la imagen del lienzo desde el navegador

- Estado: aceptado
- Fecha: 2026-11-12

## Contexto

La spec `exportar-e-importar` (tarea 4, #146) pide un PDF de la feature con portada, la imagen del lienzo y el contenido del Markdown (componentes, conexiones, flujos y tours) con tablas legibles e imágenes. El autor decidió generarlo en la API para que el documento sea consistente. Hay que elegir una librería .NET y su licencia tiene que servir a una organización de banca. Además, la API no tiene el lienzo: lo dibuja React Flow en el navegador, con puertos, carriles y rodeos calculados allí.

Revisado en NuGet el 2026-11-12:

- **PDFsharp-MigraDoc 6.2.4** (2026-01-06): MIT. Desde **6.5.0** (2026-10-14) la licencia pasa a **AGPL-3.0**.
- **QuestPDF 2026.9.x**: licencia propia, gratis solo para organizaciones con ingresos anuales menores a USD 1 M.
- **iText**: AGPL o comercial.

## Opciones consideradas

1. **QuestPDF**. API fluida y buen diseño de tablas. Contras: un banco necesita licencia paga.
2. **PDFsharp/MigraDoc 6.2.4 (MIT), fijado**. Modelo de documento con secciones, tablas, listas e imágenes, y licencia permisiva. Contras:
   - es la última versión MIT, así que no se puede actualizar a la 6.5 sin aceptar la AGPL;
   - en Linux no usa fuentes del sistema y hay que darle los archivos (`IFontResolver`).
3. **Chromium sin interfaz en la API** (imprimir HTML a PDF). Resultado idéntico a la web. Contras: un navegador dentro del servidor, mucha memoria e imagen de contenedor mucho más pesada.

Para la imagen del lienzo:

- **a.** **El navegador la manda.** La web ya la genera (tarea 3) y la adjunta al pedido del PDF.
- **b.** **La API dibuja un diagrama propio.** Duplica en el servidor la lógica de puertos, carriles y rodeos, y el resultado no se vería igual al lienzo.
- **c.** **El PDF va sin imagen.**

## Decisión

PDFsharp/MigraDoc **6.2.4 fijado** (`Version="[6.2.4]"`), con IBM Plex Sans y Mono (SIL OFL 1.1) embebidas en `Walkie.Modules.Export/Fonts` y servidas por un `IFontResolver` propio.

La imagen del lienzo la genera el navegador y llega en el pedido. Por eso el PDF se pide con `POST /api/features/{featureId}/export/pdf` (multipart, campo `canvas` opcional, PNG de hasta 10 MB). Un `GET` no lleva cuerpo, y por eso se descarta el `?format=pdf` que preveía la spec. El texto sale de la última versión guardada, como los demás exports. La web guarda los cambios pendientes antes de pedirlo, para que la imagen y el texto coincidan.

## Consecuencias

- Positivas:
  - Licencia MIT, sin costo ni copyleft.
  - El PDF reutiliza el modelo del contexto para IA (`AiContext`): dice lo mismo que el Markdown y el JSON.
  - La imagen es la misma del lienzo, con sus fuentes.
- Negativas / costos:
  - No se puede subir PDFsharp a 6.5+ sin aceptar AGPL: `apps/api/CLAUDE.md` lo dice y la versión va entre corchetes.
  - PDFsharp 6.2.4 trae `System.Security.Cryptography.Pkcs` 8.0.1, con vulnerabilidades conocidas: el módulo fuerza 10.0.13.
  - Unos 750 kB de fuentes en el repositorio.
  - El PDF necesita la web para incluir el lienzo; pedido sin imagen, sale sin esa página.
- Qué habría que hacer para revertirla:
  - reemplazar `PdfDocument` (el único que usa MigraDoc) por otra librería;
  - si la API llegara a dibujar el lienzo, aceptar el `POST` sin imagen o volver a un `GET`.
