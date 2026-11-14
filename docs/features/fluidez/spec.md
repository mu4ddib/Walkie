# Spec: Fluidez del lienzo

- Issue padre: (se crea con el PR)
- Estado: implementada (2026-11-14)

## Objetivo

Que usar Walkie se sienta ágil, estable y consistente también con diagramas grandes: la cámara se mueve en una sola transición, sin saltos, y las interacciones comunes (arrastrar, escribir, seleccionar, deshacer, abrir pasos) no reconstruyen todo el lienzo.

## Usuarios

Quien documenta y recorre lienzos con decenas o cientos de cajas, en equipos modestos y en Safari.

## Caso de referencia

Grabación en Safari: al pulsar «Ver todo» pasan 125 ms sin cuadros y el primer cuadro ya muestra casi todo el desplazamiento; después, una corrección animada de unos 250 ms. Causa (React Flow 12.12): `fitView` encola un `setNodes` de todos los nodos y en ese paso arranca la transición de 200 ms; el render bloquea el hilo con el reloj de la transición corriendo, así que el primer cuadro llega a mitad de camino.

## Diagnóstico (antes)

Medido con `pnpm --dir apps/web perf` (compilación de producción, Chromium, CPU ×4):

- **Cámara**: `fitView`/`setCenter`/`setViewport` con duración desde cinco sitios (zoom, tecla 0, enfocar, localizar, modo tour, recorridos, mapa) sin coordinación; el mapa esperaba 50 ms fijos para medir.
- **Trabajo global por cambio local**: cada cambio del grafo creaba objetos nuevos para todos los nodos y conexiones (React Flow los volvía a dibujar todos); la jerarquía de grupos se recorría por completo para cada grupo y cada conexión; cada conexión filtraba todas las cajas (O(conexiones × cajas)); la colocación de etiquetas revisaba todas las etiquetas y cajas del lienzo; el texto de cada etiqueta se recalculaba en cada movimiento.
- **Layout forzado**: la lista larga de pasos medía todos los pasos con `offsetHeight` después de cada cambio (layout síncrono de toda la página, lienzo incluido).
- **Documento ensuciado sin editar**: la miniatura de una pantalla crecía al llegar la imagen; la caja empujaba a las de abajo (`pushBelow`) y el lienzo quedaba «Sin guardar» al abrirlo.
- **Red en cada autoguardado**: cada guardado volvía a pedir los resúmenes de módulos (la API lee todos los lienzos de la app).
- Sin acumulación al navegar: tras cinco ciclos entre features la memoria y el DOM vuelven a su nivel.

## Criterios de aceptación

- [x] 1. «Ver todo» (botón y tecla 0) es una única transición desde la vista actual hasta un destino fijo: desplazamiento y escala juntos, sin salto inicial aunque el hilo esté ocupado al empezar, sin rebote ni corrección final (320 ms, aceleración y frenado suaves).
- [x] 2. Si ya está encuadrada, no se mueve; cambios insignificantes no se animan.
- [x] 3. Arrastrar o hacer zoom durante la transición la cancela y deja la vista donde está; una nueva petición reemplaza a la pendiente.
- [x] 4. Enfocar al abrir, «Localizar», el modo tour (y su vuelta), los recorridos y el mapa usan la misma cámara; con movimiento reducido la vista va directo; al salir del lienzo no queda ninguna transición pendiente.
- [x] 5. La vista recordada se guarda al llegar, no en cada cuadro.
- [x] 6. Un cambio local solo vuelve a dibujar lo que cambió: nodos y conexiones con identidad estable; misma lista si nada cambió.
- [x] 7. Jerarquía de grupos, obstáculos de cada trazo, etiquetas y textos de etiquetas con índices o cachés, invalidados por el objeto o por una firma de lo que los determina.
- [x] 8. Escribir en el inspector no espera al lienzo (contenido diferido; posiciones y altas o bajas en el acto).
- [x] 9. Abrir pasos de un recorrido largo no fuerza el layout de la página.
- [x] 10. Abrir un lienzo con imágenes no lo deja «Sin guardar» ni corre cajas.
- [x] 11. Guardar no vuelve a pedir en el acto los resúmenes de módulos.
- [x] 12. Banco reproducible de tres escalas con mediciones antes y después (`apps/web/perf`).
- [x] 13. Con cuadros lentos (Safari pintando todo el lienzo al encuadrar), «Ver todo» no salta: el reloj empieza en el segundo cuadro y ningún cuadro avanza más de `MAX_STEP` (1/10) del tiempo; la transición llega en al menos 10 pasos.

