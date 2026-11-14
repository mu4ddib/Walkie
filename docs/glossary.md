# Glosario

| Término | Definición |
| --- | --- |
| **App** | Aplicación documentada. Contiene un catálogo y varias features. |
| **Feature** | Funcionalidad con un único objetivo de usuario (iniciar sesión, transferir). Tiene un lienzo y sus tours. |
| **Lienzo (canvas)** | Grafo de nodos y conexiones de una feature, más su `layout`. |
| **Catálogo** | Nodos reutilizables de la app (`api`, `service`, `database`, `resource`) definidos una sola vez. |
| **Nodo** | Caja del lienzo. Tipos: `actor`, `screen`, `rule`, `api`, `service`, `database`, `resource`, `ref`, `portal`, `module`. |
| **ref** | Nodo que apunta a un elemento del catálogo (`catalogId`). Si el elemento cambia, cambia en todos los lienzos. |
| **Módulo** | Conjunto reutilizable de componentes conectados de una app, con su propio lienzo e **interfaces** (ADR-0010). Una feature lo usa con una caja (nodo `module`, `moduleId`) que comparte su definición; su posición, tamaño y presentación son de cada lienzo. |
| **Interfaz** | Punto de conexión de un módulo vinculado a una caja de su lienzo (`interfaces`: id estable, nombre, tipo `provides`/`event`/`requires`, recorrido interno opcional). Una conexión apunta a ella con `toInterface`/`fromInterface`; sin eso, va al módulo completo. |
| **portal** | Nodo que lleva a otra feature. Permite recorrer la app sin un lienzo gigante. |
| **Conexión (edge)** | Relación entre nodos. Su **operación** dice qué hace; su tipo (`kind`) es solo la familia del trazo: `request` (ida que espera), `response` (retorno), `event` (asíncrona), `uses` (estructural), `navigation`. `reads` y `writes` son de lienzos anteriores. Una solicitud HTTP lleva su `request` (endpoint y parámetros del paso). |
| **Operación** | Qué hace una conexión, del catálogo de `apps/web/src/interactions/operations.ts` (ADR-0011): enviar solicitud HTTP, invocar, consultar, escribir, ejecutar procedimiento, obtener de caché, leer objeto, publicar, entregar, abrir flujo, usa, navegar… o una personalizada con nombre. Es la única fuente del verbo de la etiqueta, de sus retornos y de las secciones del inspector. Lleva opcionalmente patrón (`pattern`), tecnología y el detalle del intercambio (`exchange`: comando, parámetros, entidades, contrato del resultado, errores, timeout, mensajería, gRPC). |
| **Retorno** | Conexión `response` en sentido inverso vinculada por `replyTo` a la operación que responde: una respuesta HTTP (con `status`), un resultado de una consulta, una confirmación del broker, un mensaje de un flujo… con su tipo (`result`: éxito, vacío, filas afectadas, confirmación, hit, miss, error…). Varios retornos de una operación son **escenarios** alternativos (salvo los de un `stream`). Una respuesta asíncrona de otro participante se vincula con `correlatesWith`. |
| **Timeout** | Desenlace de quien espera cuando no llega retorno (no es un error recibido): se elige como escenario al previsualizar y se marca en un paso de recorrido (`timeout`). |
| **Input** | Dato que una pantalla pide al usuario (ej. `cc`), con sus reglas. |
| **Regla** | Validación o lógica de negocio (ej. `cc` de 6 a 10 dígitos). En modo **decisión** (`mode: decision`) es una bifurcación con salidas (`branches`); cada rama es una conexión con `branch`. |
| **Nota adhesiva** | Anotación libre sobre el lienzo (`stickyNotes`): no es un nodo, no se conecta ni entra en tours. |
| **Tour** | Secuencia de pasos sobre nodos de una feature, con notas; puede continuar por un portal. |
| **Mapa de la app** | Vista de una app entera: cada feature es una caja, los portales son flechas entre ellas y, si se elige, se ven los componentes del catálogo que comparten. Se suma a la galería de features. |
| **Recorrido** | Tour cuyos pasos recorren conexiones (origen → destino, en su sentido real): ej. Pantalla → API → Servicio → BD → Servicio → API → Pantalla. Cada escenario de una decisión es un recorrido distinto. Un paso `parallel` ocurre a la vez que el anterior (fan-out). |
| **Grupo anidado** | Grupo dentro de otro (`parentId`). Plegar un grupo oculta todo lo de dentro; sus conexiones llegan al grupo plegado visible más externo. |
| **Layout** | Posición `x, y` de cada nodo, guardada aparte del contenido. |

## Regla de corte

Un lienzo cubre un solo objetivo de usuario. Si necesita scroll para entenderse, se divide en dos features unidas por un portal.
