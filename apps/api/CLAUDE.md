# apps/api — ASP.NET Core (.NET 10)

## Arquitectura

Monolito modular. Un proyecto por módulo, comunicación entre módulos solo por interfaces públicas del módulo (nada de acceder al `DbContext` de otro módulo).

```
apps/api/
  src/
    Walkie.Api/            # host: Program.cs, DI, middlewares, OpenAPI
    Walkie.Modules.Apps/   # apps, features, catálogo
    Walkie.Modules.Canvas/ # lienzos (grafo en jsonb), versionado
    Walkie.Modules.Tours/
    Walkie.Modules.Files/  # imágenes en S3 (RustFS en desarrollo), ADR-0004
    Walkie.Modules.Sharing/ # enlaces de solo lectura (token con hash), ADR-0005
    Walkie.Modules.Export/ # export (Markdown, contexto para IA, PDF, .walkie) e import de .walkie, sin tablas
    Walkie.Shared/         # tipos comunes, resultados, errores
  tests/
    Walkie.IntegrationTests/  # xUnit + Testcontainers (Postgres real)
```

## Estado actual

Existen `Walkie.Api` (host, `/api/health`, `/api/me`, auth JWT, ProblemDetails, CORS, OpenAPI), `Walkie.Shared`, `Walkie.Modules.Apps` (apps, features, catálogo con versión), `Walkie.Modules.Canvas` (lienzo `jsonb` + `version`), `Walkie.Modules.Files` (imágenes: datos en `files.assets`, bytes en S3; ADR-0004), `Walkie.Modules.Sharing` (enlaces de solo lectura en `sharing.shares`; ADR-0005), `Walkie.Modules.Export` (`GET /api/features/{featureId}/export`: el `.zip` con el Markdown de una feature y sus imágenes; con `?format=ai` o `ai-json`, el contexto para IA; `GET /api/apps/{appId}/export?format=ai|ai-json`, el de la app completa; `POST /api/features/{featureId}/export/pdf`, el PDF con la imagen del lienzo que manda la web; `?format=walkie`, el archivo `.walkie` que se importa para reconstruir, también de la app completa en `GET /api/apps/{appId}/export?format=walkie`; `POST /api/apps/{appId}/import`, que suma sus features a una app, y `POST /api/apps/import`, que crea una app nueva (ADR-0009); sin tablas) y `Walkie.IntegrationTests` (WebApplicationFactory + Testcontainers). Tours se crea cuando una tarea lo necesite. Los proyectos comparten `Directory.Build.props` (warnings como errores, analizadores recomendados).

## Convenciones

- Minimal APIs agrupadas por módulo (`MapGroup("/api/apps")`).
- Validación con FluentValidation; errores como `ProblemDetails` (RFC 9457).
- EF Core + Npgsql; el grafo del lienzo se guarda en una columna `jsonb`, con columna `version` (int) para concurrencia optimista: un guardado con versión vieja responde **409 Conflict**.
- Los DTOs del grafo deben coincidir con `packages/schema/walkie-graph.schema.json`, los del catálogo con `walkie-catalog-item.schema.json` y los de imágenes con `walkie-asset.schema.json` (los validadores de FluentValidation repiten sus límites).
- Cada endpoint nuevo: prueba de integración + aparece en OpenAPI.
- Logs con Serilog; trazas con OpenTelemetry.
- Auth (ADR-0003): todo endpoint exige usuario autenticado por defecto; los públicos llevan `.AllowAnonymous()`. El usuario es el claim `sub`. En pruebas, `WalkieApiFactory.CreateAuthenticatedClient()` firma tokens locales; no hace falta Keycloak.

## Persistencia

