# Spec: Conexiones de ida y vuelta

- Issue padre: #135
- Estado: implementada (2026-11-12), verificada por `apps/web/e2e/conexiones-ida-y-vuelta.spec.ts`, `lanes.test.ts` y `labels.test.ts`

## Objetivo

Que una solicitud (`llama`) y su respuesta (`responde`) entre los mismos dos nodos se lean siempre como dos trazos distintos, sin tramos superpuestos ni etiquetas una encima de otra, en cualquier disposición de las cajas.

## Problema observado

Con una pantalla y una API que no están una frente a la otra (por ejemplo, la API abajo y a la derecha, o al otro lado de un grupo), la solicitud y la respuesta salen por el mismo lado, doblan en el **mismo tramo vertical** y llegan juntas. Las dos etiquetas («llama» y «responde») quedan pegadas una sobre otra a mitad del camino. Los carriles separados (`laneOffset`) solo se aplican al trazo de siempre: cuando hay puertos calculados o un camino que rodea cajas (`routeAround`), los dos trazos comparten corredor. Solo pasa con este par; las demás conexiones se ven bien.

## Usuarios

Quien documenta integraciones (pantalla ↔ API, API ↔ servicio) y quien lee el lienzo o lo recorre en un tour.

## Criterios de aceptación

### Trazos

- [x] Dada una solicitud y su respuesta (`replyTo`) entre el mismo par, en cualquier disposición (en línea, apiladas, en diagonal, con cajas en medio o con un grupo plegado como extremo), entonces los dos trazos van en paralelo, separados al menos 12 px en todo su recorrido, también en los dobleces y en los tramos que rodean cajas.
- [x] Dadas varias respuestas a una misma solicitud (ej. 201 y 400), entonces cada una tiene su carril; ninguna comparte tramo con otra ni con la solicitud.
- [x] Los extremos se reparten en el lado de cada caja como hoy (`computePorts`): la ida y la vuelta no comparten punto de entrada ni de salida.
- [x] Otras conexiones del mismo par (no solicitud y respuesta) también van en carriles, en vez de compartir tramo; las conexiones de pares distintos se ven como hoy (sin regresiones en `puertos-de-conexion`).

### Etiquetas

- [x] Dado el par, entonces sus etiquetas nunca se superponen: cada una queda sobre su propio trazo, separadas al menos `LABEL_GAP`.
- [x] Si no hay lugar para las dos (trazo corto), se muestran juntas en una sola etiqueta compuesta («llama · POST /cuentas ⇄ responde 201»), arriba o abajo del trazo si a mitad tapa una caja; cada mitad se puede seleccionar por separado y lleva su propio estilo.
- [x] Pasar el puntero o seleccionar una de las dos resalta solo esa, con su animación de sentido.

### Verificación

- [x] Un E2E siembra el par en cuatro disposiciones (horizontal, vertical, diagonal y rodeando una caja, más un par muy cercano) y comprueba que las cajas de las etiquetas no se intersectan y que los trazos no comparten segmentos; guarda capturas con `WALKIE_CAPTURES`.

## Fuera de alcance

- Puntos de paso manuales (arrastrar un doblez a mano).
- Cambiar el aspecto de las demás clases de conexión.
- Unir la ida y la vuelta en un único trazo con dos puntas (descartado: la respuesta dejaría de verse como conexión propia).

## Impacto en el modelo

Ninguno: es solo cómo se dibuja.

## Impacto en la API

Ninguno.

## Decisiones

- 2026-11-12, autor: dos trazos paralelos, cada uno seleccionable; la etiqueta compuesta solo cuando no caben las dos.

## Preguntas abiertas

- Ninguna.
