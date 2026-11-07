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
    Walkie.Shared/         # tipos comunes, resultados, errores
  tests/
    Walkie.IntegrationTests/  # xUnit + Testcontainers (Postgres real)
```

## Estado actual

Existen `Walkie.Api` (host, `/api/health`, `/api/me`, auth JWT, ProblemDetails, CORS, OpenAPI), `Walkie.Shared`, `Walkie.Modules.Apps` (apps, features, catálogo con versión), `Walkie.Modules.Canvas` (lienzo `jsonb` + `version`), `Walkie.Modules.Files` (imágenes: datos en `files.assets`, bytes en S3; ADR-0004) y `Walkie.IntegrationTests` (WebApplicationFactory + Testcontainers). Tours se crea cuando una tarea lo necesite. Los proyectos comparten `Directory.Build.props` (warnings como errores, analizadores recomendados).

## Convenciones

- Minimal APIs agrupadas por módulo (`MapGroup("/api/apps")`).
- Validación con FluentValidation; errores como `ProblemDetails` (RFC 9457).
- EF Core + Npgsql; el grafo del lienzo se guarda en una columna `jsonb`, con columna `version` (int) para concurrencia optimista: un guardado con versión vieja responde **409 Conflict**.
- Los DTOs del grafo deben coincidir con `packages/schema/walkie-graph.schema.json`, y los del catálogo con `walkie-catalog-item.schema.json` (los validadores de FluentValidation repiten sus límites).
- Cada endpoint nuevo: prueba de integración + aparece en OpenAPI.
- Logs con Serilog; trazas con OpenTelemetry.
- Auth (ADR-0003): todo endpoint exige usuario autenticado por defecto; los públicos llevan `.AllowAnonymous()`. El usuario es el claim `sub`. En pruebas, `WalkieApiFactory.CreateAuthenticatedClient()` firma tokens locales; no hace falta Keycloak.

## Persistencia

- Cada módulo tiene su `DbContext` **internal**, su schema de Postgres (`apps`, `canvas`, `files`) y sus migraciones en `Persistence/Migrations`. Sin FK entre módulos.
- El módulo expone solo `Add<Módulo>Module(connectionString)`, `Map<Módulo>Module()`, `Migrate<Módulo>DatabaseAsync()` y, si otro módulo lo necesita, una interfaz en `Contracts/` (ej. `IFeatureDirectory` e `ICatalogDirectory` de Apps, que usa Canvas). Si Apps necesita algo que solo sabe Canvas, Apps define la interfaz y Canvas la implementa (`ICatalogUsage`): así no hay referencias en ciclo.
- El schema del grafo se embebe en `Walkie.Modules.Canvas` desde `packages/schema/` (no hay copia): `GraphValidator` lo usa para el 400 y suma la integridad que el schema no expresa (claves = ids, conexiones y layout a nodos existentes, `ruleIds` a nodos `rule`, nombres de input únicos, `options` solo en `enum`). Lo que necesita la base (cada `catalogId` de un `ref` es de la app de la feature) lo valida `CanvasHandlers` después.
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
- **JsonSchema.Net 9**: `schema.Evaluate(...)` recibe `JsonElement` (no `JsonNode`) y `results.Details` puede ser `null`.
- **Servicios compartidos entre módulos** (ej. `TimeProvider`): regístralos con `TryAddSingleton` para no duplicarlos.
- **Campos opcionales en las respuestas**: el schema no admite `null`; los records llevan `[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` para omitirlos (ver `CatalogContracts.cs`).
- **Concurrencia en entidades EF** (ej. `CatalogItem.Version`): compara la versión del request antes de guardar y marca la columna con `IsConcurrencyToken()`; si dos guardados leen la misma versión, el segundo lanza `DbUpdateConcurrencyException` → 409.
- **Buscar dentro del `jsonb`**: `db.Database.SqlQuery<T>($"...")` con la columna como `"Value"` y `jsonb_each(graph -> 'nodes')` (ver `CatalogUsage`). La interpolación se parametriza; no concatenes strings.
- **Subir archivos en Minimal APIs**: un endpoint con `IFormFile` exige antiforgery; la API usa bearer, así que lleva `.DisableAntiforgery()`. Reconoce el tipo por el contenido (`ImageInspector`), no por la extensión.
- **SDK de AWS v4 con servidores compatibles (RustFS)**: `RequestChecksumCalculation` y `ResponseChecksumValidation` en `WHEN_REQUIRED` y `ForcePathStyle = true`; si no, el servidor rechaza las subidas.
- **Imágenes de Docker**: `minio/minio` ya no existe en Docker Hub y `quay.io` está bloqueado en la nube; usa `rustfs/rustfs:1.0.4`. Docker Hub puede responder 429 sin login: espera y reintenta.
- **Tabla nueva**: actualiza la lista de `PersistenceTests.Las_migraciones_crean_las_tablas_de_cada_modulo`.
- **Endpoints en un módulo**: el `.csproj` necesita `<FrameworkReference Include="Microsoft.AspNetCore.App" />`. Validación con `.WithValidation<TRequest>()` (`Walkie.Shared.Validation`); los validadores pueden ser `internal` (se registran con `includeInternalTypes: true`).

## Cómo crear un endpoint

Ejemplo completo: `src/Walkie.Modules.Apps/` (`Contracts/`, `Features/AppsHandlers.cs`, `Features/AppsEndpoints.cs`) y `tests/Walkie.IntegrationTests/AppsEndpointsTests.cs`.

1. Request/response (records públicos) en `Contracts/` del módulo.
2. Validador `AbstractValidator<TRequest>` en `Contracts/`.
3. Handler (lógica) en `Features/`, separado del mapeo HTTP; registrado en `Add<Módulo>Module`.
4. Registrar en el `MapGroup` del módulo con `WithName`, `TypedResults` y `.WithValidation<T>()`.
5. Prueba de integración en `tests/`: 401 sin token, caso feliz, 400, 404 y que aparezca en `/openapi/v1.json`.
