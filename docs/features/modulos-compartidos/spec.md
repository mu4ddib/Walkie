# Spec: Módulos compartidos

- Issue padre: #155
- Estado: implementada (2026-11-13)

## Objetivo

Reutilizar en varias features un conjunto de componentes conectados (APIs, servicios, bases, recursos, grupos y sus conexiones) como un **módulo**: se define una vez en su propio lienzo, se coloca en cada feature como una caja que expone **interfaces** y se recorre por dentro sin perder el contexto.

## Usuarios

Equipos que documentan varias features que llaman a lo mismo (ej. un módulo «Usuarios» que usan registro, login y perfil) y quien hace onboarding: ve el diagrama de alto nivel y entra al detalle solo cuando lo necesita.

## Conceptos

- **Módulo**: definición compartida de la app con nombre, descripción, lienzo propio e interfaces. Se guarda como una feature de tipo `module` (ADR-0010): mismo lienzo, mismo guardado con versión, mismo editor. No aparece en la galería, el mapa ni los selectores de features.
- **Interfaz**: punto de conexión del módulo vinculado a una caja de su lienzo (`interfaces` del grafo del módulo: `id` estable, `name`, `description`, `kind` y `nodeId`; opcional `tourId`, su recorrido interno). Tipos: `provides` (API u operación ofrecida), `event` (evento que emite o recibe) y `requires` (dependencia que el módulo necesita de fuera). El contrato (método, ruta…) es el de la caja interna (o el de su componente del catálogo).
- **Referencia a módulo**: nodo `module` de un lienzo con `moduleId` y su presentación local (`display`; posición y tamaño en `layout`). Una conexión que llega o sale de él puede apuntar a una interfaz (`toInterface` / `fromInterface`: id y último nombre conocido) o al módulo completo (sin ese campo).

## Criterios de aceptación

### Catálogo

- [x] 1. Dado el panel del catálogo del lienzo, cuando lo abro, entonces veo dos pestañas, «Componentes» y «Módulos», con una búsqueda común; cada módulo muestra nombre, descripción y número de interfaces, y se agrega con clic o arrastre.
- [x] 2. Dada la página del catálogo, cuando entro, entonces hay una sección «Módulos» con sus interfaces, usos, «Abrir», «Nuevo módulo» (nombre y descripción, crea uno vacío y lo abre) y «Eliminar» (que antes muestra dónde se usa).
- [x] 3. Dado un módulo usado en tres features, cuando cambio su definición (cajas, conexiones, nombre, descripción o interfaces) y guardo, entonces las tres lo muestran actualizado sin cambiar la posición ni el tamaño de su caja en cada una.
- [x] 4. Dado un módulo con componentes del catálogo dentro, cuando lo uso, entonces esos `ref` siguen siendo del catálogo (mismo contrato y mismos usos).

### Creación y conversión

- [x] 5. Dada una selección de cajas o un grupo (con subgrupos), cuando elijo «Convertir en módulo», entonces un diálogo de cinco pasos pide nombre y descripción, lista lo incluido (con los grupos anidados), las conexiones que cruzan el límite, las interfaces propuestas y las dependencias externas, y explica qué pasa con tours y recorridos antes de confirmar.
- [x] 6. Dada una base de datos fuera de la selección conectada a algo de dentro, cuando reviso las conexiones, entonces puedo incluirla en el módulo o dejarla como dependencia externa (una interfaz `requires`).
- [x] 7. Dado que confirmo, entonces lo seleccionado pasa al lienzo del módulo con sus posiciones relativas, conexiones internas, contratos, notas y solicitudes/respuestas (`replyTo`); en la feature queda una caja del módulo en su lugar y cada conexión externa llega a la interfaz que le corresponde, con el mismo id (los pasos de recorrido que la usan siguen valiendo).
- [x] 8. Dado un tour o recorrido que pasaba por lo convertido, entonces los pasos de nodo apuntan a la caja del módulo, los de conexiones que cruzan se conservan y los de conexiones internas pasan a un recorrido interno del módulo con el mismo nombre (enlazado desde la interfaz); el diálogo lo dice antes de confirmar, igual que las reglas o ramas que pierden su vínculo.
- [x] 9. Dado que la conversión falla a mitad (red, 409, 400), entonces no queda nada a medias: el módulo creado se borra y la feature sigue igual; reintentar con el mismo diálogo no duplica el módulo.
- [x] 10. Dada una conversión hecha, cuando pulso Ctrl+Z, entonces la feature vuelve a tener lo que había (el módulo queda en el catálogo, sin usos desde ella).