- Cada módulo tiene su `DbContext` **internal**, su schema de Postgres (`apps`, `canvas`, `files`, `sharing`) y sus migraciones en `Persistence/Migrations`. Sin FK entre módulos.
- El módulo expone solo `Add<Módulo>Module(connectionString)`, `Map<Módulo>Module()`, `Migrate<Módulo>DatabaseAsync()` y, si otro módulo lo necesita, una interfaz en `Contracts/` (ej. `IFeatureDirectory` e `ICatalogDirectory` de Apps e `IAssetDirectory` de Files, que usa Canvas; Files usa `IAppDirectory`). Canvas expone `ICanvasReader` (el último grafo guardado). Dependencias: Canvas → Apps y Files; Files → Apps; Sharing y Export → Apps, Canvas y Files (nombres con `IFeatureDirectory.DescribeAsync` y, en Export, la app entera con `IAppDirectory.AppNameAsync`, `IFeatureDirectory.FeaturesOfAppAsync` e `ICatalogDirectory.AllItemsOfAppAsync`; los destinos de portales con `FeatureNamesOfAppAsync`; catálogo usado con `ICatalogDirectory.ItemsOfAppAsync`, grafo con `ICanvasReader`, bytes con `IAssetDirectory.OpenInAppAsync`). Si Apps necesita algo que solo sabe Canvas, Apps define la interfaz y Canvas la implementa (`ICatalogUsage`): así no hay referencias en ciclo. Escritura entre módulos (ADR-0009, solo la usa la importación): `IAppWriter` (Apps: crear y borrar apps, features y elementos del catálogo; nombres de las apps), `IAssetWriter` (Files: reconocer, guardar y borrar imágenes, bytes incluidos) e `ICanvasWriter` (Canvas: validar el grafo y las posiciones del mapa, guardar el primer lienzo por el mismo camino que el `PUT`, crear el mapa de una app nueva y borrar). `ICanvasReader.MapPositionsAsync` da las posiciones guardadas del mapa (el `.walkie` de la app).
- El schema del grafo se embebe en `Walkie.Shared` (`Schemas/WalkieSchemas.cs`) desde `packages/schema/` (no hay copia): `GraphValidator` (Canvas) lo usa para el 400 y los validadores del catálogo (Apps) validan `http`, `database` y `resource` con sus `$defs` (`WalkieSchemas.Http`, `WalkieSchemas.Database`, `WalkieSchemas.Resource`; `runtime` contra `CatalogItem.Runtimes`; errores con ruta, ej. `Http/responses/0/status`). El catálogo guarda el contrato y la estructura en columnas `jsonb` tal como llegan (ya cumplen el schema). `GraphValidator` suma la integridad que el schema no expresa (`http` solo en `api`, `database` solo en `database`, `resource` solo en `resource` y `runtime` solo en `service` (ADR-0007), claves = ids, conexiones y layout a nodos existentes, `ruleIds` a nodos `rule`, nombres de input únicos, `options` solo en `enum`, `assetId` solo en `screen`, `targetFeatureId` solo en `portal`, clave de cada tour = `id`, `nodeId` de cada paso a un nodo existente, `edgeId` a una conexión existente, `id` de paso único en su tour (`removedEdge` no se valida contra el grafo), clave de cada grupo = `id`, `groupId` de un nodo o una nota y `parentId` de un grupo a un grupo existente, sin ciclos y la caja de un grupo en `layout` con `w` y `h`, `mode` y `branches` solo en reglas —`branches` solo en decisiones, con ids únicos—, `branch` de una conexión = salida de su nodo de origen, `replyTo` = otra conexión `request`, clave de cada nota adhesiva = `id` y `layout` también admite notas). Lo que necesita la base (`catalogId`, `assetId` y `targetFeatureId` existen y son de la app de la feature) lo valida `CanvasHandlers.ReferenceErrorsAsync` después.
- Mapa de la app (spec mapa-de-la-app): `AppMaps` (módulo Canvas) arma `GET /api/apps/{appId}/map` con el último lienzo de cada feature (`IFeatureDirectory`, `ICatalogDirectory`) y guarda la distribución en `canvas.app_maps` (`PUT .../map/layout`, validada con `WalkieSchemas.MapLayout` = `$defs/layout` de `walkie-app-map.schema.json`, versión con 409).
- En Development la API aplica las migraciones al arrancar (`Database:MigrateOnStartup`); en producción va en `false`.
- Crear una migración (desde la raíz, tras `dotnet tool restore`):
  `dotnet ef migrations add <Nombre> --project apps/api/src/Walkie.Modules.<Módulo> --startup-project apps/api/src/Walkie.Api --context <Módulo>DbContext --output-dir Persistence/Migrations`
