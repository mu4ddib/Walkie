# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Added
- Lienzo editable (lienzo-base, tarea 6): paleta lateral (arrastrar o clic) con `screen`, `api` y `database`; nodos pixel v1 con color por tipo; conexiones en escalones con etiqueta y selector de tipo; editar el título con doble clic (Enter confirma, Escape cancela); borrar con Supr.
- Navegación de apps y features (lienzo-base, tarea 5): rutas con react-router (lista de apps → app → lienzo de la feature), formularios para crear apps y features con TanStack Query, mensajes de carga, vacío, 404 y validación.
- Store del grafo en la web (lienzo-base, tarea 4): `createGraphStore()` con Zustand, estado normalizado por ID, IDs UUID v7, snap a 8 px, tipo de conexión por defecto según el par, borrado en cascada y flag `dirty`.
- Guardar y cargar el lienzo (lienzo-base, tarea 3): `GET/PUT /api/features/{featureId}/canvas` con validación contra `packages/schema` e integridad del grafo (400), concurrencia optimista (409 con `currentVersion`) y 404 si la feature no existe.
- Endpoints de apps y features (lienzo-base, tarea 2): `POST/GET /api/apps`, `GET /api/apps/{appId}`, `POST/GET /api/apps/{appId}/features`, con FluentValidation (400 `ValidationProblemDetails`), 404 y 401.
- Documentación de trampas conocidas por app y guía de sesiones en la nube en `docs/workflow.md`.
- Persistencia (lienzo-base, tarea 1): módulos `Walkie.Modules.Apps` y `Walkie.Modules.Canvas` con EF Core + Npgsql, schema por módulo, migración inicial (`apps`, `features`, `canvases` con `graph jsonb` y `version`), migraciones al arrancar en Development y pruebas con Postgres real (Testcontainers).
- Auth básica con OIDC (ADR-0003): Keycloak en docker-compose con realm de desarrollo, la API valida JWT y exige sesión por defecto (`/api/me`), la web inicia sesión con PKCE.
- Spec y plan de `lienzo-base` (fase 1), con issues por tarea.
- Fase 0: esqueleto de `apps/api` (.NET 10: host con `/api/health`, ProblemDetails, CORS, OpenAPI; `Walkie.Shared`; pruebas de integración) y de `apps/web` (Vite + React + React Flow con grilla de 8 px, TanStack Query, tipos generados desde el schema, Vitest, ESLint). CI valida que los tipos del schema estén al día.
- Estructura inicial del repo: documentación, ADR-0001 (stack), ADR-0002 (lienzos por feature), schema del grafo v0, devcontainer, docker-compose, CI y plantillas de GitHub.

### Fixed
- `pnpm --dir apps/web …` desde la raíz fallaba con corepack activo; un `package.json` mínimo en la raíz fija la versión de pnpm.
- Petición sin cuerpo o con JSON inválido respondía 500; ahora 400.
