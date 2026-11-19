# Prueba de concepto: cómo leer TypeScript/TSX desde .NET (ADR-0013, tarea 8)

Compara tres lectores con **el mismo corpus y las mismas reglas de extracción** (rutas declaradas y llamadas HTTP):

- **(a) escáner propio:** `Walkie.Analyzer/Frontend/TsLexer.cs` + `ScriptFacts.cs`, que se compilan tal cual en el banco;
- **(b) tree-sitter:** `TreeSitter.DotNet` 1.3.0, con las gramáticas `typescript` y `tsx`;
- **(c) compilador oficial de TypeScript en Jint:** Jint 4.18.0 + `typescript.js` 5.9.3.

Nada de esto es parte del producto. `TreeSitter.DotNet` y `Jint` solo los usa este banco, que no está en `Walkie.Cli.slnx` ni en el CI.

## Cómo repetirlo

Desde la raíz del repo. `$OUT` es cualquier carpeta fuera del repo.

```bash
python3 apps/cli/poc/parser-typescript/gen_corpus.py $OUT/corpus 1900
```

```bash
curl -sL https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz | tar -xz -C $OUT
```

```bash
dotnet build -c Release apps/cli/poc/parser-typescript/bench
```

```bash
for m in scanner treesitter; do dotnet apps/cli/poc/parser-typescript/bench/bin/Release/net10.0/Bench.dll $m $OUT/corpus $OUT/r-$m.json; done
```

```bash
dotnet apps/cli/poc/parser-typescript/bench/bin/Release/net10.0/Bench.dll jint $OUT/corpus $OUT/r-jint.json 1000000 $OUT/package/lib/typescript.js
```

```bash
python3 apps/cli/poc/parser-typescript/score.py $OUT
```

## El corpus

`gen_corpus.py` escribe proyectos ficticios con la verdad conocida (`ground_truth.json`), siempre los mismos archivos:

- **Proyectos:** React Router (objetos, JSX anidado, `lazy`, `index`, rutas dinámicas), Next.js App Router y Pages Router, Angular standalone (`provideRouter`, `loadChildren`, `loadComponent`) y Angular con NgModules (`forRoot`, `forChild`).
- **Llamadas:** `fetch`, `axios` y `HttpClient`, con URLs literales, plantillas, constantes y URLs dinámicas.
- **Trampas para un escáner:**
  - rutas en comentarios, en cadenas y en expresiones regulares;
  - apóstrofes en texto JSX;
  - genéricos (`<T,>`, `Array<Map<…>>>`) y comparaciones dentro de JSX;
  - plantillas anidadas con llaves;
  - tipos con `path: string`;
  - un archivo roto.
- **Relleno:** 1.900 componentes React y Angular realistas, sin rutas ni llamadas, para medir el tiempo y detectar falsos positivos.

Total: **1.929 archivos de código (7,8 MB)**. La verdad son **31 rutas literales, 16 llamadas HTTP literales y 4 expresiones dinámicas**.

## Resultados (2026-11-15, Xeon 2,1 GHz de 4 núcleos, 15 GB, Linux x64, un solo hilo)

### Corpus ficticio (mediana de 3 corridas)

| Lector | Rutas | Falsos positivos (rutas) | HTTP | Falsos positivos (HTTP) | Dinámicas señaladas | Archivos con error | Tiempo | Memoria pico |
|---|---|---|---|---|---|---|---|---|
| (a) escáner | 31/31 | 0 | 16/16 | 0 | 4/4 | 1 (el roto) | **0,48 s** | 126 MB |
| (b) tree-sitter | 31/31 | 0 | 16/16 | 0 | 4/4 | 1 (el roto) | 1,0 s | 174 MB |
| (c) TypeScript en Jint | 31/31 | **1** | 16/16 | 0 | 4/4 | 1 (el roto) | 28,4 s (1,6 s de arranque) | 341 MB |

- El falso positivo de (c) está en el archivo roto: el compilador se recupera y arma un `<Route path="/rota">` que nunca cierra.
- En la primera ronda los tres fallaron algo, y en los tres casos era la regla de extracción, no el lector:
  - (b) y (c) no leían una plantilla sin sustituciones como `path`;
  - (a) no saltaba el genérico `>>>`.
- Se corrigieron las reglas y la tabla es la segunda ronda.

### Código real: `apps/web/src` de Walkie (246 archivos, 2,3 MB, ninguno roto)

| Lector | Archivos con error (falsos) | Tiempo | Memoria pico |
|---|---|---|---|
| (a) escáner | 0 | **0,33 s** | 80 MB |
| (b) tree-sitter | **4** | 0,61 s | 146 MB |
| (c) TypeScript en Jint | 0 | 17,5 s | 349 MB |

- **(b):** su gramática no acepta tipos `import('…')` dentro de genéricos (`NonNullable<import('../schema/walkie-graph').Node['database']>`, `importOriginal<typeof import('@xyflow/react')>`). El archivo queda «roto» y lo que sigue al error se pierde.
- **(a):** en la primera pasada tenía 1 error falso: no conocía los argumentos de tipo en un elemento TSX (`<SwitcherMenu<App> …>`). Se corrigió y quedó en 0.

### Análisis completo con la CLI

- **Corpus con una app en la raíz:** `walkie scan` sobre los 1.938 archivos, todos leídos y escaneados, tarda **1,1 s** de punta a punta, contando el arranque de .NET y los demás detectores.
- **El repo de Walkie:** 1,3 s.
- **Límite de ADR-0013:** menos de 1 minuto para 2.000 archivos.

### Distribución, licencias y mantenimiento

| | (a) escáner | (b) tree-sitter | (c) TypeScript en Jint |
|---|---|---|---|
| Procesos externos | no | no | no |
| Licencia | propia | MIT (bindings y gramáticas) | Apache-2.0 (TypeScript) + BSD-2-Clause (Jint) |
| Código nativo | no | sí, por plataforma | no |
| Plataformas | todas las de .NET | 9 RID incluidos (win, linux y osx en x64 y arm64, más arm y x86); **sin linux-musl** (Alpine) | todas las de .NET |
| Tamaño agregado | 0 | `.nupkg` de 53 MB, 617 MB descomprimido (todas las gramáticas × 9 RID) | Jint ~1 MB por TFM + `typescript.js` 9,1 MB |
| Mantenimiento | el lexer es nuestro; la prueba encontró 2 casos borde (argumentos de tipo en JSX, `>>>`) | gramática que llega tarde a sintaxis nueva; bindings de un solo autor | volver a incrustar `typescript.js` en cada versión; intérprete 25-60 veces más lento |
