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

- [ ] Dado un proyecto local, cuando ejecuto `walkie scan <carpeta> -o <archivo>.walkiepack`, entonces obtengo un paquete con: tecnologías detectadas, entidades descubiertas (api, service, database, resource, screen, candidatos a módulo y a feature; hoy todo menos screen y feature, que esperan el parser de TypeScript), relaciones entre ellas, evidencia de cada una (archivo relativo, líneas, detector, confianza), el alcance del análisis y sus limitaciones.
- [x] El análisis es estático: el CLI no compila, no instala dependencias ni ejecuta código ni scripts del proyecto analizado.
- [x] El paquete no contiene rutas absolutas, ni contenido de archivos de secretos (`.env`, `*.pfx`, `appsettings.*.json` con secretos), ni fragmentos de código salvo con `--include-snippets`.
- [x] Analizar dos veces el mismo árbol de archivos produce un paquete idéntico (orden estable; la fecha solo en el manifest).
- [x] Cada entidad tiene una clave estable determinista (ej. `api:GET /api/apps/{}`: los parámetros se normalizan, ADR-0014), la misma entre análisis del mismo proyecto.
- [x] La fuente tiene un id estable que el CLI guarda en `.walkie/source.json` del proyecto: reanalizar el mismo proyecto apunta a la misma fuente.
- [ ] Detectores del primer alcance (hechos todos menos las rutas y llamadas HTTP de React y Angular, tarea 8): archivos OpenAPI, docker-compose, manifiestos (`.csproj`, `package.json`, `.sln`/`.slnx`), ASP.NET Core (Minimal APIs, controllers, `DbContext`/`DbSet`) y rutas y llamadas HTTP de React y Angular. Lo que un detector no puede resolver (una ruta construida en tiempo de ejecución) aparece en `limitations`, sin inventarlo.

### Cargar el paquete

- [x] Dada la página de una app, cuando uso «Importar proyecto local» y elijo un `.walkiepack`, entonces Walkie lo valida sin guardar nada y me muestra las tecnologías, cuántos hallazgos hay por tipo, el alcance y las limitaciones antes de confirmar.
- [x] Un paquete inválido, de una versión no soportada o demasiado grande se rechaza con un mensaje que dice qué falla (ruta del error dentro del paquete); no se guarda nada.
- [x] Cargar dos veces el mismo paquete no crea un segundo análisis: se abre el que ya existe.
- [ ] Dada la galería de apps, cuando uso «Crear app desde proyecto local», entonces se crea una app nueva con el nombre de la fuente y se abre la revisión de su primer análisis.
- [x] Dada una app con una fuente, entonces la página de la app muestra la fuente (nombre, último análisis, commit) y permite abrir su revisión o cargar un análisis nuevo.

### Revisar (Discovery Review)

- [x] Dado un análisis, entonces veo sus hallazgos agrupados por tipo y por estado: **nuevo**, **coincide con** un elemento existente (con el motivo: vínculo previo, firma igual o título parecido), **vinculado**, **descartado** y, en un reanálisis, **cambiado** y **ya no aparece**.
- [x] Cada hallazgo muestra su evidencia (archivo, líneas, detector, confianza) y sus relaciones.
- [x] Puedo descartar un hallazgo; el descarte se recuerda en los análisis siguientes de la misma fuente.
- [x] Puedo vincular un hallazgo a un elemento existente del catálogo o a un módulo en vez de crear uno nuevo; una coincidencia por título nunca se vincula sola.
- [ ] Puedo elegir qué nuevos elementos del catálogo, módulos (con sus interfaces) y features propuestas crear.
- [ ] Antes de aplicar veo una vista previa calculada por la API con las mismas validaciones que aplicar (`dryRun`): qué se crea, qué se vincula, qué se descarta y qué no cambia; si algo no se puede aplicar, lo dice con su motivo antes de confirmar.
- [x] Con miles de hallazgos, la revisión pagina y filtra sin bloquear la interfaz.

### Aplicar

