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
      Detectors/               # csproj, package-json, compose, openapi, aspnetcore-endpoints, efcore y los del front (FrontendDetectors.cs)
      Frontend/                # escáner de TS/TSX (TsLexer), hechos por archivo (ScriptFacts), apps y pantallas (FrontendModel), reglas de rutas (RouteScreens)
    Walkie.Cli/                # dotnet tool «walkie»: argumentos, resumen, códigos de salida
  tests/Walkie.Analyzer.Tests/ # xUnit sin Docker: proyectos ficticios en carpetas con espacios y el propio repo
  poc/parser-typescript/       # prueba de concepto de ADR-0013 (escáner vs tree-sitter vs TypeScript en Jint): corpus, banco y puntaje; fuera de la solución y del CI
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
| `package-json` | `package.json` | Tecnologías (React, Angular, Next.js, Vue, TypeScript, Vite…); cada app de React, Angular o Next.js como `service`; `frontend-semantics-not-analyzed` solo para Vue y Svelte |
| `compose` | `docker-compose*.yml`, `compose*.yaml` | `database`, `resource` (caché, cola, tópico, almacenamiento, identidad, gateway, secretos) o `service` según la imagen; `depends-on` |
| `openapi` | Archivos con `openapi` o `swagger` en el nombre (JSON o YAML) | `api` con contrato: parámetros y respuestas. Corre antes que el código, así su contrato es el que queda |
| `aspnetcore-endpoints` | `*.cs` (Roslyn) | `api` de `MapGet/Post/Put/Patch/Delete` (siguiendo `MapGroup` y llamadas fluidas) y de controllers con rutas por atributo; `module` inferido para una biblioteca con endpoints; `exposes` |
| `efcore` | `*.cs` (Roslyn) | `database` lógica por `DbContext` (motor por `Use<Proveedor>`, `DbSet` como tablas, `HasDefaultSchema`); `depends-on` |
| `nextjs` | Carpetas `app/` y `pages/` de una app con `next` | `screen` por carpeta (sin grupos `(x)`, privadas `_x`, slots `@x` ni interceptadas; sin `_app`, `_document`, `404`), confianza alta; `api` por los `GET/POST…` exportados de un `route.ts` y `exposes` desde la app; `navigates` por `Link href` y `router.push` |
| `react-router` | TS/JS de una app React que importan `react-router(-dom)` | `screen` por ruta con componente (objetos de `createBrowserRouter` con `children`, `index`, `lazy`, `Component`; `<Route>` anidados); `navigates` por `Link`, `NavLink`, `Navigate` y `navigate()` desde una pantalla |
| `angular-router` | TS de una app Angular que importan `@angular/router`, y sus plantillas | `screen` por ruta con `component` o `loadComponent`; sigue `loadChildren` (archivo de rutas o NgModule con `forChild`); `navigates` por `routerLink` y `router.navigate`. Un NgModule no es un módulo de Walkie |
| `frontend-http` | TS/JS de cualquier app de front | `calls` desde la pantalla cuyo componente llama (o desde la app) a la `api` con la clave normalizada: la misma del backend si ya la vio, o una inferida. `fetch`, `axios` (también `axios.create` con `baseURL` literal) y `HttpClient` |
| `frontend-features` | Pantallas de los detectores anteriores | `feature` inferida: pantallas de una misma carga diferida (media) o del mismo recurso, una lista y su detalle (baja); miembros = pantallas y APIs que llaman |

**Front (tarea 8, ADR-0013):**
- **Lector:** escáner propio, sin árbol: tokens, más patrones sobre tokens.
- **Qué es pantalla:** solo una ruta con componente y ruta literal. Un componente que ninguna ruta muestra no es pantalla, y un comodín (`*`, `**`) ni una redirección tampoco.
- **Rutas que se resuelven:** las constantes literales del mismo archivo y las importadas (`path: APPS_PATH`) se resuelven.
- **Lo que no se adivina:**
  - una ruta o URL calculada queda en `limitations` (`dynamic-route`, `dynamic-http-url`);
  - una URL de otro dominio da `external-http-url`, que no deja el análisis parcial;
  - un `loadChildren` que no se sigue da `lazy-routes-unresolved`.