## Resultados (Chromium, compilación de producción, 1512×860)

`pnpm --dir apps/web perf` sobre `main` (antes) y esta rama (después), mismo entorno. Escalas: pequeño (20 nodos, 38 conexiones, 6 grupos, 1 imagen, 30 pasos), habitual (77, 147, 21, 6 imágenes, 3 cajas de módulo, 40 pasos) y exigente (226, 434, 61, 16 imágenes, 6 cajas de módulo, 80 pasos), con grupos anidados y plegados y varias conexiones entre las mismas cajas. Peor cuadro y tareas largas (> 50 ms) del escenario; «evento» es Event Timing (del evento al cuadro que lo muestra).

| Escenario (exigente) | CPU ×1: peor cuadro | CPU ×1: tareas largas | CPU ×4: peor cuadro | CPU ×4: peor evento |
| --- | --- | --- | --- | --- |
| Arrastrar una caja | 150 → 67 ms | 25 (2,3 s) → 12 (0,7 s) | 683 → 367 ms | 752 → 480 ms |
| Escribir en el inspector (30 letras) | 117 → 50 ms | 26 (1,6 s) → 0 | 883 → 267 ms | 920 → 232 ms |
| Escribir la etiqueta de una conexión | 133 → 50 ms | 14 → 2 | 567 → 283 ms | 656 → 352 ms |
| Deshacer y rehacer | 133 → 100 ms | 6 → 3 | 700 → 433 ms | 784 → 528 ms |
| Seleccionar 10 cajas | 67 → 67 ms | 4 → 2 | 400 → 250 ms | 456 → 336 ms |
| Abrir el lienzo (tareas largas) | 759 → 340 ms en total | | 3,5 s → 1,9 s en total | |
| «Ver todo»: mayor avance en un cuadro | 0,42 → 0,27 del recorrido | | 0,39 → 0,37 | |

Habitual con CPU ×1: escribir en el inspector, 50 → 17 ms de peor cuadro; la etiqueta de una conexión, 50 → 17 ms; arrastrar, 33 ms en los dos (script 626 → 405 ms). Pequeño: sin cuadros sobre 33 ms antes ni después. Tras cinco ciclos entre features, memoria y DOM vuelven a su nivel (antes y después). Tablas completas en el PR.

En Chromium el salto inicial de «Ver todo» no aparece en estas escalas (el primer cuadro avanza 0 % en los dos casos): el bloqueo que mostraba la grabación de Safari depende del motor y del equipo. El arreglo elimina su causa —el reloj de la transición empieza en el primer cuadro dibujado— y lo cubre `camera.test.ts`. Safari no se pudo probar en este entorno.

### Seguimiento: Safari (WebKit)

Tras el primer PR, «Ver todo» seguía saltando en Safari (los tours, que desplazan a zoom fijo, iban fluidos). Medido con `perf/camara.perf.ts` en WebKit de Playwright (Linux, sin GPU: las cifras absolutas son peores que en un Mac, la proporción sirve):

- Cada cuadro de «Ver todo» tardaba 130–200 ms, y solo ~10 ms eran JavaScript: el resto es pintar el lienzo entero a otra escala. Con la cámara medida por tiempo, 320 ms daban 3 o 4 cuadros y uno solo avanzaba del 52 al 61 % del recorrido (lienzos habitual y exigente).
- Con el reloj desde el segundo cuadro y el tope por cuadro: 11 cuadros en las tres escalas, el mayor avance en un cuadro es de 0,28 y el primero, 0. El movimiento dura más cuando los cuadros son lentos (1,1–2 s en este WebKit sin GPU).
- Chromium no cambia: ~320 ms en 15–20 cuadros (a 60 fps el tope no actúa).
- Se probó poner el viewport en su propia capa (`will-change`) solo en WebKit: aquí no mejoró de forma medible y en Chromium empeora, así que no se usa. Ocultar el texto de las cajas bajaba el cuadro de ~175 a ~70 ms: el texto es lo más caro de pintar, pero quitarlo cambiaría lo que se ve.

## Fuera de alcance

- Cálculo incremental de puertos, carriles y etiquetas (solo las conexiones afectadas): cambio grande; queda como siguiente paso medido.
- Dibujar solo lo visible (`onlyRenderVisibleElements`): exige rehacer la exportación de imagen y la medición de cajas fuera de la vista.
- Validar en Safari de macOS: el banco usa el WebKit de Playwright en Linux, que pinta sin GPU.

## Impacto en el modelo

Ninguno.

## Impacto en la API

Ninguno.
