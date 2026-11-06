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
    Walkie.Modules.Files/  # adjuntos en S3/MinIO
    Walkie.Shared/         # tipos comunes, resultados, errores
  tests/
    Walkie.IntegrationTests/  # xUnit + Testcontainers (Postgres real)
```

## Estado actual

Existen `Walkie.Api` (host, `/api/health`, `/api/me`, auth JWT, ProblemDetails, CORS, OpenAPI), `Walkie.Shared`, `Walkie.Modules.Apps` (apps, features), `Walkie.Modules.Canvas` (lienzo `jsonb` + `version`) y `Walkie.IntegrationTests` (WebApplicationFactory + Testcontainers). Tours y Files se crean cuando una tarea los necesite. Los proyectos comparten `Directory.Build.props` (warnings como errores, analizadores recomendados).

## Convenciones

- Minimal APIs agrupadas por módulo (`MapGroup("/api/apps")`).
- Validación con FluentValidation; errores como `ProblemDetails` (RFC 9457).
- EF Core + Npgsql; el grafo del lienzo se guarda en una columna `jsonb`, con columna `version` (int) para concurrencia optimista: un guardado con versión vieja responde **409 Conflict**.
- Los DTOs del grafo deben coincidir con `packages/schema/walkie-graph.schema.json`.
- Cada endpoint nuevo: prueba de integración + aparece en OpenAPI.
- Logs con Serilog; trazas con OpenTelemetry.
- Auth (ADR-0003): todo endpoint exige usuario autenticado por defecto; los públicos llevan `.AllowAnonymous()`. El usuario es el claim `sub`. En pruebas, `WalkieApiFactory.CreateAuthenticatedClient()` firma tokens locales; no hace falta Keycloak.

## Persistencia

- Cada módulo tiene su `DbContext` **internal**, su schema de Postgres (`apps`, `canvas`) y sus migraciones en `Persistence/Migrations`. Sin FK entre módulos.
- El módulo expone solo `Add<Módulo>Module(connectionString)` y `Migrate<Módulo>DatabaseAsync()`.
- En Development la API aplica las migraciones al arrancar (`Database:MigrateOnStartup`); en producción va en `false`.
- Crear una migración (desde la raíz, tras `dotnet tool restore`):
  `dotnet ef migrations add <Nombre> --project apps/api/src/Walkie.Modules.<Módulo> --startup-project apps/api/src/Walkie.Api --context <Módulo>DbContext --output-dir Persistence/Migrations`
- Pruebas: `WalkieApiFactory` levanta un Postgres real (requiere Docker) compartido por la colección `ApiTestGroup`; cada prueba crea sus propios datos con IDs nuevos.

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
- **Endpoints en un módulo**: el `.csproj` necesita `<FrameworkReference Include="Microsoft.AspNetCore.App" />`. Validación con `.WithValidation<TRequest>()` (`Walkie.Shared.Validation`); los validadores pueden ser `internal` (se registran con `includeInternalTypes: true`).

## Cómo crear un endpoint

Ejemplo completo: `src/Walkie.Modules.Apps/` (`Contracts/`, `Features/AppsHandlers.cs`, `Features/AppsEndpoints.cs`) y `tests/Walkie.IntegrationTests/AppsEndpointsTests.cs`.

1. Request/response (records públicos) en `Contracts/` del módulo.
2. Validador `AbstractValidator<TRequest>` en `Contracts/`.
3. Handler (lógica) en `Features/`, separado del mapeo HTTP; registrado en `Add<Módulo>Module`.
4. Registrar en el `MapGroup` del módulo con `WithName`, `TypedResults` y `.WithValidation<T>()`.
5. Prueba de integración en `tests/`: 401 sin token, caso feliz, 400, 404 y que aparezca en `/openapi/v1.json`.
