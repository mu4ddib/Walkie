# Spec: Espacio de trabajo (rediseño de UI/UX)

- Issue padre: #94
- Estado: aprobada (2026-11-08, el autor pidió avanzar sin aprobar cada detalle)
- Mejora transversal sobre las fases 1 a 4. No agrega fases al roadmap: cambia cómo se usa lo que ya existe y amplía el modelo donde hace falta.

## Objetivo

Que Walkie abra directo en el lienzo, que crear, conectar, documentar y reutilizar elementos sea evidente, y que la interfaz tenga una identidad visual cálida (arena, crema, piedra, acentos especiados) con detalle técnico progresivo.

## Usuarios

- Autor: documenta flujos; quiere llegar al lienzo sin pasar por pantallas vacías y documentar APIs y bases de datos con detalle.
- Lector: recorre flujos y tours; necesita jerarquía visual clara y conexiones que expliquen qué pasa.

## Estado actual (auditoría del 2026-11-08)

- Para llegar al lienzo hay que pasar por Apps → App → Feature, cada una un formulario con una lista.
- Paleta (200 px) y panel (280 px) fijos; el lienzo pierde ~40 % del ancho. Bordes negros de 4 px en todo: nada destaca.
- Texto del panel en VT323 a 16 px: cómodo para títulos, no para leer contratos o formularios.
- El nodo ya muestra tipo con color, imagen, `MÉTODO /ruta`, inputs y expresión; el panel edita por tipo. `http.request` y `http.responses` existen en el schema pero sin estructura ni UI.
- Catálogo: página aparte; en el lienzo solo una lista en la paleta. "Mover al catálogo" existe pero se descubre poco; no hay copia independiente.
- Features: sin descripción ni fecha de actualización; la API no expone vistas previas del lienzo.
- No hay grupos, ni animación de conexiones, ni recuerdo de la última posición.

## Criterios de aceptación

**1. Lienzo primero y navegación (tarea 1)**

- [x] 1. Dado que abro Walkie y tengo una sesión anterior, entonces se abre la última app y feature, con el zoom y la posición del lienzo donde los dejé.
- [x] 2. Dado mi primer ingreso (sin apps), entonces veo el espacio de trabajo con una bienvenida breve que pide nombre de app y de primera feature y abre el lienzo; o "Cargar ejemplo", que crea una app marcada "(ejemplo)" con un flujo de muestra.
- [x] 3. Dado el editor, entonces una barra superior compacta muestra dónde estoy (app / feature, con selectores para cambiar o crear sin salir), el estado de guardado y las acciones (Guardar, Exportar, Compartir, Ayuda).
- [x] 4. Dado el editor, entonces una barra de herramientas flotante agrega cada tipo de nodo (clic, arrastre o teclas 1–7) con tooltip; el panel derecho se pliega y recuerda su estado; con el lienzo vacío hay una guía con acciones rápidas.
- [x] 5. Dado el editor, entonces "?" abre los atajos (agregar, conectar, borrar, editar, zoom, guardar, plegar panel) y una pista contextual abajo explica la siguiente acción posible.
- [x] 6. Dado cualquier pantalla, entonces la paleta visual es arena/crema/piedra con acentos cálidos, los tipos de nodo conservan su color, el texto de formularios y contenido usa una fuente legible (la pixelada queda para marca y títulos), y botones, campos y elementos del lienzo tienen hover, foco visible, selección y transiciones consistentes.

**2. Apps y features (tarea 2)**

- [ ] 7. Dada una app, entonces sus features se ven como tarjetas con nombre, descripción, miniatura real del lienzo guardado y fecha de actualización; con búsqueda y orden; "Nueva feature" está separada de las existentes.
- [ ] 8. Dada una feature, puedo renombrarla y editar su descripción. Las apps se ven como tarjetas con su cantidad de features.
- [ ] 9. Dada una app o lista vacía, entonces el estado vacío explica qué es y ofrece la acción principal (y el ejemplo).

**3. Catálogo (tarea 3)**

- [ ] 10. Dado el editor, entonces un panel "Componentes" explica el catálogo, permite buscar, filtrar por tipo, arrastrar al lienzo y crear un componente nuevo sin salir.
- [ ] 11. Dado un nodo api/service/database local, puedo "Guardar como componente"; dado un nodo del catálogo, puedo "Crear copia independiente" (vuelve a ser local con los datos actuales).
- [ ] 12. Dado un componente, el lienzo lo distingue de un nodo local; al editarlo, el inspector separa "Definición compartida" (con "Se usa en N lienzos" y la lista antes de guardar) de "En este lienzo" (lo propio del uso).

**4. Inspector técnico (tarea 4)**