- **Qué se deja fuera:** pruebas, historias y `.d.ts`; también los archivos que no están bajo una app de front (un `package.json` con React, Angular o Next.js).
- **Monorepo (ADR-0014, `formatVersion` 1):** la clave de una pantalla y de un candidato a feature lleva el ámbito de su app (`screen:<ámbito>:<ruta>`, `feature:<ámbito>:<nombre>` y el campo `app`): la carpeta de la app (`.` en la raíz) o el que fije el equipo en `.walkie/source.json` (`"apps": { "<carpeta>": "<ámbito>" }`, se lee y nunca se escribe). La misma ruta en dos apps son dos pantallas. Las APIs no llevan ámbito; si dos servicios publican la misma, limitación `ambiguous-api`.
- **De qué pantalla es una llamada o un enlace** (`FrontendModel.ScreensAt`):
  - si la pantalla es el archivo entero (Next.js, `lazy`), de todas las de ese archivo;
  - si el archivo tiene un solo componente de pantalla, de ese, también desde sus componentes auxiliares del mismo archivo;
  - si tiene varios, del que contiene el código (`ScriptFacts.Declarations`), y en otro código no se adivina;
  - el código suelto del módulo es de la app.

## Trampas conocidas

- **Un detector sin nada que mirar queda `ran`, no `skipped`.**
  - El validador exige que todos los detectores hayan corrido para un análisis `complete`, y `skipped` lo deja parcial.
  - `IDetector.NotApplicable` da el motivo («No hay apps Angular en el alcance»), que va en `reason` con estado `ran`.
  - `skipped` queda para `--detectors`.
- **Argumentos de tipo en JSX** (`<Menu<App> items={…} />`): el lexer los salta después del nombre de la etiqueta. Sin eso, el archivo se marcaba roto.
- **`>>>` en genéricos:** `Array<Map<string, Array<number>>>` termina en un solo operador `>>>` (y `>>`). Saltar un genérico cuenta cada `>` de esos operadores.
- **JSX que no cierra:** puede ser un genérico que parecía JSX (`: <T>(x: T) => T`) o un archivo roto. El lexer vuelve atrás y trata `<` como operador, así un error no se come el resto del archivo.
- **Un objeto con `path` no es una ruta por sí solo:** también necesita componente, carga diferida, hijos, redirección o `index`, o ser hijo de una ruta. Si no, los contratos de prueba (`{ path: '/api/x', method }`) daban rutas falsas. Un `path: string` (un tipo) tampoco es una ruta.
- **`forChild` sin `loadChildren` que lo monte no se cuelga de la raíz.** Antes daba pantallas en `/` que no existen; ahora queda como `lazy-routes-unresolved`.
- **Proyectos de prueba del front:** necesitan un `package.json` con React, Angular o Next.js en la carpeta de la app, o sus archivos no se analizan.
- **Un `AnalyzerException` dentro de un detector detiene el análisis**: el `catch` que deja un detector `failed` lo excluye. Así un ámbito repetido en `.walkie/source.json` (que aparece al armar `FrontendModel`, dentro de `package-json`) es un error claro y no un detector fallido.
- **`TargetFramework` en `Directory.Build.props`**: si solo se lee el `.csproj`, .NET no aparece como tecnología. `CsprojDetector` busca el `Directory.Build.props` más cercano hacia arriba, dentro de la raíz; no sigue `<Import>`.
- **Imágenes de compose con registro** (`mcr.microsoft.com/mssql/server`): el último segmento no dice qué es. `ComposeDetector.Classify` mira cada segmento: igual al patrón es confianza alta, que empiece por él (`redis-exporter`) es media.
- **`${POSTGRES_DB:-walkie}`**: el nombre real puede venir de una variable. Se usa el valor por defecto literal con confianza media, nunca el `.env`.
- **Prefijo de `MapGroup` sobre un parámetro**: en Walkie, `routes.MapGroup("/api/apps")` está dentro de un método de extensión. El prefijo literal se sigue, pero `routes` podría traer otro prefijo, así que el endpoint queda con confianza media. No lo subas a alta sin seguir la llamada.
- **`TryGetInt32` en JSON que puede venir mal** lanza con un texto: mira `ValueKind` antes (también en `Walkie.Shared`).
- **`Program` de la CLI**: es `Walkie.Cli.Program` con `Main`, no instrucciones de nivel superior. Las pruebas de la API referencian la CLI para generar paquetes reales, y una clase `Program` global chocaría con la del host de la API (`CS0433`).
- **`Regex.Matches(...).Count`** rompe el build (CA1875): usa `Regex.Count`.
- **Una carpeta llamada `packages`** puede ser código propio (en Walkie, `packages/schema`): no está en las exclusiones.
- **Cambiar el directorio actual en una prueba** (`Environment.CurrentDirectory`) afecta a las demás que usen rutas relativas. Las pruebas usan rutas absolutas y solo una lo cambia, restaurándolo en `finally`.
