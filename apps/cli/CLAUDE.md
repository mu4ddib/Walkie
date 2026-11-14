# apps/cli — Walkie Live: analizador y CLI (.NET 10)

Analiza un proyecto local **sin ejecutar nada** y genera un `.walkiepack` (spec `walkie-live`, ADR-0012, ADR-0013 y ADR-0014).

## Estructura

```
apps/cli/
  Walkie.Cli.slnx
  Directory.Build.props        # importa el de apps/api: warnings = errores, analizadores recomendados
  src/
    Walkie.Analyzer/           # biblioteca reutilizable: no sabe nada de consola, API, lienzo ni base
      ProjectAnalyzer.cs       # orquesta: fuente → recorrido → detectores → manifest → validación → zip
      SourceFiles.cs           # recorrido seguro: exclusiones, archivos sensibles, sin enlaces simbólicos
      Findings.cs              # único modelo de hallazgos: combina, ordena, fingerprints y referencias
      AnalysisContext.cs       # lectura con límites y caché, árboles de Roslyn compartidos, proyectos .NET
      Detectors/               # csproj, package-json, compose, openapi, aspnetcore-endpoints, efcore
    Walkie.Cli/                # dotnet tool «walkie»: argumentos, resumen, códigos de salida
  tests/Walkie.Analyzer.Tests/ # xUnit sin Docker: proyectos ficticios en carpetas con espacios y el propio repo
```

- El contrato no se duplica. Los schemas, `DiscoveryKeys`, `DiscoveryFingerprint`, `DiscoveryPackValidator` y `DiscoveryFormat` viven en `apps/api/src/Walkie.Shared`, y el Analyzer lo referencia.
- Todo paquete pasa `DiscoveryPackValidator` antes de escribirse. Si falla, es un error del analizador (`invalid-pack`, código de salida 4).
- Dependencias, las dos MIT: `Microsoft.CodeAnalysis.CSharp` 4.14.0 (Roslyn solo sintáctico) y `YamlDotNet` 16.3.0 (solo el modelo de nodos). Cualquier otra se justifica en el PR.

## Comandos

| Tarea | Comando |
| --- | --- |
| Analizar | `dotnet run --project apps/cli/src/Walkie.Cli -- scan <carpeta> -o <archivo>.walkiepack` |
| Pruebas | `dotnet test apps/cli/Walkie.Cli.slnx` |
| Instalar como herramienta | `dotnet pack apps/cli/src/Walkie.Cli -c Release -o <carpeta>` y `dotnet tool install Walkie.Cli --tool-path <dir> --add-source <carpeta>` → `walkie scan .` |

Analizar el propio repo sin escribir en él: `--source-id <uuid>`. Así no se crea `.walkie/source.json`.

## Reglas

- **Análisis estático.** Ningún código de `apps/cli/src` usa `Process`/`ProcessStartInfo`; una prueba lo revisa. Nada se compila, se instala, se ejecuta ni se levanta en contenedores.
- **Solo se leen archivos del listado de `SourceFiles`.**
  - Fuera del listado: carpetas generadas o de dependencias (`node_modules`, `bin`, `obj`, `dist`, `.git`…) y archivos sensibles (`.env*`, claves, certificados, `appsettings*.json`, credenciales).
  - Los sensibles se cuentan en la limitación `secret-excluded`.
  - Los enlaces simbólicos no se siguen.
- **La única escritura dentro del proyecto es `.walkie/source.json`**, el id estable de la fuente. Se evita con `--source-id` o `--no-source-file`.
- **Los hallazgos se crean solo con `Findings`**, que aplica las reglas del contrato:
  - observado (`Basis.Observed`) frente a inferido (`Basis.Inferred`); lo inferido nunca tiene confianza `high`;
  - claves con `DiscoveryKeys`;
  - evidencia con ruta relativa, ancla (`symbol`) y líneas, sin fragmentos de código.
