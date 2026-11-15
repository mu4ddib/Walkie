# ADR-0013: Formato `.walkiepack` y CLI .NET con análisis estático

- Estado: aceptado. El lector de TypeScript se decidió en la tarea 8 con la prueba de concepto: escáner propio (opción a). Ver «Decisión del lector de TypeScript (tarea 8)».
- Fecha: 2026-11-14 (revisado el mismo día: justificación del CLI .NET y evaluación de TypeScript, React y Angular)

## Contexto

La spec `walkie-live` necesita un analizador que corra en el computador de quien documenta, sobre código que puede ser de banca, y un formato portable para llevar el resultado a Walkie Web. Hechos:

- La API ya valida JSON Schema en .NET (`Walkie.Shared/Schemas/WalkieSchemas.cs`, JsonSchema.Net, schemas embebidos desde `packages/schema`).
- `pnpm` solo vive en `apps/web`; la raíz no es un workspace.
- El `.walkie` (ADR-0009) es un zip con `manifest.json` que reconstruye lienzos; su lectura tiene límites (50 MB, 2000 entradas, 200 MB descomprimidos).
- Detectores pedidos: OpenAPI, docker-compose, manifiestos, ASP.NET Core + EF, React y Angular.
- Restricciones: no ejecutar código del proyecto analizado y no usar IA como fuente de descubrimiento.

## Opciones consideradas

### Lenguaje del CLI

1. **Node/TypeScript.** El compilador oficial de TypeScript da el AST exacto de React y Angular. Contras:
   - un workspace pnpm nuevo y otro validador de schema (ajv) que tendría que coincidir con el de la API;
   - C# sin un parser equivalente a Roslyn: ASP.NET Core y EF quedarían en heurísticas.
2. **Herramienta .NET** (`apps/cli/Walkie.Cli`, `dotnet tool`). Contras:
   - TypeScript y TSX necesitan un parser aparte (ver abajo);
   - quien solo tiene un front necesita el SDK de .NET o un binario autocontenido.
3. **Reutilizar `.walkie` como formato**: un solo formato. Contras: su semántica es «estos lienzos ya decididos», no «estos candidatos con evidencia».

### Cómo leer TypeScript/JavaScript desde .NET

Qué hay que reconocer:

- **React:**
  - rutas `<Route path>` en JSX y objetos `{ path }` de `createBrowserRouter`;
  - rutas por carpetas (Next.js `app/` y `pages/`), que salen de la estructura de archivos sin parsear;
  - llamadas `fetch`, `axios.*` y clientes generados desde OpenAPI.
- **Angular:**
  - arrays `Routes` con `path`, `component`, `loadComponent` y `loadChildren`, más `provideRouter`/`RouterModule.forRoot`;
  - `routerLink` en las plantillas `.html`;
  - llamadas `HttpClient.get/post/...`.

La mayoría de los proyectos son TS/TSX.

| Opción | Licencia | Precisión | Costo de mantenimiento |
|---|---|---|---|
| a. **Escáner de tokens propio** (cadenas, plantillas, comentarios y expresiones regulares bien delimitados) más patrones sobre los tokens | propia | Media: reconoce literales y llamadas, no tipos ni valores; confianza `medium`/`low` | Bajo al inicio. Medio después: casos borde del lexer (regex frente a división, plantillas anidadas). Sin dependencias ni binarios. |
| b. **tree-sitter** con las gramáticas `typescript`/`tsx` | Núcleo y gramáticas MIT. Bindings .NET comunitarios (TreeSitter.DotNet y otros), licencia a verificar | Alta en sintaxis y tolerante a errores | Alto: binarios nativos por plataforma (win/linux/mac, x64/arm64) dentro de un `dotnet tool`; bindings comunitarios con riesgo de abandono; auditar nativos en banca. |
| c. **Compilador oficial de TypeScript** (Apache-2.0) interpretado en Jint (BSD-2-Clause), sin proceso externo | Apache-2.0 + BSD-2 | Exacta (el mismo AST que `tsc`) | Medio: unos MB de JS embebido y un intérprete lento en miles de archivos (a medir). Ejecuta el compilador, no el proyecto. |
| d. **Node + `typescript`** como proceso externo | Apache-2.0 | Exacta y rápida | Exige Node y lanza un proceso: contradice «el CLI no lanza procesos». Descartada para el CLI base. Un analizador externo que escriba el mismo `.walkiepack` sigue siendo posible. |
| e. **Acornima** (+ Acornima.Extras para JSX), parser de JS en .NET | Derivado de Esprima.NET (BSD-3-Clause); la de Acornima está a verificar | Alta, pero **sin TypeScript** | Bajo. Solo sirve para proyectos JS/JSX puros; no cubre Angular. |

**Rutas por carpetas** (Next.js) y **plantillas** de Angular (`routerLink` en HTML) no necesitan parser de TypeScript: van por estructura de archivos y por un lector de HTML.