- [ ] 13. Dada una API (local o del catálogo), el inspector documenta método, ruta, descripción, autenticación, parámetros (ruta, query, header), request y responses (campos con tipo, obligatorio, descripción y ejemplo JSON) con códigos y errores; el nodo muestra solo un resumen.
- [ ] 14. Dada una base de datos, el inspector documenta motor, base, schemas y tablas/colecciones con campos (tipo, clave, nulo) y relaciones.
- [ ] 15. Dada una conexión, el inspector documenta la interacción: tipo, etiqueta, condición, notas, operación de datos (lee/escribe) y entidades, y un ejemplo de payload propio; el contrato reutilizable queda en la API, no se duplica.
- [ ] 16. Dado actor, pantalla, regla, servicio o portal, el inspector solo muestra sus campos (responsabilidades, reglas, referencias…).
- [ ] 17. Todo lo anterior se guarda y vuelve igual al recargar; la API valida los nuevos campos (400 si no cumplen el schema).

**5. Grupos de infraestructura (tarea 5)**

- [ ] 18. Puedo crear un grupo (frontend, backend, externos, datos, red, entorno, cloud o libre) con nombre y límite visual; arrastrar un nodo dentro lo incluye; mover el grupo mueve sus nodos.
- [ ] 19. Un grupo plegado se ve como una caja compacta con su nombre y número de nodos; las conexiones de sus nodos llegan a la caja.
- [ ] 20. Los grupos se guardan con el lienzo y no se confunden con apps ni features.

**6. Conexiones con movimiento y tours (tarea 6)**

- [ ] 21. Al seleccionar o pasar por una conexión, una animación direccional sutil muestra el sentido; un interruptor la desactiva; con `prefers-reduced-motion` no se anima. El texto de ayuda deja claro que es un flujo documentado, no tráfico real.
- [ ] 22. Solicitudes, respuestas, eventos y accesos a datos se distinguen por trazo y marca, con etiquetas legibles que no se tapan.
- [ ] 23. En un tour, el paso resalta su nodo y las conexiones que llegan o salen de él, animando la que lleva al siguiente paso.

**7. Validación (tarea 7)**

- [ ] 24. E2E del recorrido completo: primer ingreso → app y feature → nodos → conexión → documentación técnica → componente compartido → grupo → recargar idéntico; capturas en 1440, 1024 y 768 px de ancho.

## Fuera de alcance

- Colaboración en tiempo real, comentarios, historial de versiones.
- Borrar apps o features (renombrar sí entra).
- Importar OpenAPI (post-MVP, roadmap) y validar ejemplos JSON contra el contrato.
- Sprites o ilustraciones nuevos: se usan recursos provisionales y se listan los que harían falta.
- Tráfico real, monitoreo o ejecución de requests.

## Impacto en el modelo

- `walkie-graph.schema.json` (sigue siendo v0 con campos opcionales; todo grafo guardado sigue siendo válido):
  - `node.http`: `auth`, `params[]` y `request`/`responses` con estructura (campos, ejemplo); se reemplaza la forma libre actual, que ningún cliente usa.
  - `node.database`: `engine`, `name`, `schemas[]`, `tables[]` (campos, claves, relaciones).
  - `node.notes` (responsabilidades/notas de actor, servicio, regla, portal).
  - `edge.notes`, `edge.data` (`operation: read|write`, `entities[]`), `edge.example`.
  - `groups` (mapa id → `{ id, title, kind, collapsed }`), `node.groupId`, y `layout` del grupo (x, y, w, h).
- `walkie-catalog-item.schema.json`: el elemento guarda el mismo `http` o `database` estructurado (definición compartida).
- `Feature`: `description` y `updatedAt` (migración en `apps`).

## Impacto en la API

- Tarea 2: `PUT /api/features/{featureId}` (nombre y descripción); `GET /api/apps/{appId}/features` suma `description` y `updatedAt`; `GET /api/apps/{appId}/canvas-previews` (Canvas) devuelve por feature la versión, la fecha y una vista mínima (tipo y caja de cada nodo) para la miniatura.
- Tarea 3: catálogo sin endpoints nuevos (crear, editar con versión, usos y borrar ya existen).
- Tarea 4: el catálogo guarda el contrato en una columna `jsonb` (migración); `GraphValidator` y los validadores siguen al schema.

## Decisiones tomadas

1. El lienzo es la pantalla de inicio; la sesión (última app, feature y vista) vive en `localStorage` del navegador: no es dato compartido.
2. Tipografía: Press Start 2P para marca y títulos cortos; IBM Plex Sans para interfaz y contenido; IBM Plex Mono para rutas, tipos y JSON. VT323 sale.
3. Paleta arena/crema/piedra con acento especia; sombras suaves y cortas (se actualiza la regla "sin sombras difusas" de `apps/web/CLAUDE.md`). Bordes de 2 px.
4. Animación de conexiones: solo en selección, hover o tour, desactivable y sin animar con movimiento reducido.
5. Los grupos son parte del grafo de la feature (no de la app).
