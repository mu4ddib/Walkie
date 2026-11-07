# Arquitectura

```
[Web app: React + React Flow] --REST--> [API .NET 10 (monolito modular)] --EF Core--> [PostgreSQL]
                                                    |                     \--S3 API--> [MinIO / S3]
        (post-MVP) [Sync Yjs - Hocuspocus] --guarda snapshots vía API--^
```

- El front solo habla con la API. La API es la única que toca Postgres y el almacenamiento.
- Autenticación OIDC (ADR-0003): la web inicia sesión contra el proveedor (Keycloak en desarrollo) con PKCE y envía el access token; la API solo valida el JWT.
- Módulos de la API: Apps (apps, features, catálogo), Canvas (grafo + versión), Tours, Files.
- El grafo de cada feature se guarda como documento `jsonb` con `version` para concurrencia optimista.
- Una base Postgres con un schema por módulo (`apps`, `canvas`), cada uno con sus migraciones; sin claves foráneas entre módulos.
- Los módulos se hablan por interfaces de `Contracts/`: Canvas usa `IFeatureDirectory` e `ICatalogDirectory` de Apps; Apps define `ICatalogUsage` (qué lienzos usan un elemento del catálogo) y Canvas la implementa. Canvas depende de Apps, nunca al revés.
- Contrato del grafo: `packages/schema/walkie-graph.schema.json`.

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
| Desarrollo | Devcontainer / Codespaces + `infra/docker-compose.yml` (Postgres, MinIO, Keycloak) |
| CI | GitHub Actions |
| Nube (MVP) | Contenedores administrados (Azure Container Apps, Fly.io o Railway) + Postgres administrado + S3/R2 |
| Banca (futuro) | Self-hosted con Helm en Kubernetes/OpenShift, SSO corporativo |

Decisiones: ver `docs/adr/`.