## Decisión

**CLI: opción 2.** Por qué .NET:

- la API y el CLI validan el paquete con el mismo código y los mismos schemas (`WalkieSchemas`), así que no pueden discrepar;
- Roslyn solo sintáctico (`Microsoft.CodeAnalysis.CSharp`, MIT; `CSharpSyntaxTree.ParseText`, sin compilar ni restaurar paquetes) da un AST real para ASP.NET Core y EF;
- el equipo y el CI ya usan .NET 10 (`global.json`, job `api`);
- se distribuye como `dotnet tool` o como binario autocontenido.

**Dependencias nuevas permitidas:**

- `Microsoft.CodeAnalysis.CSharp`, para C#;
- un lector de YAML para docker-compose y OpenAPI en YAML (candidato YamlDotNet, MIT; se confirma en la tarea 2).

Cualquier otra dependencia necesita justificación en el PR.

**Formato:** `.walkiepack` es un zip que contiene:

- `manifest.json` (`walkie-discovery-pack.schema.json`): formato y versiones, fecha de generación, analizador, fuente (id estable de `.walkie/source.json` y nombre), VCS, detectores con sus capacidades y si corrieron, alcance, completitud, tecnologías, `limitations[]`, estadísticas e `includeSnippets`;
- `discovery.json` (`walkie-discovery.schema.json`): entidades, relaciones y evidencia en un solo archivo, así la integridad entre ellas se valida en una pasada.
  - Las entidades reutilizan los `$defs` del grafo (`http`, `database`, `resource`, `runtime`): lo aprobado pasa al catálogo sin traducir.
  - La primera versión de este ADR hablaba de tres archivos; se cambió en la tarea 1.
- El detalle del contrato (identidad, fingerprints, observado/inferido/confirmado, snapshots, vínculos, revisión, operaciones y versiones) está en ADR-0014.

**Privacidad y determinismo:**

- el paquete no lleva rutas absolutas;
- las claves son deterministas, el orden es estable y no hay fechas fuera del manifest, así que el mismo árbol da el mismo `discovery.json`;
- la evidencia (archivo relativo, líneas, detector, confianza) va **sin fragmentos de código** salvo `--include-snippets`;
- los archivos de secretos (`.env*`, `*.pfx`, `*.key`, `appsettings.*.json` con secretos) se excluyen siempre.

**Análisis:** el CLI solo lee archivos. No lanza procesos, no compila, no instala y no ejecuta nada del proyecto. Lo que no puede resolver va a `limitations` (ej. `dynamic-route`) y no se adivina.

**TypeScript, React y Angular.** Se empieza por **(a) el escáner propio**, con confianza `medium`/`low`, más rutas por carpetas y el lector de plantillas de Angular. En la tarea 8, antes de cerrar el detector, se hace una prueba de concepto contra **(b) tree-sitter** y **(c) el compilador en Jint**, con proyectos ficticios de React y Angular. Se elige con estos criterios, en este orden:

1. Sin procesos externos.
2. Licencia permisiva verificada de cada paquete.
3. Precisión en rutas y llamadas HTTP de los proyectos de prueba; meta: no menos de 90 % de las rutas literales.
4. Funciona en Windows, Linux y macOS en x64 y arm64 sin pasos extra.
5. Menos de 1 minuto para 2.000 archivos en un portátil.
6. Tamaño de la herramienta.

El resultado se registra aquí. Si se elige (b) o (c), se reemplaza el escáner detrás del mismo detector, sin cambiar el formato.

### Decisión del lector de TypeScript (tarea 8, 2026-11-15)

**Se elige (a), el escáner propio.**

**Cómo se midió.** Mismo corpus y mismas reglas de extracción para los tres lectores. El banco y el generador del corpus están en `apps/cli/poc/parser-typescript/`, con cómo repetirlo y todas las tablas.

- **Corpus ficticio:** 1.929 archivos, 7,8 MB, con 31 rutas, 16 llamadas y 4 expresiones dinámicas conocidas, y trampas para un escáner (comentarios, cadenas y regex con rutas, apóstrofes en JSX, genéricos, plantillas anidadas, tipos con `path`, un archivo roto).
- **Código real:** `apps/web/src` de Walkie, 246 archivos.

**Criterios de arriba, en su orden:**

| Criterio | (a) escáner | (b) tree-sitter | (c) TypeScript en Jint |
|---|---|---|---|
| 1. Sin procesos externos | sí | sí | sí |
| 2. Licencia verificada | propia | MIT | Apache-2.0 + BSD-2-Clause |
| 3. Precisión (meta ≥ 90 % de las rutas literales) | 31/31 rutas, 16/16 llamadas, 0 falsos positivos; 0 errores falsos en código real | 31/31, 16/16, 0 falsos positivos; **4 archivos válidos de Walkie marcados como rotos** (no acepta tipos `import('…')` en genéricos) | 31/31, 16/16, **1 falso positivo** (en un archivo roto); 0 errores falsos |
| 4. Windows, Linux y macOS en x64 y arm64 sin pasos extra | sí (código administrado) | sí con los 9 RID del paquete; **no** en linux-musl (Alpine) | sí (código administrado) |
| 5. Menos de 1 minuto para 2.000 archivos | 0,48 s (CLI completa: 1,1 s) | 1,0 s | 28,4 s |
| 6. Tamaño de la herramienta | +0 | +53 MB (`.nupkg`), 617 MB descomprimido | +~10 MB (Jint y `typescript.js`) |

