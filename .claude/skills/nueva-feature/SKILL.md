---
name: nueva-feature
description: Crea la spec y el plan de una nueva funcionalidad de Walkie y su issue en GitHub. Usar cuando se pida empezar, proponer o especificar una feature nueva.
---

# Nueva feature

1. Pide (si no está claro) el nombre corto de la feature y su objetivo en una frase. Genera un slug en kebab-case.
2. Copia `docs/features/_plantilla/spec.md` a `docs/features/<slug>/spec.md` y complétala:
   - Objetivo en una frase.
   - Criterios de aceptación verificables (formato Dado/Cuando/Entonces).
   - Fuera de alcance explícito.
   - Impacto en `packages/schema` y en la API (revisa el schema actual antes de proponer cambios).
   - Preguntas abiertas en lugar de suposiciones.
3. Muestra la spec y **espera aprobación** antes de seguir.
4. Con la spec aprobada, copia `docs/features/_plantilla/plan.md` y descompón el trabajo en tareas que quepan en un PR cada una (schema → API → web → pruebas).
5. Crea los issues con GitHub CLI si está disponible:
   `gh issue create --title "<feature>: <tarea>" --label "feature/<slug>" --body "Tarea N de docs/features/<slug>/plan.md"`
   y anota los números en `plan.md`.
6. Commit: `docs(<slug>): spec y plan`.

No escribas código de implementación en esta skill.
