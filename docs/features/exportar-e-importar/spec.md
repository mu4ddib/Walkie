# Spec: Exportar e importar

- Issue padre: #137
- Estado: en curso (tareas 1 a 5 de 7 hechas)

## Objetivo

Que lo documentado en Walkie salga en el formato que cada uno necesita: un contexto completo para darle a una IA antes de construir, una imagen o un PDF para compartir, y un archivo que se puede volver a cargar para reconstruir la feature (o la app) tal cual.

## Situación actual

«Exportar» baja un `.zip` con un Markdown y las imágenes de las pantallas (spec `export-markdown`): sirve para leerlo, pero como contexto para una IA es pobre (no explica el propósito, no ordena los flujos de punta a punta, no dice qué falta) y no hay forma de volver a cargarlo. No hay imagen, PDF ni importación.

## Usuarios

- Quien va a construir (o pedirle a una IA que construya) lo que la feature documenta.
- Quien comparte la arquitectura en una presentación, un ticket o un correo.
- Quien mueve una feature de una app a otra, la respalda o la comparte con otro equipo.

## Criterios de aceptación

### Menú «Exportar»

- [ ] Dado el editor, cuando abro «Exportar», entonces elijo entre: Contexto para IA, Markdown (el actual), Imagen, PDF y Archivo de Walkie; cada opción dice en una línea para qué sirve. Como hoy, se exporta lo guardado y se avisa si hay cambios pendientes. (Tarea 1: el menú con Contexto para IA y Markdown; las demás opciones se suman con sus tareas.)

### Contexto para IA

- [x] Dado un lienzo, entonces el contexto es un único `.md` pensado para un modelo de lenguaje:
  - propósito de la feature y de la app, y glosario de los nombres que usa;
  - inventario de componentes con id estable, tipo, responsabilidad y contrato completo (API: endpoints, parámetros, request, respuestas y errores; base: modelo y estructura; recurso: subtipo y detalles);
  - flujos de punta a punta en orden: cada recorrido como pasos numerados («Pantalla Login → POST /sesiones en API Auth → 201 / 401…») y cada decisión con sus ramas;
  - reglas de negocio con los inputs que validan;
  - relaciones entre features (portales) y componentes compartidos del catálogo;
  - **vacíos detectados**: APIs sin contrato, respuestas sin código, nodos sin conexiones, ramas sin destino, pasos de recorrido rotos, para que la IA pregunte en vez de inventar.
- [x] Además del `.md`, el export trae `<slug>.context.json` con lo mismo en estructura (ids, contratos, flujos, vacíos) para agentes que construyen código; el `.md` se puede copiar al portapapeles y se muestra su tamaño aproximado en tokens.
- [x] Dada la página de una app, entonces se puede exportar el contexto de **toda la app** (todas sus features, el catálogo y el mapa) en un solo documento: índice de features con su propósito, mapa (qué feature lleva a cuál por portales), catálogo con dónde se usa cada componente, resumen de vacíos (también los componentes que ningún lienzo usa) y el contexto de cada feature. En Markdown y en JSON (`walkie-app-ai-context.schema.json`).
- [x] El mismo lienzo guardado genera el mismo texto (orden estable), salvo la fecha.

### Imagen y PDF

- [x] Dado el lienzo, entonces «Imagen» descarga un PNG (o SVG) de todo el lienzo o solo de lo visible, con fondo claro, a la resolución elegida (1× / 2×), con las imágenes de las pantallas. Se genera en el navegador con lo que hay en el lienzo (también lo no guardado), sin puntos de conexión ni grilla, con las fuentes de la interfaz incrustadas.
- [x] Dado el lienzo, entonces «PDF» descarga un documento con portada (feature, app, fecha), la imagen del lienzo y el contenido del Markdown (componentes, conexiones, flujos, tours), con tablas legibles e imágenes. Antes guarda los cambios pendientes, así la imagen y el texto coinciden; al final, lo que falta documentar.

### Archivo de Walkie (importable)

- [x] Dada una feature, entonces «Archivo de Walkie» descarga `<slug>.walkie` (un `.zip`): `manifest.json` (versión del formato y del schema, app, feature, fecha; `walkie-package.schema.json`), `features/<id>/canvas.json` (el grafo según `walkie-graph`), `catalog.json` (los elementos del catálogo que usa) e `img/` (las imágenes de sus pantallas). Una lista de features en el manifest y no un solo `canvas.json`: el mismo formato sirve para la app completa.
- [ ] Dada la página de una app, cuando uso «Importar feature» y elijo un `.walkie`, entonces se crea una feature nueva con el mismo lienzo (nodos, conexiones, posiciones, grupos, notas, tours y recorridos) e imágenes; si el nombre ya existe, se le agrega «(importada)».
- [ ] Los componentes del catálogo se emparejan: si la app ya tiene ese elemento (mismo id), se usa; si no, se crea. La pantalla de importación lo resume antes de confirmar («3 componentes nuevos, 2 existentes, 4 imágenes»).
- [ ] Un archivo inválido o de una versión no soportada se rechaza con un mensaje que dice qué falla (ruta del error del schema); nada se crea a medias.
- [ ] Exportar e importar es idempotente: el lienzo importado, exportado de nuevo, da el mismo `canvas.json` (salvo ids de la feature y de las imágenes).
- [ ] Dada una app, entonces también se puede exportar e importar la app completa (`.walkie` con todas sus features, el catálogo y el mapa).

## Fuera de alcance

- Importar desde otros formatos (draw.io, Mermaid, Markdown, OpenAPI) — candidato a una feature aparte.
- Exportar desde el enlace de solo lectura.
- Plantillas para personalizar el PDF o el contexto.
- Fusionar un `.walkie` con una feature existente (siempre crea una nueva).

## Impacto en el modelo

- Nuevo `packages/schema/walkie-package.schema.json`: el `manifest.json` del archivo (formato, `schemaVersion`, app, features, catálogo, imágenes y su ruta en el `.zip`).
- Nuevo `packages/schema/walkie-ai-context.schema.json`: el JSON del contexto para IA.
- `walkie-graph` sin cambios.

## Impacto en la API

- `GET /api/features/{featureId}/export?format=ai|ai-json|markdown|walkie` (el actual queda como `markdown`, por defecto).
- `POST /api/features/{featureId}/export/pdf` (multipart, campo `canvas` opcional: la imagen del lienzo en PNG, hasta 10 MB; 400 si no es PNG o es más grande). Es `POST` y no `?format=pdf` porque lleva la imagen (ADR-0008).
- `GET /api/apps/{appId}/export?format=ai|ai-json` (contexto para IA de la app, hecho en la tarea 2; `walkie` llega con la tarea 7).
- `POST /api/apps/{appId}/import` (multipart con el `.walkie`): 201 con las features creadas; 400 con la ruta del error; 413 si supera el tamaño máximo; `dryRun=true` devuelve el resumen sin crear nada.
- La imagen (PNG/SVG) se genera en el navegador a partir del lienzo; el PDF se genera en la API con PDFsharp/MigraDoc 6.2.4 (MIT) y la imagen del lienzo la manda el navegador (ADR-0008).

## Decisiones

- 2026-11-12, autor: PDF generado en la API; contexto para IA en Markdown y JSON.
- Al importar se conservan los ids de nodos y conexiones (el lienzo es por feature); la feature y las imágenes reciben ids nuevos.

## Preguntas abiertas

- Ninguna (la librería del PDF y la imagen del lienzo las decidió ADR-0008).
