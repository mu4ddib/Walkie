# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Added
- Fase 0: esqueleto de `apps/api` (.NET 10: host con `/api/health`, ProblemDetails, CORS, OpenAPI; `Walkie.Shared`; pruebas de integración) y de `apps/web` (Vite + React + React Flow con grilla de 8 px, TanStack Query, tipos generados desde el schema, Vitest, ESLint). CI valida que los tipos del schema estén al día.
- Estructura inicial del repo: documentación, ADR-0001 (stack), ADR-0002 (lienzos por feature), schema del grafo v0, devcontainer, docker-compose, CI y plantillas de GitHub.
