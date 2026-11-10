# Spec: Tours y recorridos separados

- Issue padre: #115
- Estado: implementada

## Objetivo

Que quien documenta distinga a simple vista un **tour** (el guía presenta nodos uno a uno, con notas) de un **recorrido** (se reproducen conexiones en orden: solicitud → … → respuesta), los cree y edite cada uno con su propio editor, y que el inspector se lea bien a cualquier ancho.

## Usuarios

Quien arma la documentación de una feature (para onboarding o revisión) y quien la recorre después.

## Criterios de aceptación

### Separación

- [ ] Dado un lienzo sin nada seleccionado, cuando miro el inspector, entonces veo dos pestañas: «Tours» y «Recorridos», cada una con su cantidad, una frase que explica qué es y su lista propia.
- [ ] Dada la pestaña «Tours», cuando creo uno, entonces su editor solo ofrece pasos de nodo (nodo + nota) y el botón «Ver tour»; no muestra conexiones, continuaciones ni «Elegir pasos en el lienzo».
- [ ] Dada la pestaña «Recorridos», cuando creo uno con «Nuevo recorrido», entonces nace vacío en esa pestaña (no se va a «Tours» por no tener pasos) y su editor solo ofrece pasos de conexión: continuaciones, «Elegir pasos en el lienzo», la lista de conexiones, descripción por paso, orden sugerido y avisos; y el botón «▶ Reproducir recorrido».
- [ ] Dado que selecciono conexiones y uso «Crear recorrido» (o «Crear recorrido desde aquí»), entonces se abre en la pestaña «Recorridos».
- [ ] Dado un tour o recorrido abierto, cuando selecciono una caja en el lienzo y luego vuelvo a no tener nada seleccionado, entonces el inspector vuelve a la misma pestaña y al mismo editor.
- [ ] Dada la lista de recorridos, cuando uno tiene pasos con conexiones eliminadas, entonces muestra «⚠ N pasos por revisar» (como hoy).
- [ ] Dado un lienzo guardado antes (tours sin tipo), cuando lo abro, entonces un tour con algún paso de conexión aparece en «Recorridos» y uno solo con nodos en «Tours». Si un recorrido anterior tiene pasos de nodo, se ven en su editor marcados «Paso de nodo» con «Quitar».
- [ ] Dado un enlace de solo lectura, cuando lo abro, entonces la lista también separa «Tours» y «Recorridos».

### Inspector a cualquier ancho

- [ ] Dado el inspector a 340 px (o el panel inferior en pantallas angostas), cuando un campo, una lista desplegable o un botón tiene un texto largo (ej. «API → autenticación de google · responde»), entonces el texto se recorta con «…» o salta de línea, y el inspector **nunca** tiene scroll horizontal ni contenido cortado a los lados.
- [ ] Se verifica en 1440, 1024 y 768 px con un E2E que falla si el contenido del inspector es más ancho que el inspector.

## Fuera de alcance

- Convertir un tour en recorrido o al revés (se crea uno nuevo).
- Reordenar pasos arrastrando (siguen ↑ ↓).

## Impacto en el modelo

`tour.kind` opcional: `"guide"` (tour) o `"flow"` (recorrido). Un tour `guide` solo admite pasos `nodeId`; uno `flow`, pasos `edgeId` o `removedEdge` (y `nodeId` solo si ya los tenía). Sin `kind` (lienzos anteriores): `flow` si tiene algún paso de conexión, si no `guide`. Las acciones del store crean cada uno con su `kind`.

## Impacto en la API

Sin endpoints nuevos. `GraphValidator`: en un tour `kind: "guide"`, un paso `edgeId`/`removedEdge` responde 400. El export a Markdown separa «Tours» y «Recorridos».

## Decisiones

- Un recorrido nuevo solo tiene pasos de conexión; para presentar nodos con notas está el tour (aprobado por el autor, 2026-11-10).
