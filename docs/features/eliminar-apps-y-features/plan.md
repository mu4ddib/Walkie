# Plan: eliminar apps y features

Basado en `spec.md` y ADR-0017 (2026-11-20). Rama `feat/eliminar-apps-y-features`, apilada sobre `feat/autorizacion-por-app` (PR #176): las rutas exigen `owner` con `RequireAppRole`.

## Archivos a tocar

- `packages/schema/walkie-deletion-impact.schema.json`, `walkie-deletion.schema.json`
- `apps/api/src/Walkie.Modules.Apps`: `Contracts/Deletion.cs` (contrato y modelos), `Features/Deletion*.cs` (endpoints, orquestación, bitácora, recuperación), dominio y migración `Deletions`
- `apps/api/src/Walkie.Modules.{Sharing,Discovery,Canvas,Files}`: un `IDeletionParticipant` cada uno
- `apps/web/src`: `api/client.ts`, `api/hooks.ts`, `gallery/FeatureCard.tsx`, `pages/AppPage.tsx`, `pages/AppsPage.tsx`, diálogos nuevos, `test/fakeApi.ts`
- Docs: ADR-0017, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `CHANGELOG.md`

## Tareas

1. [x] API: bitácora, marca, contrato por módulo, endpoints, recuperación y pruebas de integración.
2. [x] Web: menú y diálogos, invalidación selectiva, Vitest.
3. [x] E2E con Keycloak, API, PostgreSQL y web; capturas; docs.

## Pruebas

- Integración: cada caso de la spec (feature y app), autorización, reintento, fallo a mitad con recuperación, concurrencia con edición y con creación, huérfanos en cada módulo y en S3.
- Vitest: diálogos, bloqueos, rol, navegación e invalidación.
- E2E: `eliminar-apps-y-features.spec.ts`.

## Estado

Última actualización: 2026-11-20, nube — tareas 1 a 3 hechas en un PR draft apilado sobre #176; pendiente de revisión técnica y funcional. Riesgos abiertos en ADR-0017 (sin papelera reversible; un guardado de lienzo en vuelo durante la eliminación).
