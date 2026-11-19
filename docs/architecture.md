# Arquitectura

```
[Web app: React + React Flow] --REST--> [API .NET 10 (monolito modular)] --EF Core--> [PostgreSQL]
                                                    |                     \--S3 API--> [S3 / RustFS]
        (post-MVP) [Sync Yjs - Hocuspocus] --guarda snapshots vía API--^
```

- El front solo habla con la API. La API es la única que toca Postgres y el almacenamiento.
- Autenticación OIDC (ADR-0003): la web inicia sesión contra el proveedor (Keycloak en desarrollo) con PKCE y envía el access token; la API solo valida el JWT.
- Módulos de la API: Apps (apps, features, catálogo), Canvas (grafo + versión), Files (imágenes en S3, ADR-0004), Sharing (enlaces de solo lectura, ADR-0005), Export (export Markdown, contexto para IA, PDF y `.walkie`, e importación del `.walkie`, ADR-0009; sin tablas). Los tours viven en el grafo de cada lienzo; no hay módulo Tours (se crea cuando una tarea lo necesite).
- El grafo de cada feature se guarda como documento `jsonb` con `version` para concurrencia optimista.
- Una base Postgres con un schema por módulo (`apps`, `canvas`, `files`, `sharing`), cada uno con sus migraciones; sin claves foráneas entre módulos.
- Los módulos se hablan por interfaces de `Contracts/`: Canvas usa `IFeatureDirectory` e `ICatalogDirectory` de Apps; Apps define `ICatalogUsage` (qué lienzos usan un elemento del catálogo) y Canvas la implementa. Canvas depende de Apps, nunca al revés. Sharing (enlaces, ADR-0005) y Export (documento Markdown) usan `IFeatureDirectory` e `ICatalogDirectory` de Apps, `ICanvasReader` de Canvas e `IAssetDirectory` de Files; nadie depende de ellos.
- Módulos compartidos (ADR-0010): un módulo es una feature con `kind = module` en Apps (las listas de features lo excluyen) y su lienzo es un lienzo más de Canvas, con `interfaces`. Canvas expone sus resúmenes (`GET /api/apps/{appId}/modules`, con las redirecciones de las interfaces quitadas), usos y convertir una selección en módulo (escribe en Apps con `IAppWriter` y compensa si falla); `IModuleDirectory` da a Sharing y Export los módulos que alcanza un lienzo. La web pide un solo resumen por app y carga el lienzo de un módulo solo al abrirlo.
- Interacciones (ADR-0011): la operación de una conexión sale de un catálogo único en la web (`apps/web/src/interactions/operations.ts`: verbo, patrones, retornos, secciones del inspector, sugerencias por familia de componentes); el export lo repite en `EdgeOperations` (módulo Export) y el schema fija sus ids. `kind` queda como familia del trazo.
- Contrato del grafo: `packages/schema/walkie-graph.schema.json`.
- Walkie Live (spec `walkie-live`, ADR-0012, ADR-0013 y ADR-0014). Hoy existen el contrato (`packages/schema`, `Walkie.Shared/Discovery`), el analizador con su CLI (`apps/cli`: `Walkie.Analyzer` + `walkie scan`, que referencian `Walkie.Shared` y nada más; lee .NET, OpenAPI, docker-compose y, desde la tarea 8, React, Angular y Next.js con un escáner propio de TypeScript) y el módulo Discovery de la API (schema `discovery`; depende de Apps con `IAppDirectory`, `ICatalogDirectory`, `IFeatureDirectory` e `IAppWriter`, y de Canvas con `ICanvasWriter` e `ICanvasReader`; nadie depende de él; apagado salvo `Discovery:Enabled`): recibe y guarda análisis, calcula la revisión, guarda decisiones (vínculos) y crea lo aprobado —elementos del catálogo (tarea 6), módulos con su lienzo e interfaces y features con su lienzo inicial (tarea 9)—, compara cada análisis con el anterior de la fuente en la misma revisión y crea una app nueva desde un proyecto local (`POST /api/sources/import`, tarea 10; `IAppWriter.CreateAppAsync`) con bitácora, recuperación y compensación; `GET /api/apps/{appId}/bindings` dice de dónde viene un elemento, un módulo o una feature. Es una capa complementaria: no cambia el grafo ni los lienzos existentes, y no se habilita para usuarios reales sin autorización por app.

## Preparado para colaboración

1. IDs generados en el cliente (UUID v7).
2. Nodos y conexiones como mapas por ID (→ `Y.Map`).
3. Concurrencia optimista con `version` (409 si está desactualizado).
4. Cambios solo vía acciones del store.
5. `layout` separado del contenido.
6. Evolución: guardado completo → presencia con SignalR → Yjs con servidor de sincronización.

## Entornos

| Entorno | Qué |
| --- | --- |
| Desarrollo | Devcontainer / Codespaces + `infra/docker-compose.yml` (Postgres, RustFS, Keycloak) |
| CI | GitHub Actions |
| Nube (MVP) | Contenedores administrados (Azure Container Apps, Fly.io o Railway) + Postgres administrado + S3/R2 |
| Banca (futuro) | Self-hosted con Helm en Kubernetes/OpenShift, SSO corporativo |

Decisiones: ver `docs/adr/`.
