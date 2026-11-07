# Spec: Modo tour con el personaje guía

- Issue padre: (se crea al aprobar)
- Estado: borrador
- Fase 3 ("modo tour"). Gate del roadmap: una persona nueva entiende el tour sin ayuda.

## Objetivo

Que quien documenta un lienzo arme tours por pasos sobre sus nodos, y que quien llega nuevo los recorra guiado por Walkie, el robot walkie-talkie, que camina hasta cada nodo, lo señala y cuenta la nota del paso.

## Usuarios

- Autor: el desarrollador que ya documentó la feature y quiere explicar el flujo en orden ("primero la pantalla de login, luego la regla del documento, luego la API…").
- Lector: una persona que se incorpora al equipo y no conoce el flujo. No edita nada: solo avanza, retrocede y lee.

## Criterios de aceptación

**Armar tours (autor)**

- [ ] 1. Dado un lienzo sin nada seleccionado, el panel derecho muestra la sección "Tours" con los tours de la feature y "Nuevo tour"; al crear uno le doy nombre (1 a 60 caracteres).
- [ ] 2. Dado un tour abierto en el panel, cuando uso "Agregar paso", elijo un nodo del lienzo y escribo la nota del paso (hasta 500 caracteres); el paso se agrega al final.
- [ ] 3. Dado un tour con pasos, puedo editar la nota, subir o bajar un paso, quitarlo, renombrar el tour y borrarlo. El lienzo queda "Sin guardar" y los tours se guardan con el lienzo.
- [ ] 4. Dado un nodo que aparece en pasos de un tour, cuando lo borro, entonces esos pasos desaparecen (no quedan pasos rotos).

**Recorrer un tour (lector)**

- [ ] 5. Dado un tour con pasos, cuando uso "Ver tour", entonces entro al modo tour: el lienzo no se puede editar, la paleta y el panel se ocultan y aparece la barra del tour con "Paso 1 de N", "Anterior", "Siguiente" y "Salir".
- [ ] 6. Dado un paso, la vista se centra en su nodo, el nodo queda resaltado y el resto se atenúa; el guía camina hasta el nodo, lo señala y muestra la nota en un globo de diálogo (animación de hablar mientras aparece el texto).
- [ ] 7. Dado el modo tour, las flechas ← y → cambian de paso y Esc sale; al salir, el lienzo vuelve a como estaba (zoom y posición incluidos).
- [ ] 8. Dado el último paso, "Siguiente" pasa a "Terminar" y el guía celebra; al terminar se sale del modo tour.
- [ ] 9. Dado un paso sobre un nodo `portal` con destino, el globo ofrece "Ir a <feature>", que abre esa feature (sus tours se pueden ver desde ahí).
- [ ] 10. Dado que el sistema pide menos movimiento (`prefers-reduced-motion`), el guía aparece junto al nodo sin caminar ni saltar y la vista cambia sin animación.

**Persistencia e integridad**

- [ ] 11. Dado un lienzo con tours, cuando guardo y recargo, entonces los tours aparecen idénticos (nombres, pasos, orden y notas).
- [ ] 12. Dado un grafo con un paso cuyo `nodeId` no existe o un tour cuya clave no es su `id`, cuando la API lo recibe, entonces responde 400 en `/tours/{id}/steps/{i}/nodeId` o `/tours/{id}/id`.

## Fuera de alcance

- Continuar el mismo tour dentro de la feature destino de un portal (criterio 9 solo abre la feature).
- Tours que recorren varias features de una vez, ramas o pasos condicionales.
- Enlace público de solo lectura para compartir un tour (fase 4).
- Audio, voz o texto con formato (Markdown) en las notas.
- Elegir otro personaje o personalizar el guía.
- Grabar métricas de quién vio qué tour.

## Impacto en el modelo

`packages/schema/walkie-graph.schema.json` ya tiene `tours` (mapa id → `{ id, name, steps: [{ nodeId, note }] }`). Cambios propuestos (v0 sigue siendo v0: límites y `additionalProperties: false`):

- `tour.name`: `minLength: 1`, `maxLength: 60`.
- `step.note`: `maxLength: 500`.
- `tour` y `step`: `additionalProperties: false`.
- Integridad (API): clave del tour = `id`; cada `nodeId` apunta a un nodo existente.

## Impacto en la API

Sin endpoints nuevos: los tours viajan en el `PUT /api/features/{featureId}/canvas`. `GraphValidator` suma la integridad del criterio 12.

## Sprites del guía

Hojas horizontales PNG en `packages/sprites/guia/`, una por animación, generadas con PixelLab y retocadas en Pixelorama: cuadros de 64×64 con fondo transparente y los pies en la línea `y = 54` en todos los cuadros. `manifest.json` dice por hoja la cantidad de cuadros, los cuadros por segundo, hacia dónde mira y si se repite. La web las dibuja escaladas ×2 con `image-rendering: pixelated`.

- Recibidas (todas a 6 fps): `idle` (4 cuadros, de frente), `walk` (6, mirando al este; hacia el oeste se refleja en el código), `point` (5, al este, una vez), `talk` (5, de frente) y `celebrate` (5, de frente, una vez, con un saltito).
- Opcionales, sin usar en esta feature: `jump` y `think`.

## Preguntas abiertas

1. **Entrega de los sprites**: ¿los subes al repo en `packages/sprites/guia/` o me los pasas por aquí? Necesito además, por hoja, el tamaño del cuadro y cuántos cuadros tiene.
2. **Dónde se arman los tours**: propuesta: en el panel derecho cuando no hay nada seleccionado (hoy muestra solo un texto de ayuda), con el selector de nodo dentro del formulario del paso.
3. **Portal en un tour**: propuesta: el globo ofrece "Ir a <feature>" y nada más (criterio 9); continuar el tour allá queda fuera de alcance.