- **No se adivina.** Una ruta no literal, un prefijo que llega como parámetro, rutas por convención, una base física o un front sin parser bajan la confianza o quedan en `limitations`. Una limitación con `incomplete: true` deja el análisis como `partial`.
- **Nunca se copian valores de variables de entorno.** De compose solo se leen los nombres de base de datos: literales, o el valor por defecto literal de `${VAR:-valor}`, con confianza media.
- **Determinismo:** el mismo árbol y el mismo reloj dan el mismo `.walkiepack`, byte a byte. Las listas se ordenan y las entradas del zip llevan la fecha `generatedAt`.
- **Límites** (`AnalyzerLimits`): 20.000 archivos, 1 MB por archivo, 20.000 entidades y 50 MB de paquete. Pasar un límite deja el análisis parcial; solo el tamaño del paquete aborta (`pack-too-large`).

## Detectores

| Id | Lee | Produce |
| --- | --- | --- |
| `csproj` | `*.csproj` y `Directory.Build.props` (XML sin DTD) | `service` (SDK Web o Worker); registra bibliotecas, herramientas y pruebas; `depends-on` por `ProjectReference`; tecnologías .NET, ASP.NET Core y EF Core |
| `package-json` | `package.json` | Solo tecnologías (React, Angular, Next.js, Vue, TypeScript, Vite…) y la limitación `frontend-semantics-not-analyzed` |
| `compose` | `docker-compose*.yml`, `compose*.yaml` | `database`, `resource` (caché, cola, tópico, almacenamiento, identidad, gateway, secretos) o `service` según la imagen; `depends-on` |
| `openapi` | Archivos con `openapi` o `swagger` en el nombre (JSON o YAML) | `api` con contrato: parámetros y respuestas. Corre antes que el código, así su contrato es el que queda |
| `aspnetcore-endpoints` | `*.cs` (Roslyn) | `api` de `MapGet/Post/Put/Patch/Delete` (siguiendo `MapGroup` y llamadas fluidas) y de controllers con rutas por atributo; `module` inferido para una biblioteca con endpoints; `exposes` |
| `efcore` | `*.cs` (Roslyn) | `database` lógica por `DbContext` (motor por `Use<Proveedor>`, `DbSet` como tablas, `HasDefaultSchema`); `depends-on` |

## Trampas conocidas

- **`TargetFramework` en `Directory.Build.props`**: si solo se lee el `.csproj`, .NET no aparece como tecnología. `CsprojDetector` busca el `Directory.Build.props` más cercano hacia arriba, dentro de la raíz; no sigue `<Import>`.
- **Imágenes de compose con registro** (`mcr.microsoft.com/mssql/server`): el último segmento no dice qué es. `ComposeDetector.Classify` mira cada segmento: igual al patrón es confianza alta, que empiece por él (`redis-exporter`) es media.
- **`${POSTGRES_DB:-walkie}`**: el nombre real puede venir de una variable. Se usa el valor por defecto literal con confianza media, nunca el `.env`.
- **Prefijo de `MapGroup` sobre un parámetro**: en Walkie, `routes.MapGroup("/api/apps")` está dentro de un método de extensión. El prefijo literal se sigue, pero `routes` podría traer otro prefijo, así que el endpoint queda con confianza media. No lo subas a alta sin seguir la llamada.
- **`TryGetInt32` en JSON que puede venir mal** lanza con un texto: mira `ValueKind` antes (también en `Walkie.Shared`).
- **`Regex.Matches(...).Count`** rompe el build (CA1875): usa `Regex.Count`.
- **Una carpeta llamada `packages`** puede ser código propio (en Walkie, `packages/schema`): no está en las exclusiones.
- **Cambiar el directorio actual en una prueba** (`Environment.CurrentDirectory`) afecta a las demás que usen rutas relativas. Las pruebas usan rutas absolutas y solo una lo cambia, restaurándolo en `finally`.
