# Walkie — guía para asistentes de IA

Walkie es un lienzo interactivo para documentar apps (pantallas, inputs, reglas, APIs, servicios, BD) y recorrerlas con tours guiados. Público: equipos de desarrollo y onboarding, con foco en banca.

## Mapa del repo

- `apps/web` — React + TS + Vite + React Flow. Ver `apps/web/CLAUDE.md`.
- `apps/api` — ASP.NET Core .NET 10, monolito modular. Ver `apps/api/CLAUDE.md`.
- `packages/schema` — JSON Schema del grafo. **Fuente de verdad**: front y back se ajustan a él, nunca al revés.
- `infra/` — docker-compose (Postgres, MinIO).
- `docs/` — `vision.md`, `architecture.md`, `glossary.md`, `adr/`, `features/<feature>/{spec,plan}.md`, `workflow.md`.

## Modelo de dominio (resumen)

App → Catálogo (nodos reutilizables: api, service, database) + Features. Feature → un lienzo (nodos propios: screen, rule, actor; nodos `ref` al catálogo; nodos `portal` a otras features) + Tours. Detalle en `docs/glossary.md`.

## Comandos

| Tarea | Comando |
| --- | --- |
| Levantar servicios | `docker compose -f infra/docker-compose.yml up -d` |
| API | `dotnet run --project apps/api/src/Walkie.Api` |
| Pruebas API | `dotnet test apps/api` |
| Web | `pnpm --dir apps/web dev` |
| Pruebas web | `pnpm --dir apps/web test` |
| Lint web | `pnpm --dir apps/web lint` |
| Regenerar tipos del schema | `pnpm --dir apps/web gen:schema` |

API en http://localhost:5080 (OpenAPI en `/openapi/v1.json` en Development), web en http://localhost:5173. Actualiza esta tabla si cambian.

## Reglas

- Trabaja a partir del issue y del `plan.md` de la feature; no amplíes el alcance sin decirlo.
- IDs de nodos y conexiones se generan en el cliente (UUID v7). Nodos y conexiones se guardan como mapas por ID.
- Posición (`layout`) separada del contenido del nodo.
- Todo cambio de estado del lienzo en el front pasa por acciones del store (`addNode`, `moveNode`, `connect`…), nunca mutaciones sueltas.
- Nada de datos reales de clientes en ejemplos, seeds ni pruebas.
- Secretos solo por variables de entorno; nunca en el repo.
- Si cambias el schema, el contrato de la API o una decisión de arquitectura: actualiza `packages/schema`, `docs/` o un ADR en el mismo PR.
- Commits con Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…).

## Skills del repo

- `nueva-feature` — crear spec + plan + issue de una funcionalidad.
- `escribir-adr` — registrar una decisión de arquitectura.

## Para ahorrar contexto

Lee solo los archivos que la tarea necesita. Para búsquedas amplias en el código usa un subagente. No pegues logs completos: solo la parte relevante.
