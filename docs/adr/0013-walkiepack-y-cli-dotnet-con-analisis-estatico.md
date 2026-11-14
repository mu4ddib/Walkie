# ADR-0013: Formato `.walkiepack` y CLI .NET con análisis estático

- Estado: propuesto
- Fecha: 2026-11-14

## Contexto

La spec `walkie-live` necesita un analizador que corra en el computador de quien documenta, sobre código que puede ser de banca, y un formato portable para llevar el resultado a Walkie Web. Hechos:

- La API ya valida JSON Schema en .NET (`Walkie.Shared/Schemas/WalkieSchemas.cs`, JsonSchema.Net, schemas embebidos desde `packages/schema`).
- `pnpm` solo vive en `apps/web`; la raíz no es un workspace.
- El `.walkie` (ADR-0009) es un zip con `manifest.json` que reconstruye lienzos; su lectura tiene límites (50 MB, 2000 entradas, 200 MB descomprimidos).
- Detectores pedidos: OpenAPI, docker-compose, manifiestos, ASP.NET Core + EF y React/Angular.
- No se debe ejecutar código del proyecto analizado ni usar IA como fuente de descubrimiento.

## Opciones consideradas

1. **CLI en Node/TypeScript**: el compilador de TypeScript sirve para React y Angular. Contras: un workspace pnpm nuevo, otro validador de schema y C# sin un parser equivalente a Roslyn.
2. **CLI como herramienta .NET** (`apps/cli/Walkie.Cli`, `dotnet tool`): reutiliza `WalkieSchemas` para validar su salida y Roslyn **solo sintáctico** (`CSharpSyntaxTree.ParseText`, sin compilar ni restaurar paquetes) para C#. Contras: TypeScript y TSX necesitan un parser aparte.
3. **Reutilizar `.walkie` como formato**: un solo formato. Contras: su semántica es «estos lienzos ya decididos», no «estos candidatos con evidencia».

## Decisión

Opción 2, con un formato propio.

**Formato:** `.walkiepack` es un zip que contiene:

- `manifest.json`: `format: "walkiepack"`, `formatVersion`, `schemaVersion`, analizador (nombre y versión), fuente (id estable de `.walkie/source.json` y nombre), VCS (commit, rama y si hay cambios sin confirmar), alcance (rutas incluidas y excluidas, detectores), `limitations[]` y estadísticas;
- `entities.json`, `relations.json` y `evidence.json`.

El paquete no lleva rutas absolutas. Las entidades usan claves deterministas, se ordenan de forma estable y no llevan fechas, así que el mismo árbol da el mismo paquete. La evidencia (archivo relativo, líneas, detector, confianza) va sin fragmentos de código salvo `--include-snippets`. Los archivos de secretos se excluyen siempre.

**Análisis:** el CLI solo lee archivos. No lanza procesos ni compila, instala o ejecuta nada.

**React y Angular:** queda abierto. Acornima (parser de JS para .NET) tiene JSX en Acornima.Extras pero no TypeScript. Se decide con una prueba de concepto entre tree-sitter con bindings nativos y un escáner de tokens propio, comparando licencia, tamaño y precisión, y se registra aquí antes de implementar ese detector.

## Consecuencias

- Positivas:
  - la API y el CLI validan con el mismo código y los mismos schemas;
  - el análisis es reproducible y revisable;
  - no ejecutar nada reduce el riesgo al analizar código de terceros.
- Negativas / costos:
  - el análisis sintáctico no resuelve tipos ni valores en tiempo de ejecución (una ruta armada con constantes): se declara en `limitations` y no se adivina;
  - quien analiza necesita el SDK de .NET, o un binario autocontenido (la distribución se decide antes del piloto);
  - hay un proyecto más en el CI.
- Qué habría que hacer para revertirla: el formato es independiente del lenguaje del CLI, así que otro analizador que escriba el mismo `.walkiepack` reemplaza a este sin tocar la API ni la web.
