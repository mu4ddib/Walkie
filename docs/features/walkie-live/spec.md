# Spec: Walkie Live — Importar proyecto local

- Issue padre: #162
- Estado: aprobada (2026-11-14)

## Objetivo

Que un equipo analice su proyecto en su computador con el CLI de Walkie, cargue el `.walkiepack` resultante en una app y, tras revisar lo descubierto, sume al catálogo, a los módulos y a las features solo lo que aprueba, con cada componente vinculado a la evidencia de código que lo respalda.

Flujo: analizar localmente → exportar → importar → descubrir → revisar → integrar → explorar en el editor de siempre.

## Situación actual

Todo lienzo se arma a mano. Lo único que entra desde fuera es un `.walkie` (spec `exportar-e-importar`), que reconstruye lienzos ya hechos en Walkie: no trae evidencia ni candidatos y siempre crea features nuevas. No hay analizador, ni registro de dónde sale un componente, ni forma de comparar lo documentado con el código.

## Usuarios

- Quien documenta una app que ya existe y no quiere empezar de un lienzo vacío.
- Quien llega a un equipo (onboarding) y necesita un inventario fiable de APIs, servicios, bases y módulos.
- Líderes técnicos que quieren saber qué del código no está documentado.

## Criterios de aceptación

### CLI y paquete

- [ ] Dado un proyecto local, cuando ejecuto `walkie analyze <carpeta> -o <archivo>.walkiepack`, entonces obtengo un paquete con: tecnologías detectadas, entidades descubiertas (api, service, database, resource, screen, candidatos a módulo y a feature), relaciones entre ellas, evidencia de cada una (archivo relativo, líneas, detector, confianza), el alcance del análisis y sus limitaciones.
- [ ] El análisis es estático: el CLI no compila, no instala dependencias ni ejecuta código ni scripts del proyecto analizado.
- [ ] El paquete no contiene rutas absolutas, ni contenido de archivos de secretos (`.env`, `*.pfx`, `appsettings.*.json` con secretos), ni fragmentos de código salvo con `--include-snippets`.
- [ ] Analizar dos veces el mismo árbol de archivos produce un paquete idéntico (orden estable; la fecha solo en el manifest).
- [ ] Cada entidad tiene una clave estable determinista (ej. `api:GET /api/apps/{appId}`), la misma entre análisis del mismo proyecto.
- [ ] La fuente tiene un id estable que el CLI guarda en `.walkie/source.json` del proyecto: reanalizar el mismo proyecto apunta a la misma fuente.
- [ ] Detectores del primer alcance: archivos OpenAPI, docker-compose, manifiestos (`.csproj`, `package.json`, `.sln`/`.slnx`), ASP.NET Core (Minimal APIs, controllers, `DbContext`/`DbSet`) y rutas y llamadas HTTP de React y Angular. Lo que un detector no puede resolver (una ruta construida en tiempo de ejecución) aparece en `limitations`, sin inventarlo.

### Cargar el paquete

- [ ] Dada la página de una app, cuando uso «Importar proyecto local» y elijo un `.walkiepack`, entonces Walkie lo valida sin guardar nada y me muestra las tecnologías, cuántos hallazgos hay por tipo, el alcance y las limitaciones antes de confirmar.
- [ ] Un paquete inválido, de una versión no soportada o demasiado grande se rechaza con un mensaje que dice qué falla (ruta del error dentro del paquete); no se guarda nada.
- [ ] Cargar dos veces el mismo paquete no crea un segundo análisis: se abre el que ya existe.
- [ ] Dada la galería de apps, cuando uso «Crear app desde proyecto local», entonces se crea una app nueva con el nombre de la fuente y se abre la revisión de su primer análisis.
- [ ] Dada una app con una fuente, entonces la página de la app muestra la fuente (nombre, último análisis, commit) y permite abrir su revisión o cargar un análisis nuevo.

### Revisar (Discovery Review)

- [ ] Dado un análisis, entonces veo sus hallazgos agrupados por tipo y por estado: **nuevo**, **coincide con** un elemento existente (con el motivo: vínculo previo, firma igual o título parecido), **vinculado**, **descartado** y, en un reanálisis, **cambiado** y **ya no aparece**.
- [ ] Cada hallazgo muestra su evidencia (archivo, líneas, detector, confianza) y sus relaciones.
- [ ] Puedo descartar un hallazgo; el descarte se recuerda en los análisis siguientes de la misma fuente.
- [ ] Puedo vincular un hallazgo a un elemento existente del catálogo o a un módulo en vez de crear uno nuevo; una coincidencia por título nunca se vincula sola.
- [ ] Puedo elegir qué nuevos elementos del catálogo, módulos (con sus interfaces) y features propuestas crear.
- [ ] Antes de aplicar veo una vista previa: qué se crea, qué se vincula y qué no cambia.
- [ ] Con miles de hallazgos, la revisión pagina y filtra sin bloquear la interfaz.

