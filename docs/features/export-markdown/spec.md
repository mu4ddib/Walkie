# Spec: Export a Markdown

- Issue padre: #84
- Estado: implementada (2026-11-08), verificada por `apps/web/e2e/export-markdown.spec.ts` y `MarkdownExportTests`
- Fase 4 ("compartir"), feature 2. La 1 (enlace-solo-lectura) está implementada; siguen deploy en la nube y piloto.

## Objetivo

Que quien documenta una feature la baje como un `.zip` con un documento Markdown y las capturas de sus pantallas, para guardarlo junto al código, en un wiki o en un PR.

## Usuarios

- Autor: el desarrollador que quiere dejar la documentación de la feature en el repo de la app o en el wiki del equipo.
- Lector del documento: alguien que la lee en GitHub, GitLab o un wiki, sin abrir Walkie.

## Criterios de aceptación

**Descargar (web)**

- [x] 1. Dado el editor de una feature, cuando uso "Exportar", entonces se descarga `<slug>.zip` (el nombre de la feature en minúsculas, sin acentos y con guiones: "Iniciar sesión" → `iniciar-sesion.zip`) con la última versión guardada; si hay cambios sin guardar, la UI avisa que no se incluyen ("Se exporta lo guardado").
- [x] 2. Dado el `.zip`, entonces trae `<slug>.md` y una carpeta `img/` con una imagen por pantalla que tenga imagen (`img/<slug del título>-<8 primeros caracteres del id>.<png|jpg|webp>`); sin imágenes, no hay carpeta.

**Contenido del documento**

- [x] 3. Dado el documento, entonces empieza con `# <feature>`, el nombre de la app, la versión del lienzo y la fecha de exportación, y una tabla de contenidos.
- [x] 4. Dado un lienzo con conexiones, entonces trae un bloque ` ```mermaid ` (`flowchart LR`) con un nodo por caja (su tipo y título) y una flecha por conexión con el texto de su tipo, etiqueta y condición; títulos con comillas, corchetes o saltos de línea no rompen el diagrama.
- [x] 5. Dado el documento, entonces tiene una sección por tipo, en este orden y solo si hay alguno: Actores, Pantallas, Reglas, APIs, Servicios, Bases de datos, Portales. Cada caja va con su título y descripción, y además:
  - pantalla: su imagen (`![…](img/…)`) y la tabla de inputs (nombre, tipo, obligatorio, opciones, reglas que lo validan);
  - regla: su expresión en un bloque de código y qué inputs la usan;
  - API: `MÉTODO /ruta`;
  - portal: "Lleva a <feature>" con el nombre actual del destino;
  - `ref`: los datos actuales del elemento del catálogo, marcado "(del catálogo)", en la sección de su tipo.
- [x] 6. Dado el documento, entonces la sección "Conexiones" lista cada una como `Origen → Destino (tipo): etiqueta [condición]`.
- [x] 7. Dado un lienzo con tours, entonces la sección "Tours" tiene uno por tour con sus pasos numerados (título del nodo y nota).
- [x] 8. Dado un texto con caracteres de Markdown (`*`, `_`, `|`, `#`, `<`…), entonces el documento lo muestra tal cual (escapado) y no rompe tablas ni títulos.

**API**

- [x] 9. Dado `GET /api/features/{featureId}/export`, entonces responde 200 con `application/zip` y `Content-Disposition: attachment; filename="<slug>.zip"`; 404 si la feature no existe; 401 sin sesión.
- [x] 10. Dado el mismo lienzo guardado, entonces el `.md` sale igual byte a byte salvo la fecha de exportación (orden estable: por tipo y título, y luego por id).

**Ampliación (2026-11-09, tras espacio-de-trabajo)**

- [x] 11. Dado un lienzo con detalle técnico, entonces el documento lo incluye: en cada API, autenticación, tabla de parámetros, request y respuestas (código, significado, campos y ejemplo; los errores marcados); en cada base, motor, base, schemas y tablas con campos (tipo, clave, nulo) y relaciones; las responsabilidades o notas de cada caja; y bajo cada conexión, acceso a datos, notas y ejemplo. Un componente del catálogo usa su definición compartida.
- [x] 12. Dado un lienzo con grupos, entonces hay una sección "Grupos" (título, tipo y sus nodos) y el diagrama los dibuja como `subgraph`. Un lienzo sin detalle técnico ni grupos sale igual que antes.

## Fuera de alcance

- Exportar una app completa (varias features y el catálogo) en un solo documento.
- Otros formatos: PDF, HTML, Word, Confluence.
- Importar desde Markdown.
- Exportar desde el enlace de solo lectura (se puede agregar después; aquí solo el autor con sesión).
- Exportar lo que no está guardado (se exporta la última versión guardada).
- Personalizar el documento (plantillas, elegir secciones).

## Impacto en el modelo

Ninguno en `packages/schema`: el export lee el grafo guardado. No hay respuesta JSON nueva (el cuerpo es el `.zip`).

## Impacto en la API

Módulo nuevo `Walkie.Modules.Export` (sin tablas):

- `GET /api/features/{featureId}/export` → 200 `application/zip` | 401 | 404.
- Usa los contratos que ya existen: `IFeatureDirectory.DescribeAsync` (nombres), `ICanvasReader` (grafo), `ICatalogDirectory.ItemsOfAppAsync` (elementos de los `ref`), `IFeatureDirectory` (nombres de destino de los portales) e `IAssetDirectory.OpenInAppAsync` (bytes de las imágenes). Puede necesitar uno nuevo para los nombres de varias features.
- El `.md` lo arma un generador puro (grafo + datos → texto), probado sin base de datos; el `.zip` con `System.IO.Compression`.

Web: botón "Exportar" en la barra del editor; descarga con `fetch` + token (como las imágenes) y un `blob:` con `download`.

## Decisiones tomadas

1. Se exporta una feature, no la app. Decidido el 2026-11-08.
2. Se baja un `.zip` con el `.md` y las imágenes en `img/`.
3. Incluye un diagrama Mermaid del flujo.
4. Lo genera la API (`GET /api/features/{featureId}/export`), con la última versión guardada.
5. Los archivos se nombran con un slug (minúsculas, sin acentos, con guiones) para que funcionen en cualquier sistema y URL.
