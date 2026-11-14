# Walkie — guía para asistentes de IA

Walkie es un lienzo interactivo para documentar apps (pantallas, inputs, reglas, APIs, servicios, BD) y recorrerlas con tours guiados. Público: equipos de desarrollo y onboarding, con foco en banca.

## Mapa del repo

- `apps/web` — React + TS + Vite + React Flow. Ver `apps/web/CLAUDE.md`.
- `apps/api` — ASP.NET Core .NET 10, monolito modular. Ver `apps/api/CLAUDE.md`.
- `packages/schema` — JSON Schema del grafo. **Fuente de verdad**: front y back se ajustan a él, nunca al revés.
- `infra/` — docker-compose (Postgres, RustFS (S3), Keycloak) y realm de Keycloak de desarrollo.
- `docs/` — `vision.md`, `architecture.md`, `glossary.md`, `adr/`, `features/<feature>/{spec,plan}.md`, `workflow.md`.

## Modelo de dominio (resumen)

App → Catálogo (nodos reutilizables: api, service, database, resource; y módulos compartidos con lienzo propio e interfaces, ADR-0010) + Features. Feature → un lienzo (nodos propios: screen, rule, actor; nodos `ref` al catálogo; nodos `module` a un módulo; nodos `portal` a otras features) + Tours. Detalle en `docs/glossary.md`.

## Comandos

| Tarea | Comando |
| --- | --- |
| Levantar servicios (Postgres, RustFS, Keycloak) | `docker compose -f infra/docker-compose.yml up -d` |
| API | `dotnet run --project apps/api/src/Walkie.Api` |
| Pruebas API (requiere Docker) | `dotnet test apps/api` |
| Nueva migración | ver `apps/api/CLAUDE.md` → Persistencia |
| Web | `pnpm --dir apps/web dev` |
| Pruebas web | `pnpm --dir apps/web test` |
| Lint web | `pnpm --dir apps/web lint` |
| E2E (requiere Postgres, RustFS y Keycloak levantados) | `pnpm --dir apps/web e2e --trace off` |
| Medir rendimiento del lienzo (compilación de producción; mismos servicios que E2E) | `pnpm --dir apps/web perf` (`WALKIE_SCALES`, `WALKIE_CPU`, `WALKIE_PERF_LABEL`, `WALKIE_BROWSER=webkit` para Safari; resultados en `apps/web/perf/results/`) |
| Regenerar tipos del schema | `pnpm --dir apps/web gen:schema` |

API en http://localhost:5080 (OpenAPI en `/openapi/v1.json` en Development), web en http://localhost:5173, Keycloak en http://localhost:8080 (usuario de prueba `dev` / `walkie_dev`). Actualiza esta tabla si cambian.

## Reglas

- Trabaja a partir del issue y del `plan.md` de la feature; no amplíes el alcance sin decirlo.
- IDs de nodos y conexiones se generan en el cliente (UUID v7). Nodos y conexiones se guardan como mapas por ID.
- Posición (`layout`) separada del contenido del nodo.
- Todo cambio de estado del lienzo en el front pasa por acciones del store (`addNode`, `moveNode`, `connect`…), nunca mutaciones sueltas.
- Nada de datos reales de clientes en ejemplos, seeds ni pruebas.
- Secretos solo por variables de entorno; nunca en el repo.
- Si cambias el schema, el contrato de la API o una decisión de arquitectura: actualiza `packages/schema`, `docs/` o un ADR en el mismo PR.
- Commits con Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…).
- Si la documentación (`docs/`, specs, planes, ADR, `CLAUDE.md`) contradice el código, identifica la diferencia y propón cómo resolverla (corregir el código o la documentación) antes de modificar el comportamiento. No elijas un lado en silencio.

## Antes de depurar el entorno

Si `dotnet` no existe, Docker no responde, una imagen no baja o el push da 403, la solución ya está en `docs/workflow.md` → "Sesiones en la nube". No la redescubras.

## Flujo de trabajo con IA

- Una tarea de `plan.md` = una rama = un PR. Al terminar: marca la tarea en `plan.md`, actualiza su sección "Estado" y el `CHANGELOG.md`.
- Si el PR anterior de la rama ya se mergeó, reinicia la rama desde `main` (`git fetch origin main && git checkout -B <rama> origin/main`) antes de seguir.
- Antes del push corre los checks de lo que tocaste: `dotnet build -c Release` + `dotnet test apps/api`, o `pnpm --dir apps/web check:schema && pnpm --dir apps/web lint && pnpm --dir apps/web test && pnpm --dir apps/web build`.
- Cuando descubras una trampa nueva (error que costó tiempo), anótala en la sección "Trampas conocidas" del `CLAUDE.md` de esa app en el mismo PR.

## Skills del repo

- `nueva-feature` — crear spec + plan + issue de una funcionalidad.
- `escribir-adr` — registrar una decisión de arquitectura.
- Diseño (instaladas con `npx skills add`, fuentes y versiones en `skills-lock.json`; no se editan a mano):
  - `frontend-design` (anthropics/skills) — dirección visual al crear o rehacer UI.
  - `ui-ux-pro-max` (nextlevelbuilder/ui-ux-pro-max-skill) — reglas de UX/accesibilidad y búsqueda local de estilos, paletas y tipografías. Su `SKILL.md` usa `${CLAUDE_PLUGIN_ROOT}`, que aquí no existe: corre el buscador desde la raíz con `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<consulta>" --domain <ux|style|color|typography>`.
  - `canvas-design` (anthropics/skills) — piezas visuales estáticas (PNG/PDF), ej. pósters o material del piloto.
  - Al aplicarlas, el sistema visual de Walkie (`apps/web/CLAUDE.md` → Estilo: arena/piedra/especia, Plex + Press Start 2P, grilla de 8 px, sin gradientes) manda sobre sus sugerencias genéricas.

## Para ahorrar contexto

Lee solo los archivos que la tarea necesita. Para búsquedas amplias en el código usa un subagente. No pegues logs completos: solo la parte relevante.