### Interfaces y conexiones

- [x] 11. Dada una caja del módulo, cuando suelto una conexión sobre ella (o la saco de ella), entonces se abre un selector compacto y con búsqueda con sus interfaces (nombre, tipo, método y ruta) y «Módulo completo»; Esc cancela.
- [x] 12. Dada una conexión a una interfaz, entonces su etiqueta y su tipo por defecto salen de la caja interna (`llama · GET /usuarios/{id}`); el inspector dice si apunta al módulo completo o a una interfaz y permite cambiarlo.
- [x] 13. Dada una solicitud a una interfaz, cuando agrego su respuesta, entonces la respuesta sale de la misma interfaz y conserva `replyTo`.
- [x] 14. Dada una interfaz usada, cuando la renombro o renombro su caja interna, entonces las conexiones siguen unidas (por id) y muestran el nombre nuevo.
- [x] 15. Dada una interfaz usada, cuando la elimino, entonces antes veo qué conexiones de qué features la usan y puedo reasignarlas a otra interfaz, pasarlas al módulo completo o dejarlas pendientes (conservan el último nombre y se marcan para reparar).
- [x] 15b. Quitar una interfaz es un cambio del módulo (se deshace y se guarda con él): las features no se reescriben, resuelven sus conexiones con las redirecciones del módulo y un editor abierto no recibe 409.
- [x] 15c. Cada interfaz usada tiene su punto de conexión en la caja; soltar una conexión ahí la elige sin selector y la flecha llega a su fila.
- [x] 19b. «Volver» funciona en cada nivel de módulos anidados.
- [x] 21b. Un enlace de solo lectura muestra las cajas de los módulos y los abre de solo lectura, con «Volver».
- [x] 25b. El contexto para IA, el Markdown y el PDF describen cada módulo que usa la feature (interfaces, contenido y conexiones internas) y la interfaz de cada conexión.
- [x] 16. Dada una referencia a un módulo eliminado (o a una interfaz que ya no existe), entonces la caja (o la conexión) lo indica con el último nombre conocido y permite reasignarla.

### Caja e inspector

- [x] 17. La caja muestra el nombre, el distintivo «Módulo», la descripción breve (si existe) y solo las interfaces usadas en ese lienzo, con «Abrir módulo» y «Ver interfaces»; el resto se consulta en el inspector.
- [x] 18. El inspector separa «En este lienzo» (mostrar u ocultar descripción e interfaces) de «Definición compartida» (nombre y descripción, que avisan que cambian en todas las features) y ofrece «Crear copia independiente» como acción explícita; duplicar la caja (Ctrl+D) sigue apuntando al mismo módulo.

### Navegación

- [x] 19. Dada la caja de un módulo, cuando pulso «Abrir módulo» (o doble clic), entonces se abre su lienzo en el editor habitual con una franja «Módulo · <nombre> · Definición compartida · Ver usos» y «← Volver a <feature>»; al volver, la feature conserva zoom, posición y selección.
- [x] 20. Dada una interfaz, cuando la abro, entonces el lienzo del módulo se abre con su caja interna seleccionada y centrada.
- [x] 21. «Ver usos» lista las features que referencian el módulo y abre cada una con la caja seleccionada.

### Consistencia y persistencia

