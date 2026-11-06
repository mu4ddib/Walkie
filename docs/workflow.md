# Cómo trabajamos

Regla base: **el contexto vive en el repo, no en el chat ni en un computador.** Cualquier sesión (humana o con IA), en cualquiera de los dos computadores, arranca leyendo el issue y los archivos de la feature.

## Ciclo de una feature

1. **Spec** — `docs/features/<feature>/spec.md` (skill `nueva-feature`). Objetivo, criterios de aceptación, fuera de alcance. Se aprueba antes de seguir.
2. **Plan** — `plan.md` en la misma carpeta: archivos a tocar y tareas pequeñas numeradas.
3. **Issues** — una tarea del plan = un issue en GitHub con label `feature/<feature>`.
4. **Implementar** — rama `feat/<issue>-<slug>`, una sesión de IA por tarea: _"implementa la tarea N de docs/features/<feature>/plan.md"_.
5. **Revisar** — CI en verde; revisión del diff en una sesión nueva (sin el historial de quien escribió).
6. **Cerrar** — PR a `main` con squash. Spec, schema, ADR o `CHANGELOG.md` se actualizan en el mismo PR.

## Trabajo entre dos computadores

Al **terminar** una sesión:

```bash
git add -A && git commit -m "wip: <qué quedó>"   # está bien en la rama de la feature
git push
```

y deja en el issue una línea de estado: qué quedó hecho y qué sigue.

Al **empezar** en el otro computador:

```bash
git pull
# reabrir en el devcontainer (o abrir el Codespace)
```

luego lee el issue activo y `plan.md`.

Configuración igual en ambos computadores:

- Git con el mismo nombre y correo; una llave SSH por computador registrada en GitHub.
- VS Code con Settings Sync activado y la extensión Dev Containers.
- Docker Desktop (o usar Codespaces y no instalar nada).
- `.env` nunca se copia entre computadores: se genera desde `.env.example` o se usan Codespaces Secrets.
- En Windows, el repo usa finales de línea LF (`.gitattributes`); no lo cambies.

## Sesiones en la nube (Claude Code web)

El contenedor de la nube no es el devcontainer. Lo que falta y cómo resolverlo:

| Síntoma | Solución |
| --- | --- |
| `dotnet: command not found` | `apt-get install -y dotnet-sdk-10.0` (paquete de Ubuntu; el script `dotnet-install` está bloqueado por la red). El SDK 10.0.1xx cumple `global.json`. |
| Testcontainers: `Failed to connect to Docker endpoint` | El daemon no arranca solo y se pierde al reiniciar la sesión: `dockerd > /tmp/dockerd.log 2>&1 &` y espera a que `docker info` responda. |
| `docker pull quay.io/...` → Forbidden | Usa la imagen de Docker Hub (`keycloak/keycloak:26.4`, ya así en `infra/docker-compose.yml`). |
| `git push` → 403 "Claude doesn't have GitHub access" | Reconectar GitHub en claude.ai e instalar la Claude GitHub App en el repo. Reintentar no sirve. |
| `dotnet ef` no existe | `dotnet tool restore` (manifiesto `dotnet-tools.json` en la raíz). |

Navegador para pruebas manuales: Playwright y Chromium vienen preinstalados (`require('playwright')`).

## Uso eficiente de la IA (tokens)

- Una tarea pequeña por sesión; limpiar el contexto al terminar.
- Referenciar archivos por ruta, no pegarlos.
- Modo plan antes de cambios grandes.
- Búsquedas amplias en el código → subagente.
- Logs: solo el fragmento relevante.
- Si la IA repite un error, la corrección va al `CLAUDE.md` que corresponda.
- Procedimientos repetidos → convertirlos en skill en `.claude/skills/`.
- Lo aprendido al depurar se anota en "Trampas conocidas" del `CLAUDE.md` de la app (o en la tabla de arriba si es del entorno), en el mismo PR. Así la siguiente sesión no lo redescubre.
- Para retomar una feature basta leer: el issue, `plan.md` (tarea y sección "Estado") y el `CLAUDE.md` de la app que se toca.

## Convenciones

- Conventional Commits.
- Ramas: `feat/`, `fix/`, `docs/`, `chore/`.
- Decisiones de arquitectura → ADR en `docs/adr/` (skill `escribir-adr`).