- [ ] Cuando aplico, entonces se crea únicamente lo aprobado: elementos del catálogo, módulos con su lienzo e interfaces y features nuevas con un lienzo inicial (sus pantallas y `ref` a los componentes del catálogo, ubicados sin superponerse). *Elementos del catálogo: hecho (tarea 6). Módulos y features: tarea 9.*
- [x] Aplicar no modifica ningún lienzo existente: ni nodos, conexiones, referencias, módulos, interfaces, portales, layouts, grupos, notas ni tours (su `version` y su contenido quedan iguales).
- [x] Vincular un hallazgo a un elemento existente no cambia ese elemento: ni su título, ni su descripción, ni su contrato.
- [x] Aplicar no elimina nada que ya existiera. Lo que ya no aparece en un reanálisis solo se marca en la revisión. (Deshacer una aplicación fallida borra solo lo que ella misma creó y nadie tocó.)
- [x] Aplicar dos veces (reintento, doble clic) no duplica nada; si algo falla a mitad, se deshace lo creado que nadie tocó (lo editado o usado se deja y se avisa); si el proceso se cae a mitad, el siguiente intento con el mismo `applyId`, o la siguiente aplicación que toque esos hallazgos, lo completa (bitácora de aplicación, ADR-0012). La revisión no lo retoma: sigue de solo lectura.
- [ ] Después de aplicar, cada componente creado o vinculado se abre en el editor actual (catálogo, módulo o feature), y desde el componente puedo ver de qué evidencia viene. *Catálogo: hecho (tarea 6, «De dónde viene» en su detalle). Módulos y features: tarea 9.*
- [x] Crear en el catálogo no inventa datos: copia lo que el análisis vio, avisa lo que queda vacío y si el hallazgo es inferido o una base solo lógica (EF), y no crea un segundo elemento con la misma firma (pide vincular).
- [x] Si un elemento vinculado o creado se borra a mano, la revisión y su procedencia lo dicen en vez de presentarlo como un vínculo válido.

### Seguridad

- [x] Los endpoints de Discovery responden solo con `Discovery:Enabled` encendido (apagado por defecto fuera de Development); apagado, responden 404.
- [ ] **Bloqueo:** no se habilita la importación de proyectos privados para usuarios reales (piloto ni producción) hasta que exista autorización por app (ADR-0012). Encender `Discovery:Enabled` en un entorno con usuarios reales exige el ADR de esa autorización.
- [x] El paquete se lee con límites (tamaño, entradas, descomprimido) y sin seguir rutas fuera del zip; nada del paquete se ejecuta ni se interpreta como HTML en la web.

## Fuera de alcance

- GitHub App, servidor MCP, observabilidad y sincronización automática.
- Generar o modificar código del proyecto analizado.
- Escribir en lienzos existentes (sumar un `ref` a una feature ya documentada): candidato a una iteración posterior.
- Análisis incremental (solo archivos cambiados): el formato lo permite, pero el CLI analiza el árbol completo.
- IA generativa como fuente de descubrimiento.
- Autorización por app: deuda técnica anterior a esta feature (hoy cualquier usuario autenticado accede a cualquier app). Va en una feature aparte y es **bloqueo de seguridad** para habilitar Walkie Live con usuarios reales.
- Actualizar el contenido de un elemento existente con lo descubierto (ej. completar su contrato): candidato a una iteración posterior, como propuesta que la persona acepta campo a campo.
- Otros lenguajes y frameworks (Java/Spring, Python, Go, Vue…).

## Impacto en el modelo

- `walkie-graph` **sin cambios**: la procedencia vive fuera del grafo (ADR-0012).
- `walkie-catalog-item` sin cambios en sus campos (el id puede venir del cliente al aplicar; el schema ya lo trata como uuid).
- Nuevos schemas en `packages/schema` (ADR-0013):
  - `walkie-discovery-pack.schema.json`: `manifest.json` del `.walkiepack` (formato, versiones, analizador, fuente, VCS, alcance, limitaciones, estadísticas).
  - `walkie-discovery.schema.json`: el `discovery.json` del paquete, con entidades, relaciones y evidencia.
  - `walkie-discovery-snapshot.schema.json`: un análisis cargado (procedencia, `packSha256`, `contentFingerprint`).
  - `walkie-discovery-binding.schema.json`: el vínculo de un hallazgo con un elemento de Walkie; es la única confirmación.
  - `walkie-discovery-review.schema.json`: la revisión calculada de un análisis.
  - `walkie-discovery-apply.schema.json` y `walkie-discovery-apply-result.schema.json`: operaciones de revisión (`create`, `link`, `reject`, `reset`) y su resultado o vista previa.
  - Contrato completo e identidad estable en ADR-0014; integridad en `DiscoveryPackValidator` (`Walkie.Shared`).

## Impacto en la API

Módulo nuevo `Walkie.Modules.Discovery` (schema `discovery` de Postgres; ADR-0012).

