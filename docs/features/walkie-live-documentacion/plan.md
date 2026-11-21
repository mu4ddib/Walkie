# Plan: Walkie Live — documentación descubierta y lienzos legibles

Basado en `spec.md` y ADR-0018. Rama `feat/walkie-live-documentacion`, desde `main`. Un commit por incremento.

## Tareas

1. [x] Arquitectura descubierta permanente: estado de cada hallazgo, propuesta y grupo (la clasificación de la revisión, `ReviewHandlers.StatesAsync`), enlaces a lo documentado, acceso desde la app y al análisis anterior.
2. [x] Pantallas independientes: `create` sobre una pantalla, `attach` a una feature existente (`ICanvasWriter.AppendAsync`/`DetachUntouchedAsync`), portales en el borrador, inspector con las tres opciones.
3. [x] Lienzos legibles: medir el lienzo inicial actual; distribución por relaciones (capas por navegación, APIs junto a quien las llama, menos cruces); vistas de presentación (resumen, interacciones, completa); rutas en pantallas homónimas; zoom legible.
4. [x] Inspector de la revisión: traer la corrección de `fix/inspector-revision-discovery`.
5. [x] Regresión, casos A–H, Chromium y WebKit, rendimiento, capturas e informe.

## Estado

Última actualización: 2026-11-21, nube — **listo para revisión** (rama `feat/walkie-live-documentacion`, sin PR ni merge).

- Tareas 1 a 5 hechas, un commit por incremento.
- API 684/684, CLI 104/104, web 573/573 + lint + build; E2E Chromium (suite entera) y WebKit (inspector y legibilidad).
- Medidas del lienzo en `medidas-lienzo.md`.
- Walkie analizándose: 88 hallazgos y 366 relaciones (en `main`, 89 y 362). Todas las diferencias vienen de esta rama:
  - sale la propuesta «Discovery review»: la página de la app enlaza directo a la arquitectura;
  - entran las navegaciones de la arquitectura a lo documentado;
  - entra la lectura del lienzo al incorporar una pantalla;
  - `apply` lee `CanvasDbContext`;
  - la revisión ya no lee `AppsDbContext` directo.
- Pendiente conocido: en WebKit (Linux headless) a veces se pierde la sesión o la galería no carga en los helpers de login. No es un fallo de geometría: toda prueba que llega al lienzo pasa.
