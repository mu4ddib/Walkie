# Spec: eliminar apps y features

## Objetivo

Que el owner de una app pueda eliminar una feature o la app entera desde la interfaz, viendo antes qué se pierde, sin dejar datos huérfanos ni accesos abiertos en ningún módulo y sin tocar lo de otras apps ni otros lienzos (ADR-0017).

## Criterios de aceptación

**Feature**

- [ ] Dado que soy owner, cuando abro el menú de una tarjeta de la galería, entonces veo «Eliminar feature…»; un editor o un viewer no lo ven y la API les responde 403.
- [ ] Al elegirla, un diálogo muestra el nombre, cuántas cajas y conexiones tiene su lienzo, sus tours y recorridos, los enlaces públicos que dejarán de funcionar, las features con portales hacia ella, si viene de Walkie Live y que es **definitivo**.
- [ ] Si otra feature tiene un portal hacia ella, el diálogo las nombra y no deja eliminar (409 en la API) hasta resolverlas.
- [ ] Al confirmar, la feature desaparece de la galería y del mapa, sus enlaces dejan de funcionar, sus imágenes exclusivas se borran (las que usa otro lienzo se conservan), el catálogo y los lienzos de otras features no cambian.
- [ ] Si alguien guardó su lienzo después de ver el resumen, responde 409 y no borra nada.
- [ ] Si vino de Walkie Live, su vínculo se conserva y la revisión siguiente dice que el destino ya no existe y deja decidir de nuevo.

**App**

- [ ] Dado que soy owner, en la página de la app hay una sección «Administración» con «Eliminar app…» (no junto a «Crear feature»).
- [ ] El diálogo muestra cuántas features, módulos, elementos del catálogo, imágenes, enlaces, miembros y análisis de Walkie Live se eliminan, sugiere exportar antes y pide escribir el nombre de la app.
- [ ] Al confirmar, vuelvo a la galería con un aviso; la app no aparece para ningún miembro y sus rutas responden 404; sus enlaces públicos dejan de funcionar; no quedan filas ni archivos de la app en ningún módulo; otra app sigue intacta.
- [ ] Si una aplicación o importación de Walkie Live está en curso, responde 409 sin borrar nada.
- [ ] Si un paso falla a mitad, la app ya no es accesible, la respuesta lo dice (202) y la eliminación se termina sola después; la bitácora dice qué paso falló.

**Comunes**

- [ ] 401 sin sesión; 404 a quien no es miembro o si no existe; 403 a un rol menor; 204 solo con la eliminación completa.
- [ ] Repetir la eliminación con el mismo id no duplica ni falla; tras perder la respuesta, `GET /api/deletions/{id}` dice cómo terminó.
- [ ] Diálogos accesibles: foco dentro, Escape cancela antes de confirmar, todo por teclado, botones deshabilitados mientras corre.

## Fuera de alcance

- Papelera o recuperación (ADR-0017 lo deja para después).
- Borrar portales de otras features automáticamente (`force`).
- Eliminar módulos desde la galería (ya tienen su acción).
- Eliminar elementos sueltos del catálogo (ya existe).

## Impacto en schema / API

- `packages/schema/walkie-deletion-impact.schema.json` (impacto y bloqueos) y `walkie-deletion.schema.json` (estado de una eliminación).
- `GET /api/features/{featureId}/deletion`, `DELETE /api/features/{featureId}?deletionId=&canvasVersion=`, `GET /api/apps/{appId}/deletion`, `DELETE /api/apps/{appId}?deletionId=&confirmName=`, `GET /api/deletions/{deletionId}`.
- Apps: columnas `deleting_at` en apps y features, tabla `apps.deletions`, contrato `IDeletionParticipant` implementado por Sharing, Discovery, Canvas y Files.

## Preguntas abiertas

- Ninguna: la política la fija ADR-0017.
