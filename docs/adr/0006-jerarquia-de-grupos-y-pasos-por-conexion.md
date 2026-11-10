# ADR-0006: Jerarquía explícita de grupos y pasos de tour por conexión

- Estado: aceptado
- Fecha: 2026-11-10

## Contexto

Los grupos del lienzo no tenían padre: anidar dependía solo de la posición y plegar un grupo exterior dejaba visibles los internos. Además, los tours solo tenían pasos por nodo y se necesitaba reproducir flujos de varias conexiones (solicitud, pasos intermedios y respuesta), con ramas de decisiones.

## Opciones consideradas

1. Inferir la pertenencia siempre por contención geométrica — sin cambios de schema / ambigua con cajas solapadas, se rompe al redimensionar y no conserva lo que el usuario decidió.
2. `parentId` en el grupo y `groupId` en la nota, con marca `groupNesting` en el grafo — explícito y validable / requiere inferir una vez para lienzos anteriores.
3. Un tipo nuevo `flow` aparte de los tours — separa conceptos / duplica editor, lista, export y validación.
4. Pasos de tour que referencian una conexión (`edgeId`) junto a los de nodo — reutiliza tours y es compatible / el paso debe sobrevivir a que se borre la conexión.

## Decisión

Opciones 2 y 4. La jerarquía se guarda (`group.parentId`, `stickyNote.groupId`, `node.groupId`); un grafo sin `groupNesting: "explicit"` se infiere una vez al abrirlo (contención estricta, el contenedor más chico, sin adivinar en empates). Un paso es exactamente uno de `nodeId`, `edgeId` o `removedEdge` (lo que se sabía de una conexión eliminada, para reemplazarla o quitar el paso sin dejar referencias colgando). La expansión temporal de grupos y los resaltados de la reproducción son estado de vista, nunca del grafo.

## Consecuencias

- Positivas: plegar, mover y conectar funcionan a cualquier profundidad; la API rechaza ciclos; los recorridos referencian las conexiones reales (sentido, rama y propiedades) y los tours anteriores siguen valiendo.
- Negativas / costos: el primer guardado de un lienzo anterior agrega `parentId`/`groupId` inferidos; `Tour.steps` genera un tipo con índice abierto (`oneOf`).
- Qué habría que hacer para revertirla: quitar los campos del schema y volver a resolver la pertenencia por posición; los pasos `edgeId`/`removedEdge` tendrían que convertirse a pasos por nodo.