- `POST /api/apps/{appId}/sources/snapshots` (multipart, campo `file`, `dryRun`): responde `walkie-discovery-upload`. 201 con el análisis nuevo; 200 con la vista previa (`dryRun`) o con el existente (mismo archivo, o mismo contenido que el último análisis de la fuente); 400 con la ruta del error dentro del paquete; 413 si pasa de 50 MB; 404 si la app no existe o Discovery está apagado; 401 sin sesión.
- `POST /api/sources/import` (multipart): crea una app nueva y carga el análisis («Crear app desde proyecto local»).
- `GET /api/apps/{appId}/sources`: fuentes de la app con su último análisis (`walkie-discovery-sources`).
- `GET /api/snapshots/{snapshotId}/review?kind=&status=&page=&pageSize=`: la revisión paginada (`walkie-discovery-review`; `page` desde 0, `pageSize` de 1 a 500, por defecto 50; los conteos son del análisis completo).
- `GET /api/snapshots/{snapshotId}/evidence?entityKey=`: la evidencia y las relaciones (hasta 100) de un hallazgo (`walkie-discovery-evidence`). Si ya no está en ese análisis, la del anterior (`foundIn`). 400 sin `entityKey`; 404 si no está en ninguno de los dos o Discovery está apagado. Agregado en la tarea 5: la revisión solo trae `evidenceCount` y el inspector no debe cargar la evidencia de todo el análisis.
- `POST /api/snapshots/{snapshotId}/apply` (`walkie-discovery-apply`, con `applyId` del cliente): 200 con `walkie-discovery-apply-result` (`completed`, o `compensated` si falló a mitad y se deshizo); 400 con lo inválido; 409 si un vínculo cambió (`bindingVersion`), si el hallazgo ya tiene decisión, si la firma ya está en el catálogo, si el id ya existe o si esa aplicación se está ejecutando; 500 si no se pudo terminar ni deshacer (queda pendiente: repetir el mismo `applyId` la termina). `create` (tarea 6): elementos del catálogo con el id del cliente. Descartar, vincular y restablecer también son operaciones de esta lista (ADR-0014): no hay un endpoint aparte para los vínculos.
- `GET /api/apps/{appId}/bindings?target={kind}:{id}` (`kind`: `catalogItem`, `module` o `feature`): de qué evidencia viene un componente (`walkie-discovery-provenance`: fuente, hallazgo, decisión, análisis, fecha, evidencia y si el último análisis lo sigue viendo; `targetExists`). 400 con un `target` mal formado; 404 si la app no existe o Discovery está apagado.
- `POST /api/snapshots/{snapshotId}/apply?dryRun=true`: la vista previa (lo que se crearía y vincularía, sin escribir).
- Contratos internos que se extienden (sin romper): `IAppWriter.CreateCatalogItemAsync` acepta un id dado (borrar ya existe: `DeleteCatalogItemsAsync`); la lectura segura del zip pasa de `ImportHandlers` a `Walkie.Shared`. Ningún endpoint existente cambia.

## Decisiones

- 2026-11-14, auditoría de la fase 0: CLI como herramienta .NET con análisis estático; detectores OpenAPI, docker-compose, manifiestos, ASP.NET Core + EF y React/Angular; evidencia sin fragmentos de código por defecto; la falta de autorización por app se acepta como riesgo documentado.
- La procedencia (vínculo hallazgo ↔ componente) no entra en el grafo (ADR-0012).
- Aplicar: ids del cliente fijados antes de escribir, bitácora `discovery.applies`, escritura idempotente y compensación; la transacción compartida queda como forma de revertir (ADR-0012).
- Autorización por app: bloqueo de seguridad antes de usuarios reales; mientras, `Discovery:Enabled` (ADR-0012).
- TypeScript/React/Angular: escáner propio al inicio; prueba de concepto contra tree-sitter y el compilador oficial en Jint en la tarea 8 (ADR-0013).
- Las propuestas se calculan al pedir la revisión; solo se guardan las decisiones (vínculos y descartes).

## Preguntas abiertas

- Parser definitivo de TypeScript/TSX: se decide en la tarea 8 con los criterios de ADR-0013 (sin procesos externos, licencia verificada, precisión, plataformas, tiempo y tamaño).
- Límites del paquete (tamaño, número de entidades): se fijan al medir con Walkie analizándose a sí mismo.
- Distribución del CLI (NuGet público, feed interno o binario autocontenido): se decide antes del piloto.