### Aplicar

- [ ] Cuando aplico, entonces se crea únicamente lo aprobado: elementos del catálogo, módulos con su lienzo e interfaces y features nuevas con un lienzo inicial (sus pantallas y `ref` a los componentes del catálogo, ubicados sin superponerse).
- [ ] Aplicar no modifica ningún lienzo existente: ni posiciones, ni tamaños, ni presentación, ni textos escritos a mano (su `version` y su contenido quedan iguales).
- [ ] Aplicar no elimina nada. Lo que ya no aparece en un reanálisis solo se marca en la revisión.
- [ ] Aplicar dos veces (reintento, doble clic) no duplica nada; si algo falla a mitad, no queda nada a medias (como la importación, ADR-0009).
- [ ] Después de aplicar, cada componente creado o vinculado se abre en el editor actual (catálogo, módulo o feature), y desde el componente puedo ver de qué evidencia viene.

## Fuera de alcance

- GitHub App, servidor MCP, observabilidad y sincronización automática.
- Generar o modificar código del proyecto analizado.
- Escribir en lienzos existentes (sumar un `ref` a una feature ya documentada): candidato a una iteración posterior.
- Análisis incremental (solo archivos cambiados): el formato lo permite, pero el CLI analiza el árbol completo.
- IA generativa como fuente de descubrimiento.
- Autorización por app (hoy cualquier usuario autenticado accede a cualquier app): riesgo aceptado y documentado; feature aparte antes del piloto en banca.
- Otros lenguajes y frameworks (Java/Spring, Python, Go, Vue…).

## Impacto en el modelo

- `walkie-graph` **sin cambios**: la procedencia vive fuera del grafo (ADR-0012).
- `walkie-catalog-item` sin cambios en sus campos (el id puede venir del cliente al aplicar; el schema ya lo trata como uuid).
- Nuevos schemas en `packages/schema` (ADR-0013):
  - `walkie-discovery-pack.schema.json`: `manifest.json` del `.walkiepack` (formato, versiones, analizador, fuente, VCS, alcance, limitaciones, estadísticas).
  - `walkie-discovery.schema.json`: el `discovery.json` del paquete, con entidades, relaciones y evidencia.
  - `walkie-discovery-review.schema.json`: la revisión calculada de un análisis.
  - `walkie-discovery-apply.schema.json`: decisiones a aplicar y resultado.

## Impacto en la API

Módulo nuevo `Walkie.Modules.Discovery` (schema `discovery` de Postgres; ADR-0012).

- `POST /api/apps/{appId}/sources/snapshots` (multipart, campo `file`, `dryRun`): 201 con el análisis; 200 con el existente si el paquete ya se cargó; 400 con la ruta del error; 413; 404 si la app no existe.
- `POST /api/sources/import` (multipart): crea una app nueva y carga el análisis («Crear app desde proyecto local»).
- `GET /api/apps/{appId}/sources`: fuentes de la app con su último análisis.
- `GET /api/snapshots/{snapshotId}/review?kind=&status=&page=`: la revisión paginada (`walkie-discovery-review`).
- `PUT /api/sources/{sourceId}/bindings/{entityKey}`: descartar, vincular o deshacer (con versión: 409).
- `POST /api/snapshots/{snapshotId}/apply` (`walkie-discovery-apply`, con `applyId` del cliente): 200 con lo creado y vinculado; 400 con lo inválido; 409 si un vínculo cambió.
- `GET /api/apps/{appId}/bindings?target=`: de qué evidencia viene un componente.
- Contratos internos que se extienden (sin romper): `IAppWriter` acepta el id de un elemento del catálogo y lo borra para compensar; la lectura segura del zip pasa de `ImportHandlers` a `Walkie.Shared`.

## Decisiones

- 2026-11-14, auditoría de la fase 0: CLI como herramienta .NET con análisis estático; detectores OpenAPI, docker-compose, manifiestos, ASP.NET Core + EF y React/Angular; evidencia sin fragmentos de código por defecto; la falta de autorización por app se acepta como riesgo documentado.
- La procedencia (vínculo hallazgo ↔ componente) no entra en el grafo (ADR-0012).
- Las propuestas se calculan al pedir la revisión; solo se guardan las decisiones (vínculos y descartes).

## Preguntas abiertas

- Parser de TypeScript/TSX desde .NET para React y Angular: Acornima trae JSX (paquete Acornima.Extras) pero no TypeScript; las alternativas son tree-sitter con bindings nativos o un escáner de tokens propio. Se decide con una prueba de concepto en su tarea (ADR-0013 lo deja abierto).
- Límites del paquete (tamaño, número de entidades): se fijan al medir con Walkie analizándose a sí mismo.
- Distribución del CLI (NuGet público, feed interno o binario autocontenido): se decide antes del piloto.
