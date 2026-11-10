# Spec: Flujos legibles (decisiones, solicitud/respuesta, notas, duplicar y autoguardado)

- Issue padre: sin issue (pedido directo del autor, 2026-11-10)
- Estado: implementada

## Objetivo

Crear, leer y editar un flujo con solo mirar el lienzo: bifurcaciones con salidas etiquetadas, intercambios solicitud/respuesta con su sentido y su código, anotaciones, copias rápidas y guardado sin pensar en él. Se conservan la paleta arena, las cajas por tipo, las imágenes y la distribución del editor.

## Usuarios

Quien documenta una feature (desarrollo) y quien la lee al llegar (onboarding).

## Criterios de aceptación

Decisiones

- [x] 1. Una regla se convierte en decisión (y al revés) desde su inspector, con el mismo id, título, posición y conexiones.
- [x] 2. Una decisión nace con las salidas "Sí" y "No"; se renombran, se agregan y se quitan. La caja lleva el encabezado "◇ Decisión" y una fila con su punto por salida.
- [x] 3. Una conexión que nace del punto de una salida es esa rama; a las que ya existían se les asigna la salida a mano (inspector de la decisión o de la conexión). La etiqueta de la salida se lee junto a la rama y sustituye a "usa".

Solicitud y respuesta

- [x] 4. Tipo, etiqueta por defecto y sentido concuerdan: marcar "responde" una conexión pantalla → API la invierte (y lo avisa, con "Deshacer"). "Invertir sentido" está siempre; la etiqueta personalizada se conserva.
- [x] 5. Una solicitud sin etiqueta muestra su endpoint (`POST /ruta`: el del paso o el del contrato de la API); una respuesta, su código.
- [x] 6. Desde una solicitud se añaden respuestas: retornos en sentido inverso vinculados a ella; varias por solicitud (éxito, error).
- [x] 7. Varias conexiones entre el mismo par (también hacia un grupo plegado) van por carriles separados, cada una con su etiqueta, y se seleccionan por separado. Una conexión hacia la izquierda sale por el lado izquierdo en vez de rodear las cajas.
- [x] 8. El sentido se anima con un pulso de mayor contraste. "Previsualizar interacción" destaca los extremos y recorre la ida y luego la vuelta. Sin animación (interruptor o movimiento reducido) quedan flechas y etiquetas.

Inspector de conexiones

- [x] 9. Primero el resumen (origen → destino, tipo y etiqueta); después solo lo de esa interacción: solicitud (endpoint vinculado al contrato, parámetros y headers, ejemplo, respuestas), respuesta (solicitud asociada, código HTTP en campo propio, ejemplo, qué ocurre después), rama de decisión (salida y condición), acceso a datos (operación y entidades), y condición y notas como secciones plegables.

Notas adhesivas y duplicar

- [x] 10. Las notas adhesivas se crean desde la barra (tecla N), se editan con doble clic, se mueven y se borran; no tienen conexiones y se guardan con el lienzo.
- [x] 11. Ctrl+D / Cmd+D y "Duplicar" del menú contextual copian la caja seleccionada con un ligero desplazamiento y dejan seleccionada la copia: mismas propiedades, imagen y `catalogId`; id propio y sin conexiones. El atajo no actúa mientras se escribe.

Guardado

- [x] 12. "Autoguardado" se activa desde el estado de guardado (preferencia del navegador, apagada por defecto). Activo, guarda tras una pausa breve y al terminar un movimiento, con el mismo `PUT` versionado; el botón Guardar y Ctrl+S siguen.
- [x] 13. Estados: Sin guardar, Guardando, Guardado, Error al guardar (con "Reintentar"; los cambios siguen pendientes). Una respuesta de guardado no marca como guardado lo que cambió mientras viajaba.
- [x] 14. Al cambiar de feature o de app con cambios pendientes: con autoguardado se guardan antes de salir; en modo manual, o si el guardado falla, la persona decide.

Pulido

- [x] 15. Las ayudas persistentes del lienzo pasan a tooltips y a "?"; el inspector muestra solo lo pertinente a la selección.
- [x] 16. Un lienzo guardado antes de estos cambios abre y se edita igual (el código de una respuesta escrito como condición se lee como código).

## Fuera de alcance

- Deshacer/rehacer.
- Redimensionar o colorear notas adhesivas; notas dentro de tours.
- Varios endpoints por nodo API (el contrato sigue siendo uno; la conexión puede llevar el suyo).
- Edición simultánea (el 409 sigue pidiendo recargar).

## Impacto en el modelo

`packages/schema/walkie-graph.schema.json`, todo opcional (los grafos anteriores siguen siendo válidos):

- Nodo `rule`: `mode: "decision"` y `branches: [{ id, label }]`.
- Conexión: `branch` (salida de la decisión de origen), `status` (100–599), `replyTo` (solicitud), `outcome`, `request` (`method`, `path`, `params[{ name, in, value }]`). `when` queda para condiciones.
- Grafo: `stickyNotes` (mapa id → `{ id, text }`), con su posición en `layout`.

## Impacto en la API

Sin endpoints nuevos. `GraphValidator` suma integridad: `mode` y `branches` solo en reglas (y `branches` solo en decisiones, ids únicos), `branch` es una salida del nodo de origen, `replyTo` es otra conexión `request`, clave de cada nota = `id` y `layout` admite notas. El export a Markdown lleva la etiqueta de la rama, el código, el endpoint, los parámetros, "Después" y la sección "Notas del lienzo".

## Preguntas abiertas

- ¿Autoguardado encendido por defecto? Hoy apagado para no cambiar el comportamiento conocido.
