# Spec: Tours a escala

- Issue padre: #133
- Estado: implementada

## Objetivo

Cerrar las limitaciones que dejó `tours-compactos`: que el enlace de solo lectura use la misma lista compacta (con el paso activo resaltado al reproducir), mover pasos entre tours, que un tour con cientos de pasos siga fluido y que la cabecera y el pie fijos ocupen menos en pantallas bajas.

## Usuarios

Quien recorre un lienzo desde un enlace compartido (onboarding), y quien arma y reorganiza tours largos.

## Criterios de aceptación

### Enlace de solo lectura

- [x] Dado un enlace compartido, entonces la lista de tours y recorridos es la compacta (pestañas, filas, búsqueda desde cuatro), sin crear, renombrar, duplicar ni eliminar.
- [x] Al abrir uno se ven sus pasos como acordeones de solo lectura (encabezado + nota al abrirlo), con «Localizar en lienzo» y su botón para reproducirlo.
- [x] Al reproducir, el panel sigue a la vista con el paso activo resaltado (`aria-current="step"`); tocar otro paso salta a él. El reproductor usa el área que el panel deja libre.

### Mover pasos entre tours

- [x] El menú «⋯» de un paso ofrece «Mover a otro tour…» (o «recorrido») cuando hay otro del mismo tipo: elige el destino y el paso pasa al final, con su nota e identidad.
- [x] Solo se ofrecen destinos compatibles (pasos de nodo → tours; de conexión → recorridos). El store lo rechaza si no lo son; un id repetido en el destino se reemplaza por uno nuevo.
- [x] Un solo paso del historial: Ctrl+Z lo devuelve a su lugar.

### Cientos de pasos

- [x] Desde 80 pasos, la lista solo dibuja los que se ven (más un margen) y conserva la altura total con espaciadores; desplazar, abrir, arrastrar con el asa, ↑ ↓, el menú y el paso activo de la reproducción siguen funcionando.
- [x] Un tour de 300 pasos se abre y desplaza sin trabarse (en E2E: menos de 60 pasos en el DOM).

### Pantallas bajas

- [x] Con 640 px de alto o menos, la cabecera del tour es una sola fila (volver, nombre, pasos, reproducir y «⋯» como iconos) y el pie una fila compacta; los nombres accesibles no cambian.
- [x] A 1024×600 la lista de pasos tiene al menos la mitad del alto del inspector.

## Fuera de alcance

- Mover varios pasos a la vez y copiar (sin quitar) a otro tour.
- Virtualizar la lista de tours (no la de pasos).