- Almacenamiento (ADR-0004): sección `Storage` (`Endpoint`, `Bucket`, `AccessKey`, `SecretKey`; en producción por variables `Storage__*`). En desarrollo, RustFS de `infra/docker-compose.yml`; `MigrateFilesAsync` crea el bucket al arrancar, así que la API no arranca sin el almacenamiento.
- Pruebas: `WalkieApiFactory` levanta un Postgres y un RustFS reales (requiere Docker) compartido por la colección `ApiTestGroup`; cada prueba crea sus propios datos con IDs nuevos.

## Trampas conocidas

Ya costaron tiempo; no las repitas.

- **Warnings = errores** (`Directory.Build.props`, analizadores `latest-recommended`). Suprimidos a propósito: CA1716 (nombre `Shared`) y, solo en `tests/`, CA1707 (nombres de prueba con `_`).
  - No nombres clases con sufijo `Collection` (CA1711): por eso la colección de xUnit se llama `ApiTestGroup`.
  - `Assert.Equal(esperado, real)`: la constante va primero (xUnit2000).
- **Paquetes `Microsoft.*` en 10.0.13** o más. 10.0.0 arrastra `Microsoft.OpenApi` 2.0.0 con vulnerabilidad alta → NU1903 rompe el build.
- **Testcontainers 4.16**: `new PostgreSqlBuilder("postgres:17")`; el constructor sin imagen es obsoleto (rompe el build). Las pruebas necesitan Docker corriendo.
- **Migraciones**: el código generado se excluye de los analizadores con `apps/api/.editorconfig`; no lo edites a mano.
- **Fechas**: crea con `clock.GetUtcNowForDb()` (`Walkie.Shared.Time`). Postgres guarda microsegundos y .NET ticks de 100 ns; sin truncar, el POST y el GET devuelven horas distintas.
- **`jsonb` reordena claves y quita espacios**: compara grafos por contenido (`JsonElement.DeepEquals`), nunca como texto.
- **Auth por defecto**: sin token, cualquier ruta (incluso inexistente) responde 401, no 404. Las pruebas de 404 van con `CreateAuthenticatedClient()`.
- **Cuerpo ausente o JSON inválido** lanza `BadHttpRequestException`; `Program.cs` lo mapea a 400 con `StatusCodeSelector`. No lo quites.
- **`$ref` a un `$defs` en C#**: `WalkieSchemas` usa su propio `SchemaRegistry` (`BuildOptions`): construye el grafo y luego `{ "$ref": "<$id del grafo>#/$defs/http" }` con las mismas opciones. Con el registro global, dos módulos que cargan el mismo `$id` chocan.
- **JsonSchema.Net 9**: `schema.Evaluate(...)` recibe `JsonElement` (no `JsonNode`) y `results.Details` puede ser `null`. `format` (ej. `uuid`) es solo anotación: los ids se validan con `Guid.TryParse` en la integridad.
- **Servicios compartidos entre módulos** (ej. `TimeProvider`): regístralos con `TryAddSingleton` para no duplicarlos.
- **Campos opcionales en las respuestas**: el schema no admite `null`; los records llevan `[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` para omitirlos (ver `CatalogContracts.cs`).
- **Concurrencia en entidades EF** (ej. `CatalogItem.Version`): compara la versión del request antes de guardar y marca la columna con `IsConcurrencyToken()`; si dos guardados leen la misma versión, el segundo lanza `DbUpdateConcurrencyException` → 409.
- **Buscar dentro del `jsonb`**: `db.Database.SqlQuery<T>($"...")` con la columna como `"Value"` y `jsonb_each(graph -> 'nodes')` (ver `CatalogUsage`). La interpolación se parametriza; no concatenes strings.
- **Subir archivos en Minimal APIs**: un endpoint con `IFormFile` exige antiforgery; la API usa bearer, así que lleva `.DisableAntiforgery()`. Reconoce el tipo por el contenido (`ImageInspector`), no por la extensión.
- **SDK de AWS v4 con servidores compatibles (RustFS)**: `RequestChecksumCalculation` y `ResponseChecksumValidation` en `WHEN_REQUIRED` y `ForcePathStyle = true`; si no, el servidor rechaza las subidas.
- **Imágenes de Docker**: `minio/minio` ya no existe en Docker Hub y `quay.io` está bloqueado en la nube; usa `rustfs/rustfs:1.0.4`. Docker Hub puede responder 429 sin login: espera y reintenta.
- **Endpoints públicos (ADR-0005)**: solo bajo `/api/public/` con `.AllowAnonymous()` en el grupo; responden `Cache-Control: no-store` (un enlace se revoca en cualquier momento) y 404 igual para revocado, caducado, inexistente o token malformado. Una imagen se sirve solo si una pantalla del grafo actual la usa.
- **Tokens de enlaces (ADR-0005)**: 256 bits con `RandomNumberGenerator` en base64url (`System.Buffers.Text.Base64Url`); en la base solo `SHA256.HashData` (`bytea`, índice único). Nunca guardes ni registres el token.
- **Generador del export (`MarkdownDocument`)**: función pura y determinista (orden por sección, título e id; `\n` como salto de línea; fecha en UTC con `CultureInfo.InvariantCulture`). Todo texto del usuario pasa por `MarkdownText` (`Inline`, `Block`, `Code`, `CodeBlock`, `Mermaid`): sin eso, un `|` rompe una tabla o una comilla rompe el diagrama. Se prueba sin base (`MarkdownExportTests`, sin la colección `ApiTestGroup`). Código dentro de una celda de tabla: `CodeCell` (escapa `|`, que en GitHub corta la tabla aunque esté entre comillas invertidas). Los grupos van como `subgraph gN` después de declarar los nodos (Mermaid los mueve adentro).
- **Campos del catálogo según el tipo al editar**: `UpdateCatalogItemRequest` no trae el tipo, así que lo que depende de él (`http` solo en `api`, `resource` obligatorio en `resource`, `runtime` solo en `service`) lo revisa `CatalogHandlers.UpdateAsync` con el tipo guardado, no el validador.
- **Contexto para IA (`MarkdownDocument.AiContext.cs`)**: `MarkdownDocument` es `partial`; el contexto reutiliza sus lectores del grafo (`ReadNodes`, `ReadEdges`, `ReadGroups`, `EdgeText`…), así dice lo mismo que el `.md` del export. De un solo modelo (`AiContext`) salen el JSON (camelCase, nulos fuera, acentos sin escapar: `AiContextJson`) y el Markdown (`RenderAiContext`). `AiContextTests` valida el JSON contra `WalkieSchemas.AiContext`; si cambias el modelo, cambia `walkie-ai-context.schema.json` en el mismo PR. El de la app (`MarkdownDocument.AppAiContext.cs`, `AppAiContextTests`, `WalkieSchemas.AppAiContext`) reúne el de cada feature (su schema lo referencia con `$ref`) y lo escribe un nivel más abajo (`RenderAiContext(c, md, depth: 1)`). Un schema que hace `$ref` a otro se carga después de él en `WalkieSchemas` (`LoadAfter`).
- **PDF (ADR-0008)**: PDFsharp/MigraDoc va fijado en `[6.2.4]`, la última MIT: **desde 6.5 es AGPL**, no lo subas. Trae `System.Security.Cryptography.Pkcs` 8.0.1 (vulnerable, NU1902/NU1903 rompen el build): `Walkie.Modules.Export.csproj` fuerza 10.0.13. En Linux no usa fuentes del sistema: `PdfFonts` (un `IFontResolver` registrado una vez por proceso) sirve IBM Plex de `Fonts/` (OFL). Con ancho y alto a la vez MigraDoc estira una imagen: fija solo el lado que limita (`PngSize`). Las imágenes de `TestImages.Create` son solo cabeceras (PDFsharp las rechaza: «Unsupported image format»); para dibujar, `TestImages.RealPng`. El endpoint lee el formulario a mano: un multipart sin partes hace fallar el enlace de `IFormFile`.
- **Archivo `.walkie` (`WalkiePackage`)**: `manifest.json` según `walkie-package.schema.json` con una lista de `features` (cada una con su `canvas`: `features/<id>/canvas.json`), `catalog.json` (los `CatalogItemResponse` que usan, camelCase y sin nulos: cumplen `walkie-catalog-item`) e `img/<assetId>.<ext>`. Los ids son los de la app de origen; importar decide qué conservar. `WalkieSchemas.Package` y `WalkieSchemas.CatalogItem` validan el archivo.
- **Importar un `.walkie` (`ImportHandlers`, ADR-0009)**: no hay transacción entre módulos. Valida todo antes de escribir (zip con límites, `manifest.json` —formato y versiones primero, con mensaje propio; después el schema—, lienzos con `ICanvasWriter.Validate`, catálogo, imágenes y `catalogId`); después crea catálogo → imágenes → features → lienzos y, si algo falla, `UndoAsync` borra al revés sin el token del pedido. Toda validación nueva va en la primera fase: un error en la segunda deja trabajo a la compensación. Errores con la ruta dentro del archivo (`features/<id>/canvas.json/nodes/n1/catalogId`). El endpoint lee el formulario a mano (como el PDF) y lleva `RequestSizeLimitAttribute` por encima de los 30 MB de Kestrel; `TestServer` no aplica ese límite, así que el 413 lo da el propio endpoint con `ContentLength` y el tamaño del archivo. La respuesta cumple `walkie-import-summary.schema.json` (`WalkieSchemas.ImportSummary`). Para probar la compensación, `ImportEndpointsTests` arma `ImportHandlers` con un `ICanvasWriter` que falla.
- **`.walkie` de la app (tarea 7)**: scope `app`, todo el catálogo (no solo lo usado) y `map.json` con las posiciones del mapa tal como se guardaron (claves: id de feature o `catalog:<id>`); sin mapa acomodado, ni `map.json` ni `manifest.map`. `ImportAppAsync` reutiliza la lectura, el plan (`allCatalog: true`, sin nada existente) y la escritura de `ImportAsync`; crea la app primero (`created.App`) y `UndoAsync` la borra entera. Al remapear el mapa se descartan las posiciones de lo que no se importó.
- **Tabla nueva**: actualiza la lista de `PersistenceTests.Las_migraciones_crean_las_tablas_de_cada_modulo`.
- **Endpoints en un módulo**: el `.csproj` necesita `<FrameworkReference Include="Microsoft.AspNetCore.App" />`. Validación con `.WithValidation<TRequest>()` (`Walkie.Shared.Validation`); los validadores pueden ser `internal` (se registran con `includeInternalTypes: true`).

## Cómo crear un endpoint

Ejemplo completo: `src/Walkie.Modules.Apps/` (`Contracts/`, `Features/AppsHandlers.cs`, `Features/AppsEndpoints.cs`) y `tests/Walkie.IntegrationTests/AppsEndpointsTests.cs`.

1. Request/response (records públicos) en `Contracts/` del módulo.
2. Validador `AbstractValidator<TRequest>` en `Contracts/`.
3. Handler (lógica) en `Features/`, separado del mapeo HTTP; registrado en `Add<Módulo>Module`.
4. Registrar en el `MapGroup` del módulo con `WithName`, `TypedResults` y `.WithValidation<T>()`.
5. Prueba de integración en `tests/`: 401 sin token, caso feliz, 400, 404 y que aparezca en `/openapi/v1.json`.
