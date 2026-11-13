# Spec: Interacciones entre sistemas

- Issue padre: (se crea con el PR)
- Estado: aprobada (2026-11-13)

## Objetivo

Documentar cada conexión como la interacción técnica que es —una consulta a una base, una invocación, una operación de caché o de almacenamiento, una publicación, un flujo— con su operación, su patrón de intercambio, su tecnología y sus retornos (resultados, respuestas, errores, confirmaciones y timeouts), no solo solicitudes HTTP a una API.

## Diagnóstico (código antes de este cambio)

- Las respuestas dependían del tipo `request`: `addResponse` solo aceptaba `kind: request`, `GraphValidator` exigía que `replyTo` apuntara a un `request` y el inspector solo mostraba «Respuestas» en solicitudes (`EdgePanel`). Una consulta a una base (`reads`) no podía tener resultado.
- El contrato del destino solo se usaba si era una API (`targetIsApi`); `endpointText` solo para `request`.
- La operación tenía dos fuentes: el tipo de conexión (`reads` = «lee», `writes` = «escribe») y `data.operation` (Lee/Escribe). Podían contradecirse (la captura del pedido: «lee» con Operación «Escribe»).
- `interactionEdges` (previsualizar) reproducía la solicitud con todas sus respuestas a la vez, sin elegir escenario.
- `shouldReverse` y los tipos «que reciben llamadas» estaban fijados a `api`, `service` y `database`.

## Criterios de aceptación

- [x] 1. Una conexión tiene una **operación** (`operation`, de un catálogo central) como única fuente de verdad: su etiqueta, el inspector, el export y la reproducción la usan. Las conexiones anteriores sin operación conservan su tipo y su etiqueta de siempre.
- [x] 2. El catálogo cubre API HTTP, servicio o función, base de datos, caché, almacenamiento, mensajería, streaming, relación general y navegación, más una operación personalizada con nombre libre.
- [x] 3. Al conectar dos cajas se sugieren las operaciones pertinentes al par (ej. servicio → base: Consultar, Escribir, Ejecutar procedimiento); la conexión se crea al instante y el detalle se completa después.
- [x] 4. Patrón de intercambio (solicitud/respuesta, unidireccional, publicación/suscripción, streaming) y tecnología (HTTP, gRPC, PostgreSQL, Redis, AMQP…) opcionales; una operación admite varios patrones (ej. invocar esperando resultado o de forma asíncrona).
- [x] 5. Los retornos dependen del intercambio, no del tipo de caja: «Añadir resultado» en una consulta, «Añadir respuesta» en HTTP, «Añadir confirmación» en una publicación. El retorno va en sentido inverso, vinculado por `replyTo` (id estable), con su tipo (éxito, vacío, filas afectadas, confirmación, hit, miss, contenido, error, mensaje de stream, fin) y su código. Varias respuestas son escenarios alternativos; las marcadas como parte de un stream son una secuencia.
- [x] 6. Mensajería por etapas: publicación, confirmación del broker, entrega, reconocimiento del consumidor y respuesta de aplicación correlacionada (`correlatesWith`, clave de correlación y canal de respuesta), con participantes distintos a los de la publicación.
- [x] 7. Timeout como desenlace de quien espera (política en la operación y paso de recorrido «termina en timeout»), distinto de un error recibido.
- [x] 8. Inspector: resumen (origen → destino y operación), y secciones plegables según la operación: comando o query (SQL, procedimiento, comando, ORM o descripción), parámetros, entidades, contrato del resultado, errores, timeout y reintentos, HTTP, gRPC, mensajería y streaming. Los contratos del componente (API, base) y de las interfaces de módulos se muestran como referencia.
- [x] 9. Datos contradictorios (ej. tipo «lee» con operación de datos «escribe») se conservan y se señalan con «Necesita revisión», con la opción de quedarse con uno de los dos; nada se deduce en silencio.
- [x] 10. Invertir el sentido de una operación con retornos invierte también sus retornos y lo dice.
- [x] 11. Borrar una operación deja sus retornos y correlaciones sin vínculo (señalados) y avisa; los pasos de recorrido quedan como hoy (conexión eliminada).
- [x] 12. Previsualizar una interacción con varias alternativas permite elegir el escenario (o el timeout). En un recorrido, pasos simultáneos (`parallel`) para fan-out y pasos que terminan en timeout.
- [x] 13. Export (Markdown, contexto para IA, PDF) usa la operación y describe el intercambio; la API valida los campos nuevos y su integridad.
- [x] 14. Las conexiones anteriores de significado inequívoco reciben su operación al abrir el lienzo (sin marcar cambios); las ambiguas o contradictorias quedan para revisar.
- [x] 15. Previsualizar sigue la cadena completa (Pantalla → API → BD → API → Pantalla: las llamadas síncronas que hace el destino, con su primer escenario), con la opción de verla sola.
- [x] 16. El timeout se simula: cada intento (1 + `exchange.retries`) espera su `timeoutMs` (acotado al mostrarlo) al previsualizar, y en un recorrido el paso con timeout espera lo mismo.
- [x] 17. Un solo catálogo de operaciones (`packages/schema/walkie-operations.json`) para la web y la API; el lienzo reutiliza los rodeos ya calculados en vez de repetir el A* en cada edición; el inspector avisa de descuidos de sintaxis en SQL y gRPC.

## Fuera de alcance

- Generar un diagrama de secuencia a partir de los recorridos.
- Validar un query o un contrato gRPC contra la base o el `.proto` reales: el inspector solo avisa de descuidos de sintaxis (comillas, paréntesis, parámetros sin documentar, UPDATE/DELETE sin WHERE, nombres de gRPC).

## Impacto en el modelo

`walkie-graph.schema.json`, todo opcional (`schemaVersion` 0): en la conexión `operation`, `customOperation`, `pattern`, `technology`, `exchange` ($defs/exchange: descripción, comando, parámetros, entidades, contrato del resultado, errores, timeout, reintentos, mensajería, gRPC), `result` (solo en un retorno), `stream` y `correlatesWith`; en un paso de recorrido `parallel` y `timeout`. `replyTo` puede apuntar a cualquier operación que no sea un retorno, una navegación ni una relación estructural. `walkie-ai-context` suma la operación y el intercambio a cada conexión.

## Impacto en la API

Sin endpoints nuevos: `GraphValidator` valida los campos nuevos (operación personalizada con nombre, `result`/`stream` solo en retornos, `exchange` no en retornos, `correlatesWith` a otra conexión) y el export describe las interacciones.
