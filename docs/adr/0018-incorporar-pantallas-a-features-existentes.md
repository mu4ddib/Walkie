# ADR-0018: Incorporar una pantalla descubierta a una feature existente

- Estado: aceptado
- Fecha: 2026-11-20
- Relacionados: ADR-0012 (decisiones y procedencia fuera del grafo), ADR-0014 (contrato del `.walkiepack`), ADR-0016 (arquitectura calculada)

## Contexto

Walkie Live solo incorporaba pantallas dentro de una propuesta de feature: «una pantalla no se vincula sola: entra con su feature». Al analizar Walkie, `Home` (`/`) no está en ninguna propuesta y solo se podía descartar. Las personas necesitan dos cosas: crear una feature a partir de una pantalla suelta, y sumar una pantalla a una feature que ya documentaron.

Lo segundo choca con una regla del contrato de `apply`: «nunca escribe en lienzos existentes». Esa regla protege la documentación humana (posiciones, tours, recorridos, portales). Este ADR la ajusta sin perder esa protección.

## Opciones consideradas

1. **Recrear la feature** con la pantalla nueva. Descartada: pierde lo hecho a mano y cambia identidades.
2. **Vincular sin tocar el lienzo** (solo procedencia) y que la persona dibuje la caja. Simple, pero deja a la persona sin la pantalla, su ruta ni sus conexiones; es casi lo mismo que descartar.
3. **Agregar al lienzo, solo agregar, con la versión que se vio.** Una operación nueva (`attach`) que suma cajas y conexiones nuevas, reutiliza las que ya están, y no mueve, cambia ni borra nada; exige la versión del lienzo de la vista previa.

## Decisión

Opción 3, más «Crear feature desde esta pantalla» como un `create` sobre la pantalla (una feature cuyo único miembro es ella, por el mismo camino que las propuestas).

**`attach` (incorporar a una feature existente).**

- **La elige la persona.** `target` es una feature de la misma app de Walkie (no un módulo). Nunca se elige sola por nombre o ruta.
- **Vista previa (`dryRun`) contra el lienzo actual:**
  - lo que ya tiene (cajas y conexiones) y su versión;
  - lo que se agrega: la pantalla, sus llamadas a APIs ya decididas y su navegación hacia pantallas documentadas en otras features (portal);
  - lo que se reutiliza: un `ref` a la misma API, la caja del mismo módulo o un portal a la misma feature que ya existen;
  - lo que queda fuera y por qué: APIs sin decidir, navegación hacia pantallas sin feature o dentro de la misma feature;
  - avisos: una pantalla con el mismo título ya en el lienzo (posible duplicado), o la misma pantalla ya incorporada (error).
- **Confirmar** manda `canvasVersion` (la de la vista previa) y los ids (UUID v7 del cliente) y posiciones de lo nuevo. Las cajas nuevas no se pueden encimar con las existentes.
- **Geometría (revisión final):** «encimar» se mide con el tamaño con que el navegador dibuja cada caja, no con lo nominal (184 × 72).
  - **`BoxSizes`** (Discovery) hace la estimación conservadora: ancho de 184 a 264 y alto por las líneas del título, la línea de método y ruta y la descripción. Una API de firma larga mide 264 × 166 o más.
  - **Lo explícito guardado manda:** el `w`/`h` de un grupo o el ancho de un módulo. Lo demás se estima por el contenido de la caja.
  - **El cliente no manda tamaños.** Las cajas nuevas siempre se miden por su contenido, así que una dimensión chica no puede colarse.
  - **El error** dice con qué caja choca, y el tamaño y la posición de las dos.
  - **La web reserva lo mismo:** `boxSize` en `layoutQuality.ts`, con una prueba de paridad. Lo que propone, la API lo acepta.
  - **El lienzo inicial** (`create`) se valida igual.
- **Una incorporación por feature y por solicitud.** Dos `attach` a la misma feature en una solicitud se rechazan enteros (400 en la segunda, «No se aplicó nada»). Las dos se previsualizan contra la misma versión, así que la segunda nunca aplicaría. Se incorpora una pantalla por vez, y la siguiente con la vista previa del lienzo ya actualizado. Nunca se aplica una parte del conjunto.
- **Escritura: `ICanvasWriter.AppendAsync`** (Canvas). Carga el lienzo y:
  - si su versión no es la esperada, no escribe nada → **409** «el lienzo cambió: revisa la vista previa de nuevo»;
  - si ya contiene todas las cajas y conexiones nuevas con esos ids, es un reintento: no escribe;
  - si no, agrega solo eso, valida el grafo completo como el `PUT` y guarda con versión + 1.
- **Nunca se mueve una caja existente ni se toca un tour, recorrido, portal, interfaz o grupo.** Ningún lienzo se reorganiza.
- **Bitácora, candado y recuperación:** los de siempre (`ApplyJournal`, `ApplyLock`, mismo `applyId` en la vista previa, la confirmación y un reintento). El paso de agregar tiene su punto de prueba (`attach:{índice}`).
- **Compensación:** si algo falla después de agregar, `ICanvasWriter.DetachUntouchedAsync` quita lo agregado solo si el lienzo sigue en la versión que dejó la operación. Si alguien ya lo editó, se conserva y se avisa (como la compensación de la tarea 10).
- **Procedencia:** la pantalla queda vinculada a la feature (`linked`, con fuente, análisis, clave y fingerprint), visible en «De dónde viene» de la feature. Un reanálisis la reconoce por su clave: no duplica.

**`create` sobre una pantalla.** Una feature nueva con esa sola pantalla, su ruta, sus llamadas a APIs decididas (o creadas en la misma solicitud) y su navegación hacia features documentadas (portales). El nombre se puede cambiar. La pantalla queda `created` hacia la feature.

**Portales en el borrador.** Solo hacia una feature viva donde ya está la pantalla destino (por su vínculo). La navegación hacia una pantalla sin feature se omite con su porqué: no se inventa.

## Consecuencias

- El contrato de `apply` cambia de «nunca escribe en lienzos existentes» a «nunca **cambia ni borra** nada de un lienzo existente; solo `attach` le **agrega**, con su versión». Se documenta en `walkie-discovery-apply.schema.json`.
- `ICanvasWriter` suma `AppendAsync` y `DetachUntouchedAsync`; los dobles de prueba que lo implementan se actualizan.
- Una pantalla agregada queda donde la ubica el cliente (a la derecha de lo existente). La persona la mueve si quiere; nada se reacomoda solo.
