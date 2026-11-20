# Spec: Walkie Live — documentación descubierta y lienzos legibles

- Estado: aprobada (pedido del 2026-11-20, después de analizar el propio Walkie)
- ADR: ADR-0016 (arquitectura calculada), ADR-0012 y ADR-0014 (decisiones y procedencia), **ADR-0018** (incorporar una pantalla a una feature existente)

## Objetivo

Que Walkie Live documente una app real de forma comprensible: la arquitectura descubierta sigue disponible después de decidir todo, cualquier pantalla descubierta se puede incorporar (también las que ninguna propuesta incluye, como `Home`), y los lienzos que genera se entienden sin reacomodar cada caja. Nunca se toca documentación humana sin consentimiento.

## Usuarios

Equipos que documentan su app con Walkie Live (desarrollo y onboarding) y vuelven a analizarla con el tiempo.

## Criterios de aceptación

### Parte 1 — Arquitectura descubierta permanente

- [ ] Dado un análisis con todo decidido (vinculado, creado o descartado), cuando abro su arquitectura, entonces veo todos sus hallazgos y relaciones (los mismos totales que antes de decidir).
- [ ] Cada hallazgo y cada propuesta dice su estado en Walkie, el mismo de la revisión: nuevo, coincide, ya en Walkie (vinculado o creado), descartado, cambió, sin cobertura, y si el elemento documentado se borró.
- [ ] Lo documentado enlaza a su elemento (catálogo, módulo o lienzo de la feature).
- [ ] Cada grupo dice cuántos faltan por decidir y cuántos ya están en Walkie.
- [ ] La arquitectura se abre desde la página de la app («Arquitectura» en cada fuente) y desde la revisión, sin depender de que queden pendientes; desde ella se abre la del análisis anterior.
- [ ] Un reanálisis conserva las decisiones (las APIs creadas siguen apuntando a su elemento), marca lo nuevo y se compara con el anterior.

### Parte 2 — Pantallas independientes

- [ ] Dada una pantalla nueva sin feature (ej. `Home` en `/`), el inspector ofrece «Crear feature desde esta pantalla», «Incorporar a una feature existente…» y dejarla pendiente (además de descartar).
- [ ] Crear feature: nombre editable (por defecto, el de la pantalla), vista previa con la pantalla, su ruta, sus llamadas a APIs ya en el catálogo y su navegación hacia pantallas ya documentadas en otras features (portales); lo que no entra, con el porqué; las APIs pendientes se pueden crear en la misma solicitud. Mismo `applyId` en vista previa, confirmación y reintento.
- [ ] Incorporar a una feature existente (elegida por la persona, nunca por nombre o ruta): la vista previa muestra lo que ya tiene el lienzo (cajas y conexiones), lo que se agrega, lo que se reutiliza (una API o un portal que ya están), las APIs sin decidir y los posibles duplicados; confirmar agrega sin mover ni borrar nada, con la versión que se vio (si el lienzo cambió, 409 y nueva vista previa).
- [ ] La procedencia queda: vínculo de la pantalla (fuente, análisis, clave, fingerprint, decisión, destino), visible en «De dónde viene» de la feature. Un reanálisis no duplica.

### Parte 3 — Lienzos comprensibles

- [ ] El lienzo inicial de una feature generada se distribuye por relaciones (pantallas por flujo de navegación, cada API cerca de las pantallas que la llaman, cruces minimizados), determinista; medido antes y después (cruces, largo de conexiones, superposición, tamaño, zoom).
- [ ] El lienzo tiene tres vistas de presentación sobre el mismo grafo (no cambian lo guardado): resumen funcional, interacciones de lo elegido y arquitectura completa.
- [ ] Pantallas con el mismo nombre muestran su ruta como dato secundario.
- [ ] Un lienzo no se abre con un zoom ilegible.

### Parte 4 — Documentación humana

- [ ] Ningún lienzo existente se reorganiza, ninguna posición manual cambia, ningún tour, recorrido o portal se toca sin una acción explícita; un análisis parcial no borra nada.

### Parte 5 — Inspector de la revisión

- [ ] Corrección de `fix/inspector-revision-discovery` (no estaba en `main`): cabe en la zona visible, scroll propio sin encadenar, responsive; Chromium y WebKit.

## Fuera de alcance

- Reorganizar automáticamente lienzos existentes (si se ofrece, es una acción manual con vista previa y deshacer).
- Inferir respuestas, transacciones o SQL.
- Procedencia por caja (el vínculo es de la pantalla a la feature, como hasta ahora).

## Impacto en el modelo

- `walkie-discovery-architecture`: `state` en propuestas, `states` por grupo, `previousSnapshotId`. `walkie-discovery-architecture-group`: `state` en cada hallazgo. Solo campos opcionales nuevos.
- `walkie-discovery-apply`: `create` admite una pantalla (crea una feature); operación nueva `attach` (ADR-0018) con `target` (feature) y `canvasVersion`.
- `walkie-discovery-apply-result`: el borrador puede traer cajas `portal` y cajas existentes que se reutilizan.

## Impacto en la API

- `GET /api/snapshots/{id}/architecture` y `.../architecture/group`: los campos de arriba (misma clasificación que la revisión).
- `POST /api/snapshots/{id}/apply`: `create` sobre `screen:…` y `attach` (ver ADR-0018). Errores: 400 (validación, con ruta), 409 (versión del vínculo o del lienzo).

## Preguntas abiertas

- Ninguna bloqueante: las decisiones de alcance están en el plan.
