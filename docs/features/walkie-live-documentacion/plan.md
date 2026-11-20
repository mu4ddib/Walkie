# Plan: Walkie Live — documentación descubierta y lienzos legibles

Basado en `spec.md` y ADR-0018. Rama `feat/walkie-live-documentacion`, desde `main`. Un commit por incremento.

## Tareas

1. [ ] Arquitectura descubierta permanente: estado de cada hallazgo, propuesta y grupo (la clasificación de la revisión, `ReviewHandlers.StatesAsync`), enlaces a lo documentado, acceso desde la app y al análisis anterior.
2. [ ] Pantallas independientes: `create` sobre una pantalla, `attach` a una feature existente (`ICanvasWriter.AppendAsync`/`DetachUntouchedAsync`), portales en el borrador, inspector con las tres opciones.
3. [ ] Lienzos legibles: medir el lienzo inicial actual; distribución por relaciones (capas por navegación, APIs junto a quien las llama, menos cruces); vistas de presentación (resumen, interacciones, completa); rutas en pantallas homónimas; zoom legible.
4. [ ] Inspector de la revisión: traer la corrección de `fix/inspector-revision-discovery`.
5. [ ] Regresión, casos A–H, Chromium y WebKit, rendimiento, capturas e informe.

## Estado

Última actualización: 2026-11-20, nube — en curso.
