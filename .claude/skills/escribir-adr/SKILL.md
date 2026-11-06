---
name: escribir-adr
description: Registra una decisión de arquitectura de Walkie como ADR en docs/adr. Usar cuando se elija una tecnología, un patrón o se cambie una decisión previa.
---

# Escribir ADR

1. Lista `docs/adr/` y toma el siguiente número (4 dígitos).
2. Copia `docs/adr/0000-plantilla.md` a `docs/adr/<NNNN>-<slug>.md`.
3. Completa con hechos de la conversación o del código:
   - Contexto: el problema concreto.
   - Al menos dos opciones reales con pros y contras.
   - Decisión en 2-4 frases.
   - Consecuencias, incluido el costo de revertirla.
4. Si reemplaza un ADR anterior, cambia el estado de ese ADR a "reemplazado por ADR-<NNNN>".
5. Si la decisión cambia comandos, estructura o reglas, actualiza el `CLAUDE.md` correspondiente y `docs/architecture.md` en el mismo commit.
6. Commit: `docs(adr): <NNNN> <título>`.

Máximo una página. Si falta información para decidir, deja la sección "Opciones" y marca el estado como "propuesto".
