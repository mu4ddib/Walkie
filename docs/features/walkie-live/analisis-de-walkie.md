# Walkie analizado por Walkie Live

> **Medición vigente (tarea 11, 2026-11-19, commit `f608457`):** 910 archivos en el alcance, 400 leídos, 1,5 s (3,4 s en frío), ~155 MB de memoria pico; 46 APIs (las 46 llamadas `Map*` de `apps/api/src`), 2 servicios, 6 bases (5 `DbContext` lógicos y la del compose), 2 recursos, 6 módulos, 11 pantallas (las 11 rutas sin comodín), 3 candidatos a feature (confianza baja), 77 relaciones (46 `exposes`, 22 `depends-on`, 9 `navigates`) y **ninguna** `calls`. Análisis parcial. Lo que no detecta y por qué (las 43 APIs que la web llama por `request()` y la navegación por funciones como `appPath()`), con su impacto en los lienzos, está en [`validacion.md`](validacion.md#2-walkie-analiza-walkie). Las secciones de abajo son las mediciones de las tareas 2, 7 y 8, como quedaron entonces.

Resultado real de `walkie scan` sobre este repositorio (tareas 2 y 7 de `plan.md`), para validar el analizador con un proyecto de verdad. No es una expectativa: sale de ejecutarlo. Las pruebas `WalkieRepositoryTests` (`apps/cli/tests`) lo repiten sin fijar números a mano.

```bash
dotnet run --project apps/cli/src/Walkie.Cli -c Release -- scan . -o walkie.walkiepack --source-id 0198f0c0-0000-7000-8000-0000000000a1
```

Ejecución del 2026-11-14, commit `be56285`, analizador 0.1.0:

```
Walkie analizó «Walkie»: 795 archivos en el alcance, 154 leídos, en 1.0 s.
Tecnologías: ASP.NET Core, Docker Compose, .NET 10.0, Entity Framework Core 10.0.13, Node.js 22, PostgreSQL 17, React 19.3.1, TypeScript 5.9.3, Vite 7.3.7.
Componentes:
  api          38  (38 observados, 0 inferidos)
  database      5  (5 observados, 0 inferidos)
  module        5  (0 observados, 5 inferidos)
  resource      2  (2 observados, 0 inferidos)
  service       1  (1 observados, 0 inferidos)
Relaciones: 56. Evidencias: 78.
Detectores: csproj, package-json, compose, openapi, aspnetcore-endpoints, efcore.
Análisis parcial: hay cosas que no se pudieron mirar o resolver (abajo). Walkie no dará por desaparecido lo que no se miró.
Limitaciones:
  [efcore-logical-database] Cada DbContext se propone como una base lógica (…)
  [frontend-semantics-not-analyzed] apps/web/package.json: React: se detectó la tecnología, pero las pantallas, rutas y llamadas HTTP todavía no se analizan (…)
  [secret-excluded] Se excluyeron 3 archivos sensibles (…): no se leyeron.
Paquete: walkie.walkiepack (10 KB).
```

> Después de la tarea 3 el mismo comando encuentra **39 APIs, 6 módulos y 6 bases**: detecta solo el módulo nuevo `Walkie.Modules.Discovery`, con su endpoint `POST /api/apps/{appId}/sources/snapshots` y su `DiscoveryDbContext`. Lo de abajo es la corrida del commit `be56285`.

## Qué encontró

| Entidad | Base | Confianza | Miembros |
|---|---|---|---|
| `service:Walkie.Api` | observed | high | — |
| `module:Walkie.Modules.Apps` | inferred | medium | 13 |
| `module:Walkie.Modules.Canvas` | inferred | medium | 12 |
| `module:Walkie.Modules.Export` | inferred | medium | 5 |
| `module:Walkie.Modules.Files` | inferred | medium | 3 |
| `module:Walkie.Modules.Sharing` | inferred | medium | 7 |
| `database:postgresql/AppsDbContext` | observed | medium | — |
| `database:postgresql/CanvasDbContext` | observed | medium | — |
| `database:postgresql/FilesDbContext` | observed | medium | — |
| `database:postgresql/SharingDbContext` | observed | medium | — |
| `database:postgresql/walkie` | observed | medium | — |
| `resource:storage/rustfs` | observed | high | — |
| `resource:custom/keycloak` | observed | high | — |
| 38 × `api:…` | observed | medium | — |

**APIs:** las 38 son todas las llamadas `MapGet/MapPost/MapPut/MapDelete` de `apps/api/src`, con el prefijo de su `MapGroup`. Ejemplos: `api:GET /api/apps/{}`, `api:PUT /api/features/{}/canvas`, `api:POST /api/apps/{}/modules/extract`. No sobra ninguna (las de las pruebas y de `apps/cli` no cuentan) y no falta ninguna. Salen con confianza media porque cada grupo se crea sobre `routes`, un parámetro de un método de extensión: sin ejecutar no se puede asegurar que `routes` no traiga otro prefijo.

**Módulos:** son los cinco proyectos `Walkie.Modules.*` que tienen endpoints o un `DbContext`. Son inferidos y derivan de `service:Walkie.Api`, que los referencia. `Walkie.Shared` no aparece: no expone nada. `Walkie.Cli` es una herramienta y `Walkie.Analyzer` no expone nada, así que tampoco aparecen.

**Relaciones:**
- 38 `exposes`, de cada módulo (o del host para `/api/health` y `/api/me`) a sus APIs.
- 18 `depends-on`:
  - 14 son referencias entre proyectos, observadas con confianza alta: host → 5 módulos; Canvas → Apps y Files; Files → Apps; Sharing → Apps, Canvas y Files; Export → Apps, Canvas y Files.
  - 4 son de cada módulo a su `DbContext`, con confianza media.

**Bases:** los cuatro `DbContext` son bases lógicas. La base de `infra/docker-compose.yml` es `walkie`, por el valor por defecto de `${POSTGRES_DB:-walkie}`. Que sean la misma base física lo decide una persona en la revisión, no el analizador.

## Qué no encontró, y por qué

- **El front (`apps/web`):** en esta corrida solo se detectaban sus tecnologías. Desde la tarea 8 se analizan sus rutas y su navegación: ver «El front (tarea 8)» abajo.
- **OpenAPI:** el repo no tiene un documento OpenAPI versionado; se genera en tiempo de ejecución (`/openapi/v1.json`), así que el detector corrió sin hallazgos.
- **Keycloak** aparece como recurso «Identidad (OIDC)». Su relación con la API (validación del JWT) es configuración en tiempo de ejecución y no se infiere.
- **Archivos sensibles:** se excluyeron tres sin leerlos: `.env.example` y los dos `appsettings*.json` de `Walkie.Api`. Excluir un `.env.example` es conservador a propósito: el patrón `.env*` no distingue un ejemplo de uno real.

## El front (tarea 8)

Ejecución del 2026-11-15 sobre el commit `a4830fe` más los cambios de la tarea 8. Es el mismo comando de arriba:

```
Walkie analizó «Walkie»: 871 archivos en el alcance, 382 leídos, en 1.3 s.
Componentes:
  api          44  (44 observados, 0 inferidos)
  database      6  (6 observados, 0 inferidos)
  feature       3  (0 observados, 3 inferidos)
  module        6  (0 observados, 6 inferidos)
  resource      2  (2 observados, 0 inferidos)
  screen       11  (11 observados, 0 inferidos)
  service       2  (2 observados, 0 inferidos)
Relaciones: 74. Evidencias: 114.
Detectores: csproj, package-json, compose, openapi, aspnetcore-endpoints, efcore, nextjs, react-router, angular-router, frontend-http, frontend-features.
Limitaciones:
  [dynamic-http-url] apps/web/src/api/client.ts: Una llamada GET usa una URL que no se puede resolver sin ejecutar (baseUrl) (…)
  [dynamic-http-url] apps/web/src/canvas/canvasImage.ts: (3 llamadas: dataUrl, link.href, url) (…)
  [efcore-logical-database] (…)
  [secret-excluded] Se excluyeron 3 archivos sensibles (…)
```

`nextjs` y `angular-router` corrieron y lo dicen en `reason`: «No hay apps Next.js en el alcance», «No hay apps Angular en el alcance».

### Qué encontró

| Hallazgo | Detalle |
|---|---|
| `service:@walkie/web` | La app web, por `apps/web/package.json` (observada, alta). |
| 11 `screen` | Todas las rutas de `apps/web/src/routes.tsx` salvo el comodín `*`: `/`, `/apps`, `/apps/{}`, `/apps/{}/catalog`, `/apps/{}/catalog/{}`, `/apps/{}/features/{}`, `/apps/{}/map`, `/apps/{}/modules/{}`, `/apps/{}/sources/{}`, `/s/{}`, `/s/{}/modules/{}`. Las tres que usan una constante importada (`APPS_PATH`, `SHARED_PATH`, `SHARED_MODULE_PATH` de `workspace/paths.ts` y `share/sharedPath.ts`) se resuelven. El título sale del componente: «Home», «Catalog», «Discovery review»… |
| 9 `navigates` | `Link` y `navigate()` desde páginas que son pantallas: catálogo → app, catálogo → feature, revisión → apps, mapa → inicio… |
| 3 `feature` (propuestas) | «Apps» (`/apps` y `/apps/{}`), «Catalog» (`/apps/{}/catalog` y su detalle) y «Modules» (el módulo y su vista compartida). Inferidas, de confianza baja. Son sugerencias para revisar, no features. |

`WalkieRepositoryTests` lo repite sin números fijos: cuenta los `path:` de `routes.tsx`.

### Qué no encontró, y por qué

- **Ninguna llamada a la API.** La web llama siempre por `request()` (`api/client.ts`), que arma la URL con la base de la API y la ruta que recibe: `fetch(baseUrl + path)`. Sin ejecutar no se sabe qué ruta llega a cada llamada, así que queda como `dynamic-http-url` y no se adivina. Es el falso negativo más importante del escáner en proyectos con un cliente propio. Seguirlo exigiría reconocer funciones envoltorio, y eso queda fuera de esta tarea.
- **Las llamadas de `canvasImage.ts`** (`fetch(dataUrl)`, `fetch(url)`) no son a la API: leen imágenes y fuentes. También son `dynamic-http-url`. Es ruido honesto: no se relacionan con nada.
- **`Link` y `navigate()` en componentes que no son pantallas** (la barra, los menús) no dan `navigates`, porque no hay una pantalla de origen.
