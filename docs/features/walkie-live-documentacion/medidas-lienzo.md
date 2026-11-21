# Medidas del lienzo inicial (parte 3)

Antes de cambiar la distribución se midió la de siempre con los mismos borradores. Las medidas son funciones puras en
`apps/web/src/discovery/layout/layoutQuality.ts`, y `layoutQuality.test.ts` las vuelve a calcular en cada corrida.

## Diagnóstico

- `planInitialCanvas` usaba `autoLayout` del mapa (`CANVAS_METRICS`): las pantallas iban en columnas por navegación y
  **todas** las APIs en una grilla de 4 debajo, ordenadas por el x promedio de quien las llama. Con 11 APIs o más, cada
  llamada cruzaba la grilla en diagonal: 125 cruces en «Apps» y 47 en «Catalog».
- La grilla reservaba 232 × 104 por caja, pero una API de ruta larga mide hasta 264 × 166 en el navegador (el título
  se parte y el método/ruta también). En «Apps» había 5 cajas encimadas en el navegador. La API no lo detectaba
  porque valida con el tamaño nominal.
- El zoom inicial («Ver todo» al abrir) bajaba a 0,34–0,53 en 1280 × 800, donde ni títulos ni etiquetas se leen.
  Además, React Flow no deja bajar de 0,5, así que «Ver todo» no mostraba entero un lienzo grande.
- El trazado (`ports.ts`, `route.ts`, `lanes.ts`, `labels.ts`, `KindEdge.tsx`) y la cámara no son la causa: dibujan
  bien lo que reciben. Se dejan como estaban.

## Técnica elegida

Se evaluaron dos caminos:

- una librería de distribución jerárquica (dagre / ELK);
- una variante reducida de Sugiyama propia, en `layout/layered.ts`.

Se eligió la propia, sin dependencias nuevas. El grafo es acotado (pantallas → APIs) y lo que importa es el dominio:
qué pantalla llama a qué y por dónde va la navegación. Así funciona:

- Las pantallas van en capas por navegación.
- Cada API va en un bloque junto a quien la llama: entre las dos capas que la comparten, o debajo de su pantalla si
  son pocas.
- El orden sale del baricentro, con barridos de ida y vuelta.
- Las subcolumnas van corridas media fila.
- Cuando una navegación atraviesa un bloque, el bloque empieza más abajo y deja libre su corredor.
- Cada caja reserva su tamaño real (`boxSize`, medido en el navegador).
- Se elige el número de filas por columna que mejor llena la vista.

La distribución es determinista y tarda menos de 10 ms con 75 cajas. Solo se aplica a lienzos **nuevos**.

## Antes y después (medidas puras; tamaño real de las cajas)

Qué mide cada columna:

- **Cruces:** pares de conexiones cuyos segmentos entre centros se cruzan.
- **Largo:** promedio y máximo, en px del lienzo.
- **Etiq./caja:** etiquetas en la mitad del segmento que tapan una caja ajena.
- **Etiq./etiq.:** pares de etiquetas que se tapan.
- **Zoom 1280:** «Ver todo» en 1280 × 800 con el inspector abierto, con tope 1.

| Caso | Cruces | Largo medio / máx. | Cajas encimadas | Etiq./caja | Etiq./etiq. | Tamaño | Zoom 1280 / 1440 / 1920 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Walkie · Catalog (2 pantallas, 11 APIs, 24 conexiones) antes | 47 | 508 / 921 | 0 | 14 | 26 | 1056 × 652 | 0,77 / 0,92 / 1 |
| Walkie · Catalog después | **17** | 778 / 1080 | 0 | 14 | **1** | 1264 × 904 | 0,64 / 0,77 / 1 |
| Walkie · Apps (3 pantallas, 27 APIs, 38 conexiones) antes | 125 | 740 / 1336 | **5** | 28 | 24 | 1056 × 1312 | 0,53 / 0,61 / 0,75 |
| Walkie · Apps después | **9** | 918 / 2024 | 0 | 17 | **2** | 2384 × 1528 | 0,34 / 0,41 / 0,61 |
| Pedidos (3 pantallas, 3 APIs) antes | 0 | 306 / 341 | 0 | 0 | 2 | 1040 × 312 | 0,78 / 0,93 / 1 |
| Pedidos después | 0 | 306 / 432 | 0 | 0 | 2 | 1040 × 256 | 0,78 / 0,93 / 1 |
| 20 APIs (lista y detalle) antes | 74 | 659 / 987 | 0 | 20 | 24 | 1032 × 952 | 0,74 / 0,84 / 1 |
| 20 APIs después | **0** | 673 / 1062 | 0 | 19 | **1** | 1616 × 1376 | 0,50 / 0,58 / 0,71 |
| Sintético 10 antes | 5 | 443 / 628 | 0 | 3 | 3 | 976 × 632 | 0,83 / 0,99 / 1 |
| Sintético 10 después | 1 | 439 / 700 | 0 | 0 | 0 | 1216 × 608 | 0,66 / 0,80 / 1 |
| Sintético 30 antes | 131 | 839 / 1791 | 0 | 23 | 32 | 1168 × 1592 | 0,44 / 0,50 / 0,62 |
| Sintético 30 después | **43** | 570 / 1207 | 0 | 9 | 4 | 2944 × 1056 | 0,27 / 0,33 / 0,49 |
| Sintético 75 antes | 670 | 1703 / 3573 | 0 | 39 | 57 | 1496 × 3512 | 0,20 / 0,23 / 0,28 |
| Sintético 75 después | **227** | 679 / 1080 | 0 | 38 | 7 | 3744 × 1896 | 0,22 / 0,26 / 0,39 |

