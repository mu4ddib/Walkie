# Spec: Recorridos y grupos anidados

Fecha: 2026-11-10. Pedido directo del autor (sin issue).

## Problema

1. Los grupos no tenían jerarquía: la pertenencia solo existía de nodo a grupo. Al plegar «AWS», el grupo interno «microservicio usuarios» y sus nodos quedaban visibles fuera del contenedor, mover AWS no los movía y las conexiones solo se resolvían un nivel.
2. "Previsualizar interacción" solo recorría una conexión (o su par solicitud/respuesta). No había forma de documentar y reproducir un flujo de tres o más nodos.

## Criterios de aceptación

### Grupos anidados

1. Un grupo puede estar dentro de otro (`group.parentId`) y una nota adhesiva dentro de un grupo (`stickyNote.groupId`); los nodos siguen con `groupId`. La pertenencia es explícita y se guarda.
2. Plegar un grupo oculta todos sus descendientes (grupos, nodos y notas) a cualquier profundidad. Desplegarlo recupera la distribución y el estado de plegado de cada descendiente.
3. Mover un grupo desplaza todos sus descendientes, aunque estén ocultos.
4. Arrastrar una caja, una nota o un grupo dentro de otro grupo lo mete; fuera, lo saca. Mientras se arrastra, el grupo destino se marca y la pista dice la pertenencia resultante («AWS › microservicio usuarios»); al soltar, un aviso la confirma. El inspector del grupo permite elegir «Dentro del grupo».
5. No hay ciclos: un grupo no entra en sí mismo ni en un descendiente (lienzo, inspector, store y API).
6. Guardar y recargar conserva jerarquía, posiciones y plegados (`groupNesting: "explicit"`).
7. Lienzos anteriores (sin `groupNesting`): los `groupId` de los nodos se conservan; un grupo queda dentro del grupo más chico cuya caja lo contiene por completo, y una nota dentro del más chico que contiene su caja. Si hay empate o las cajas solo se solapan, queda suelto. No marca cambios.

### Conexiones con grupos plegados

8. Una conexión con ambos extremos dentro del mismo grupo plegado se oculta.
9. Si un extremo está oculto, se dibuja contra el grupo plegado visible más externo que lo contiene; con ambos ocultos en grupos distintos, entre sus contenedores visibles. Vale a cualquier profundidad.
10. Etiquetas, sentido y distinción solicitud/respuesta se conservan; las que comparten contenedor van por carriles y siguen siendo seleccionables. Al desplegar vuelven a sus nodos.

### Recorridos

11. Mayús + clic suma conexiones a la selección (área de toque de 28 px alrededor del trazo); con dos o más, una barra contextual ofrece «Crear recorrido». Desde una conexión, el inspector ofrece «Crear recorrido desde aquí».
12. Un recorrido es un tour cuyos pasos referencian conexiones (`step.edgeId`); se reproduce en el sentido real de cada una. Una conexión puede estar en varios recorridos y repetirse en uno (reintento).
13. Al crearlo se sugiere el orden si la secuencia es única (cada conexión sale de donde llegó la anterior y cada respuesta va después de su solicitud); si no, se conserva el orden de selección. El editor permite nombrar, revisar, ordenar (↑ ↓, «Aplicar orden sugerido»), describir cada paso y agregar el siguiente desde las continuaciones del último nodo, desde una lista o tocando conexiones en el lienzo.
14. El editor señala saltos entre pasos desconectados y respuestas antes de su solicitud; se revalida solo si una conexión cambia de sentido o de extremos.
15. Una decisión guarda la rama elegida: cada recorrido referencia la conexión de su rama (se muestra «Rama elegida»).

### Reproducción

16. Cada paso de conexión: se resalta el origen, se dibuja la conexión en su sentido y se destaca el destino. Lo ajeno al recorrido se atenúa.
17. Barra con nombre, paso actual y total, descripción, pasos numerados (saltar a uno), reproducir/pausar/continuar, reiniciar, anterior, siguiente, detener (Espacio, ← →, Inicio, Esc), velocidad (0,5× a 2×, se recuerda), «Encuadrar recorrido» y «Seguir paso» con movimiento suave.
18. Los grupos plegados que contienen el paso activo se despliegan solo en la vista y vuelven a su estado al cambiar de paso o detener. Reproducir no cambia el grafo ni lo marca como modificado.

### Persistencia y validación

19. Borrar una conexión (o un nodo) usada en un recorrido deja el paso como `removedEdge` (origen, destino y tipo conocidos); un aviso nombra los recorridos afectados, la lista marca «pasos por revisar» y el editor permite reemplazarla («Entre los mismos nodos» primero) o quitar el paso.
20. Los tours guardados antes (pasos por nodo) se abren y reproducen igual, con el guía.
21. La API valida `parentId` (existe, sin ciclos), `stickyNote.groupId`, y que cada paso tenga exactamente uno de `nodeId`, `edgeId` o `removedEdge`, con `edgeId` a una conexión existente. El export a Markdown lista los pasos de un recorrido como «Origen → Destino (verbo)» y dice en qué grupo está cada grupo.

## Fuera de alcance

Deshacer; pasos que bifurcan dentro de un mismo recorrido (se crean recorridos distintos por escenario); grupos que se redimensionan solos al meter algo.
