# Walkie

**Walk through any app, one flow at a time.**

Walkie is an interactive canvas for documenting how your organization's apps actually work: screens, inputs, business rules, API calls, services, and data, all connected in a single visual flow. Guided tours let anyone walk through those flows step by step, which makes Walkie useful for onboarding new team members, presenting new features, and understanding an app's scope and how its components fit together.

> Status: pre-MVP. See [docs/vision.md](docs/vision.md) and the [roadmap](docs/roadmap.md).

## Core ideas

- **One canvas per feature.** An app is split into features (login, transfers, profile). Each feature has its own canvas and tours.
- **Shared catalog.** APIs, services and databases are defined once per app and referenced from any canvas.
- **Portals.** A node that jumps to another feature, so you can walk the whole app without a giant canvas.
- **Tours.** Step-by-step guided walkthroughs with a pixel-art guide.

## Tech stack

| Layer | Tech |
| --- | --- |
| Web | React + TypeScript + Vite, React Flow, Zustand, TanStack Query |
| API | ASP.NET Core (.NET 10), modular monolith |
| Data | PostgreSQL (`jsonb` for canvases), S3-compatible storage (RustFS locally, ADR-0004) |
| Contract | JSON Schema in `packages/schema` |
| Dev environment | Dev Container / GitHub Codespaces |

## Getting started

The only requirement is Docker plus VS Code (with the Dev Containers extension) or a GitHub Codespace.

```bash
git clone https://github.com/mu4ddib/Walkie.git
cd Walkie
# VS Code: "Dev Containers: Reopen in Container"
# or create a Codespace from GitHub
```

The container installs .NET, Node, and the GitHub CLI, then starts Postgres and RustFS (S3) automatically.

## Repository layout

```
apps/web        React front end
apps/api        ASP.NET Core API
packages/schema Canvas graph JSON Schema (source of truth)
infra/          docker-compose and, later, IaC
docs/           vision, architecture, ADRs, feature specs, workflow
.claude/skills  AI-assisted procedures for this repo
```

## How we work

Read [docs/workflow.md](docs/workflow.md): spec-driven features, one issue per task, docs updated in the same PR as the code.
