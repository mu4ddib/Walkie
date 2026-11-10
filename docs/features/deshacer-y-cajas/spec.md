# Spec: Deshacer, rehacer y cajas de grupo que se ajustan

Fecha: 2026-11-10. Pedido directo del autor (sin issue).

## Problema

1. No había forma de deshacer un cambio del lienzo: un arrastre, un borrado o un cambio de grupo por error obligaba a rehacerlo a mano o a recargar perdiendo lo no guardado.
2. Al meter una caja, una nota o un grupo en un grupo (o moverlo dentro), podía quedar sobresaliendo de su borde: la pertenencia era correcta pero el dibujo decía otra cosa.

## Criterios de aceptación

### Deshacer y rehacer

1. Ctrl+Z (Cmd+Z) deshace el último cambio del grafo; Ctrl+Mayús+Z o Ctrl+Y lo rehace. También con los botones ↶ ↷ junto al zoom, deshabilitados cuando no hay nada que deshacer o rehacer. La pista confirma «Deshecho» / «Rehecho».
2. Cubre todo lo que cambia el grafo: cajas, conexiones, grupos (jerarquía, cajas, plegado), notas adhesivas, tours y recorridos. No cubre selección, vista, reproducción ni plegados temporales.
3. Un gesto es un paso: un arrastre de principio a fin (con lo que ocurre al soltar), lo que dispara una misma acción (crear una caja y meterla en un grupo, borrar una selección con sus conexiones) y lo que se escribe seguido en un mismo campo.
4. Un cambio nuevo después de deshacer descarta lo que había para rehacer. Se recuerdan 100 pasos; abrir o recargar el lienzo empieza un historial nuevo.
5. Deshacer no toca la versión del servidor. Si se vuelve exactamente a lo guardado, el lienzo queda «al día»; si no, «sin guardar» (y el autoguardado actúa como con cualquier cambio).
6. En un campo de texto, Ctrl+Z deshace el texto del campo (el del navegador), no el lienzo. En solo lectura y durante un tour o un recorrido no hay deshacer.

### Cajas de grupo

7. Al meter algo en un grupo (soltarlo, crearlo dentro, duplicarlo, elegirlo en «Dentro del grupo» o agrupar dentro de otro grupo), si su caja sobresale, el grupo crece lo justo (con su margen y el encabezado) en la grilla de 8 px.
8. Al mover algo dentro de su grupo hasta que asome, el grupo crece al soltarlo.
9. Si el grupo crecido ya no cabe en su grupo de afuera, ese también crece, hasta el más externo.
10. Solo crece: nunca achica ni mueve lo de dentro. Un grupo plegado cuenta con su caja desplegada.
11. El crecimiento es parte del mismo paso que lo causó: un Ctrl+Z lo deshace junto con el movimiento.

## Fuera de alcance

Historial compartido entre pestañas o usuarios; achicar un grupo a su contenido.
