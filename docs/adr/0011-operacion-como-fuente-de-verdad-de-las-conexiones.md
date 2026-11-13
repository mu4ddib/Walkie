# ADR-0011: La operación es la fuente de verdad de una conexión

- Estado: aceptado
- Fecha: 2026-11-13

## Contexto

Las conexiones tenían un `kind` cerrado (`navigation`, `request`, `response`, `event`, `uses`, `reads`, `writes`) que mezclaba el trazo, el verbo y la capacidad de tener respuesta, y un `data.operation` (lee/escribe) que podía contradecirlo. Solo una `request` podía tener respuestas. La spec `interacciones` pide documentar consultas, invocaciones, caché, almacenamiento, mensajería y streams con sus retornos, sin romper los lienzos guardados.

## Opciones consideradas

1. Agrandar el enum `kind` con cada operación — rompe el significado de los lienzos existentes y mezcla trazo con operación.
2. **Un campo `operation` de un catálogo central y `kind` como familia de trazo** — los lienzos anteriores no cambian; la operación explícita manda cuando existe.
3. Inferir la operación siempre del tipo de las cajas — no permite documentar dos operaciones distintas entre las mismas cajas.

## Decisión

Opción 2. `operation` (id del catálogo único `packages/schema/walkie-operations.json`, del que la web genera `src/schema/walkie-operations.ts` y que la API embebe; enum en el schema del grafo) es la fuente de verdad: verbo, retornos, secciones del inspector, export y reproducción salen del catálogo. `kind` queda como familia del trazo (ida síncrona, retorno, asíncrono, estructural, navegación) y se fija al elegir una operación. Una conexión anterior sin `operation` se migra al abrir el lienzo (sin marcar cambios; se guarda con el próximo guardado) solo si su significado es inequívoco (`legacyOperation`: un `reads` a una base es «Consultar»); si es ambigua (un `request` a una base) queda como siempre (su `kind`) con la operación sugerida, y si `kind` y `data.operation` se contradicen, se marca para revisión en vez de elegir. Los retornos se vinculan por `replyTo` a cualquier operación que no sea un retorno, una navegación ni una relación estructural («usa»); las respuestas asíncronas con otros participantes, por `correlatesWith`.

## Consecuencias

- Positivas: un solo lugar para operaciones, verbos, retornos y formularios; lienzos anteriores idénticos; retornos para cualquier intercambio.
- Negativas / costos: los ids de las operaciones están en dos sitios del schema (el enum del grafo y el catálogo); una prueba de la API exige que coincidan. `kind` y `operation` conviven (el primero ya no es la fuente de la operación).
- Qué habría que hacer para revertirla: dejar de escribir `operation` y volver a leer solo `kind`; los lienzos con `operation` seguirían validando.
