#!/usr/bin/env bash
set -euo pipefail

# pnpm fijo vía corepack (versión en apps/web/package.json -> packageManager)
corepack enable

# .env local a partir del ejemplo (nunca se versiona)
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Creado .env desde .env.example"
fi

# Restaurar dependencias si los proyectos ya existen
if ls apps/api/*.sln >/dev/null 2>&1 || ls apps/api/src >/dev/null 2>&1; then
  dotnet restore apps/api || true
fi
if [ -f apps/web/package.json ]; then
  (cd apps/web && pnpm install)
fi

echo "Walkie devcontainer listo. Lee CLAUDE.md y docs/workflow.md."