**Por qué (a):**
- iguala a (b) y (c) en precisión sobre el corpus y es el único sin errores falsos ni falsos positivos también en código real;
- no agrega dependencias, código nativo ni tamaño;
- es el más rápido.

**Su costo:**
- el lexer es nuestro y tiene casos borde: la prueba encontró dos y se corrigieron (argumentos de tipo en un elemento TSX y el genérico `>>>`);
- no entiende tipos ni valores: lo que no es literal (una ruta calculada, una URL de una variable) queda en `limitations` y no se adivina;
- sus rutas salen con confianza `medium`, y las de Next.js `high`, porque salen de las carpetas.

**Por qué no las otras:**
- **(b)** pierde por la precisión en código real (la gramática del paquete llega tarde a sintaxis vigente) y por el código nativo: 617 MB y sin Alpine.
- **(c)** es exacta en sintaxis, pero 60 veces más lenta que (a). Con proyectos más grandes queda cerca del límite de un minuto, y obliga a incrustar 9 MB de JavaScript por versión de TypeScript.

**Si un proyecto real muestra rutas que (a) no lee bien:** se reemplaza el escáner detrás de `ScriptFacts`, sin cambiar los detectores ni el formato. (c) es la alternativa si la precisión manda sobre el tiempo.

## Estado de la implementación (tareas 2 y 7, 2026-11-14)

- **CLI y Analyzer separados.** `apps/cli/src/Walkie.Analyzer` es una biblioteca sin consola, API, lienzo ni base. `apps/cli/src/Walkie.Cli` es la herramienta `walkie` (`dotnet tool`, `walkie scan [carpeta] -o <archivo>`), y por defecto escribe `./architecture.walkiepack`. La distribución sigue siendo `dotnet tool`; un binario autocontenido queda para antes del piloto.
- **Dependencias confirmadas** (licencia leída en su `nuspec`): `Microsoft.CodeAnalysis.CSharp` 4.14.0 (MIT) y `YamlDotNet` 16.3.0 (MIT).
- **Contrato no duplicado.** El Analyzer referencia `Walkie.Shared` (claves, fingerprints, validador, schemas). Costo aceptado: `Walkie.Shared` trae `FrameworkReference` a `Microsoft.AspNetCore.App` (por el filtro de validación de endpoints), así que la herramienta necesita el runtime de ASP.NET Core, que viene con el SDK de .NET. Si un binario autocontenido o un analizador sin ASP.NET lo pide, se separa el contrato de Discovery en su propio proyecto.
- **TypeScript, React y Angular (tarea 8):** escáner propio (`Walkie.Analyzer/Frontend`: `TsLexer`, `ScriptFacts`, `FrontendModel`, `RouteScreens`) y cinco detectores:
  - `nextjs`: pantallas por carpetas y route handlers como APIs;
  - `react-router`;
  - `angular-router`: `loadChildren` y `loadComponent`, NgModules con `forChild`, `routerLink`;
  - `frontend-http`: `fetch`, `axios` y `HttpClient`, hacia la misma clave de API que el backend;
  - `frontend-features`: candidatos por carga diferida o por recurso.

  `package-json` suma cada app de front como `service`. `frontend-semantics-not-analyzed` queda solo para Vue, Svelte y enrutadores no soportados. El detalle está en `apps/cli/CLAUDE.md`.
- **Límites:** 20.000 archivos, 1 MB por archivo, 20.000 entidades y 50 MB de paquete (`AnalyzerLimits`).

## Consecuencias

- Positivas:
  - un solo validador para la API y el CLI;
  - el análisis es reproducible y revisable;
  - no ejecutar nada reduce el riesgo al analizar código de terceros;
  - el formato no depende del lenguaje del CLI.
- Negativas / costos:
  - el análisis sintáctico no resuelve tipos ni valores en tiempo de ejecución (una ruta armada con constantes): se declara en `limitations`;
  - el escáner propio tiene menor precisión que un AST: sus hallazgos nunca son `high` y la revisión no los aplica solos;
  - quien analiza necesita el SDK de .NET o un binario autocontenido (la distribución se decide antes del piloto);
  - hay un proyecto más en el CI.
- Qué habría que hacer para revertirla: otro analizador (por ejemplo en Node) que escriba el mismo `.walkiepack` reemplaza a este sin tocar la API ni la web.
