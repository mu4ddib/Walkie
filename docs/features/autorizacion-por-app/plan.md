# Plan: autorización por app

Basado en `spec.md` (aprobada el 2026-11-19) y ADR-0015. Es el incremento D1 de `docs/features/walkie-live/validacion.md` §18: un solo PR, con commits por fase.

## Archivos a tocar

- `packages/schema/walkie-app-member.schema.json` (nuevo) y `role` en la respuesta de una app.
- `apps/api/src/Walkie.Modules.Apps/` (membresías, usuarios, `IAppAccess`, `IAppScopeResolver`, filtro `RequireAppRole`, miembros, migración `Memberships`).
- Un resolvedor por módulo con ids propios (Files: imágenes; Sharing: enlaces; Discovery: análisis) y `.RequireAppRole(...)` en cada `*Endpoints.cs`.
- `apps/api/src/Walkie.Api/Program.cs` (registro de usuarios después de autenticar).
- `apps/web/src/` (rol, solo lectura, «Miembros», mensajes de acceso).
- `infra/keycloak/walkie-realm.json` (usuario ficticio `dev2` para E2E).

## Tareas

1. [x] (#175) Membresías, usuarios y filtro en la API, aplicado a todos los endpoints; owner al crear; `GET /api/apps` filtrado.
2. [x] Miembros (API y schema) y pruebas: guardia de cobertura, matriz IDOR, migración.
3. [x] Web: rol, solo lectura para viewer, «Miembros», mensajes de acceso.
4. [ ] E2E con dos usuarios reales, documentación y validación completa.

## Pruebas

- **Unitarias:** Vitest de solo lectura y de «Miembros».
- **Integración:** cobertura de endpoints (ninguno sin rol), matriz IDOR (extraño 404, viewer 403 al escribir, editor 403 en lo de owner), miembros, migración que siembra owners.
- **E2E:** `dev` y `dev2` con Keycloak real: no ver, ver en solo lectura, editar, dejar de ver.

## Estado

Última actualización: 2026-11-19, nube — tareas 1 y 2 hechas: membresías, filtro único en todos los endpoints, miembros, schema `walkie-app-member` y pruebas (guardia de cobertura, matriz IDOR, migración). Tarea 3 hecha: rol en la app, solo lectura para viewer (lienzo, catálogo, módulos, mapa, revisión), «Miembros» y mensajes de acceso. Sigue la tarea 4 (E2E con `dev2`, documentación y validación).