- [x] 22. El guardado manual y el automático funcionan igual en un módulo; dos ediciones de la misma definición se protegen con la versión (409) y una respuesta de guardado vieja no pisa cambios recientes.
- [x] 23. Los lienzos anteriores cargan igual (los campos nuevos son opcionales y el schema sigue en `schemaVersion` 0); la API rechaza con 400 un `moduleId` de otra app, una feature que no es módulo, interfaces fuera de un módulo, interfaces a cajas que no existen y ciclos de contención (un módulo que se contiene a sí mismo, directa o indirectamente). Dos módulos que se llaman entre sí por conexiones no son un ciclo.

### Tours y recorridos

- [x] 24. Dado un recorrido de una feature que pasa por una interfaz con recorrido interno, cuando lo reproduzco y llego a ese paso, entonces «Ver dentro del módulo» abre el módulo reproduciendo su recorrido interno; «← Volver» regresa a la feature en el mismo paso.

### Importar y exportar

- [x] 25. El `.walkie` de una feature incluye los módulos que usa (y los que esos contienen, con su catálogo); el de la app, todos. Al importar, un módulo que ya existe en la app destino se reutiliza y si no se crea, con las referencias reconstruidas.

### Calidad

- [x] 26. Interacción fluida con varias referencias al mismo módulo (una sola consulta de resúmenes por app; mover una caja no vuelve a pedir nada); teclado (selector, diálogo y franja), foco visible y estados vacíos que explican qué hacer.

## Fuera de alcance

- Módulos compartidos entre apps (el alcance es la app).
- Versiones o historial de la definición, y bloqueo de edición concurrente más allá del 409.
- Exponer como interfaz una conexión concreta (la interfaz se vincula a una caja; su contrato es el de esa caja).

## Impacto en el modelo

`walkie-graph.schema.json` (sigue en `schemaVersion` 0; todo opcional):

- Nodo `module` con `moduleId` (uuid, obligatorio en él) y `display` (`description`, `interfaces`: `false` los oculta). `title` guarda el último nombre conocido.
- `interfaces` del grafo: mapa id → `{ id, name, description?, kind: provides | event | requires, nodeId, tourId? }`.
- Conexión: `fromInterface` / `toInterface` `{ id, name }` (solo si ese extremo es un nodo `module`).

Nuevo `walkie-module-summary.schema.json`: el resumen que usan las features (id, nombre, descripción, versión, interfaces con el tipo, título, método y ruta de su caja, módulos que contiene y features que lo usan).

`walkie-package.schema.json`: `modules` en el manifest (`modules/<id>/canvas.json`).

## Impacto en la API

- `features.kind` (`feature` | `module`, migración con `feature` por defecto). Listados, galería, mapa, portales y contexto de la app siguen viendo solo features.
- `GET /api/apps/{appId}/modules` → resúmenes. `POST /api/apps/{appId}/modules` (`id` opcional, `name`, `description`) → crea uno vacío. `DELETE /api/modules/{id}` → 409 con usos salvo `?force=true`.
- `GET /api/modules/{id}/usages` → features y conexiones por interfaz. `POST /api/modules/{id}/interfaces/{interfaceId}/reassign` (`to`: id o `null`) → reescribe esas conexiones en los lienzos que la usan.
- `POST /api/apps/{appId}/modules/extract` → conversión: crea el módulo con su lienzo y guarda la feature (con su versión) o no deja nada; idempotente por el `id` del módulo.
- El lienzo del módulo se lee y guarda con `GET/PUT /api/features/{id}/canvas` (validación de referencias y ciclos) y se renombra con `PUT /api/features/{id}`.
- Export/import `.walkie` con módulos.

## Preguntas abiertas

- ¿Módulos compartidos entre apps (una «biblioteca» de la organización)? Queda para otra spec.
- ¿Versionar la definición para que una feature fije una versión? Por ahora todas ven la última guardada.
