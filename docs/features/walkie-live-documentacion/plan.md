# Plan: Walkie Live — documentación descubierta y lienzos legibles

Basado en `spec.md` y ADR-0018. Rama `feat/walkie-live-documentacion`, desde `main`. Un commit por incremento.

## Tareas

1. [x] Arquitectura descubierta permanente: estado de cada hallazgo, propuesta y grupo (la clasificación de la revisión, `ReviewHandlers.StatesAsync`), enlaces a lo documentado, acceso desde la app y al análisis anterior.
2. [x] Pantallas independientes: `create` sobre una pantalla, `attach` a una feature existente (`ICanvasWriter.AppendAsync`/`DetachUntouchedAsync`), portales en el borrador, inspector con las tres opciones.
3. [x] Lienzos legibles: medir el lienzo inicial actual; distribución por relaciones (capas por navegación, APIs junto a quien las llama, menos cruces); vistas de presentación (resumen, interacciones, completa); rutas en pantallas homónimas; zoom legible.
4. [x] Inspector de la revisión: traer la corrección de `fix/inspector-revision-discovery`.
5. [x] Regresión, casos A–H, Chromium y WebKit, rendimiento, capturas e informe.

## Revisión final (ajustes pedidos)

6. [x] Geometría en la API:
   - `BoxSizes` estima el tamaño dibujado, con la misma fórmula en la web y prueba de paridad;
   - `Graph` y `Additions` rechazan con la caja con que chocan y el tamaño y la posición de las dos;
   - una incorporación por feature y por solicitud.
7. [x] Resumen compacto: posiciones de presentación (`compactPositions`), vuelta exacta a «Completa», transición.
8. [x] Geometría del Canvas real en Chromium y WebKit: cajas, etiquetas, cruces, flechas, área libre, saltos y costo por fase.
9. [x] WebKit:
   - `sesion-navegacion.spec.ts` aísla la caída del proceso de red con el servidor de desarrollo; las E2E de WebKit usan la compilación de producción;
   - arreglo de la carrera al volver del login.
10. [x] Rendimiento de la arquitectura por fase, sin N+1 (9 consultas fijas); causa de 193 → 470 ms.

## Estado

Última actualización: 2026-11-21, nube — **listo para revisión final** (rama `feat/walkie-live-documentacion`, Draft PR, sin merge).

**Pruebas**

| Suite | Resultado |
| --- | --- |
| API | 702/702 |
| CLI | 104/104 |
| Web (Vitest), más lint y build | 581/581 |
| E2E Chromium, suite entera | 89/89 |

**WebKit, suite entera contra la compilación de producción:** 79 pasan y 10 no.

- Las 10 fallan también en `main` con WebKit, las mismas u otras de esos specs: 7 fallidas y 5 por tiempo en la misma corrida, y `imagenes-portal` 4 de 5 en `main` contra 1 de 3 en la rama.
- Son límites conocidos del motor en Linux headless: permisos de portapapeles, cuadros lentos, scroll y desbordes de 1 px.
- No son regresiones de esta rama.
- Las específicas de esta spec pasan en WebKit: legibilidad, sesión e inspector.

**Medidas:** en `medidas-lienzo.md`.