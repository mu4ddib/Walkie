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

Existen `Walkie.Api` (host, `/api/health`, ProblemDetails, CORS, OpenAPI), `Walkie.Shared` y `Walkie.IntegrationTests` (WebApplicationFactory). Los módulos se crean cuando una tarea los necesite. Los proyectos comparten `Directory.Build.props` (warnings como errores, analizadores recomendados).

## Convenciones

- Minimal APIs agrupadas por módulo (`MapGroup("/api/apps")`).
- Validación con FluentValidation; errores como `ProblemDetails` (RFC 9457).
- EF Core + Npgsql; el grafo del lienzo se guarda en una columna `jsonb`, con columna `version` (int) para concurrencia optimista: un guardado con versión vieja responde **409 Conflict**.
- Los DTOs del grafo deben coincidir con `packages/schema/walkie-graph.schema.json`.
- Cada endpoint nuevo: prueba de integración + aparece en OpenAPI.
- Logs con Serilog; trazas con OpenTelemetry.

## Cómo crear un endpoint

1. Request/response en el módulo correspondiente.
2. Validador.
3. Handler (lógica) separado del mapeo HTTP.
4. Registrar en el `MapGroup` del módulo.
5. Prueba de integración en `tests/`.