Qué se gana:

- Entre un 64 % y un 100 % menos de cruces.
- Casi ninguna etiqueta encima de otra.
- Ninguna caja encimada.
- En los lienzos grandes, conexiones más cortas.

Qué cuesta:

- Un lienzo grande es más ancho, así que «Ver todo» queda con menos zoom.

Por eso el lienzo **abre** con un zoom legible:

- `LEGIBLE_ZOOM` = 0,7. Si «Ver todo» bajaría de ahí, el lienzo muestra la esquina de arriba a la izquierda, donde
  empieza la navegación.
- «Ver todo» (`0`) baja ahora hasta 0,25 (`MIN_ZOOM`) y muestra el lienzo entero.

## En el navegador (`e2e/walkie-live-legibilidad.spec.ts`, Chromium)

Cada caso se siembra con la distribución nueva y se abre sin vista guardada. En los tres anchos:

- ninguna caja encimada en el DOM;
- el zoom inicial es de 0,7 o más.

| Viewport | Apps: zoom inicial / «Ver todo» | Catalog | Pedidos | 75 cajas | Cambio de modo (Resumen / Interacciones / Completa) |
| --- | --- | --- | --- | --- | --- |
| 1280 × 800 | 0,70 / 0,34 | 0,70 / 0,63 | 0,78 / 0,78 | 0,70 / 0,25 | 236 / 254 / 162 ms |
| 1440 × 900 | 0,70 / 0,41 | 0,75 / 0,75 | 0,93 / 0,93 | 0,70 / 0,26 | 159 / 249 / 176 ms |
| 1920 × 1080 | 0,70 / 0,58 | 0,99 / 0,99 | 1,39 / 1,39 | 0,70 / 0,39 | 164 / 405 / 209 ms |

El cambio de modo se mide desde el clic hasta dos cuadros después de que se pinta (en esta máquina, sin acelerar).
Incluye el reencuadre de la cámara.

## En WebKit (`WALKIE_BROWSER=webkit`, Linux headless)

Lo que llegó al lienzo pasó las mismas comprobaciones: sin cajas encimadas y zoom inicial de 0,7 o más.

| Viewport | Apps: zoom inicial / «Ver todo» | Catalog | Pedidos | 75 cajas | Cambio de modo (Resumen / Interacciones / Completa) |
| --- | --- | --- | --- | --- | --- |
| 1280 × 800 | 0,70 / 0,51 (1) | 0,70 / 0,63 | (2) | 0,70 / 0,25 | 517 / 520 / 534 ms |
| 1440 × 900 | 0,70 / 0,41 | (2) | 0,93 / 0,93 | 0,70 / 0,26 | 276 / 421 / 632 ms |
| 1920 × 1080 | 0,70 / 0,58 | 0,99 / 0,99 | 1,39 / 1,39 | 0,70 / 0,60 (1) | 278 / 515 / 650 ms |

Notas:

1. Medido antes de esperar a que la cámara termine (en Safari, «Ver todo» tarda más de un segundo con cuadros lentos).
   La prueba ahora espera (`settled`).
2. La prueba no llegó al lienzo: en WebKit headless la pestaña pierde a veces la sesión, o la galería no carga, dentro
   de los helpers de login y creación de app. Es intermitente: cambia de prueba en cada corrida y también afecta a
   `revision-inspector.spec.ts`. Ver «Riesgos» en el plan.

En WebKit cambiar de modo cuesta entre 2 y 3 veces lo de Chromium (repinta el lienzo entero), pero queda por debajo de
0,7 s con 30 cajas y 38 conexiones.
