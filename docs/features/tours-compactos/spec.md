# Spec: Tours compactos

- Issue padre: #132
- Estado: implementada

## Objetivo

Gestionar tours y recorridos con muchos pasos (y muchos tours) sin que el panel lateral se vuelva una lista interminable: entender la secuencia leyendo encabezados cerrados, editar cómodamente un paso a la vez y reordenar con facilidad.

## Usuarios

Quien arma tours de onboarding largos (decenas de pasos) y quien mantiene varios tours y recorridos por feature.

## Criterios de aceptación

### Dos niveles

- [x] Dada la sección de tours, entonces cada tour es una fila compacta con su nombre (recortado, completo al pasar el puntero), sus pasos, ▶ para reproducirlo y «⋯» con renombrar, duplicar y eliminar.
- [x] Dados cuatro o más tours, entonces hay búsqueda por nombre; sin resultados, un estado que lo dice con «Limpiar búsqueda».
- [x] Crear un tour está siempre a la vista (nombre + «Nuevo tour»).
- [x] Al abrir un tour, su editor ocupa el mismo panel con «← Volver a tours»; al volver se recuperan la búsqueda y el desplazamiento.

### Pasos en acordeón

- [x] Los pasos están cerrados por defecto. El encabezado muestra número, icono del tipo, nodo (o «Origen → Destino» en un recorrido), su tipo (o lo que hace la conexión), una vista previa de la nota (o el aviso si hay un problema) e indicador de expandir.
- [x] Abierto: el elemento, la nota (crece con lo escrito y se puede ampliar) y «Localizar en lienzo».
- [x] Un solo paso abierto por defecto; «Expandir todos» y «Contraer todos» en la cabecera.
- [x] Un paso nuevo (agregado, insertado o duplicado) se abre con el foco en su primer campo. Lo escrito va al store en cada tecla: cerrar o abrir otro no pierde nada y respeta el guardado manual y el automático.

### Organizar

- [x] Reordenar arrastrando desde el asa (⠿); alternativa accesible: ↑ ↓ con el foco en el asa y «Subir»/«Bajar» en «⋯». La numeración se actualiza y el paso conserva su identidad, si estaba abierto y lo que tiene.
- [x] «⋯» de cada paso: localizar, subir, bajar, insertar paso después, duplicar y quitar. Asa, encabezado y menú son zonas separadas.
- [x] «Agregar paso» queda fijo abajo del panel.

### Panel

- [x] Cabecera fija con volver, nombre, pasos y reproducir; un solo desplazamiento (el del inspector), sin listas con scroll propio.
- [x] Estados claros: tour vacío, búsqueda sin resultados y paso cuya referencia se eliminó (encabezado marcado; la nota se conserva; reemplazar o quitar).

### Reproducción

- [x] Durante la reproducción el panel sigue a la vista: la lista (de solo lectura, sin desplegar nada) resalta el paso activo y se desplaza solo si hace falta; tocar un paso salta a él. Los reproductores se ubican en el área libre del lienzo.
- [x] Al terminar o detener vuelve el estado de edición, con los pasos que estaban abiertos.
- [x] Tours y recorridos usan los mismos componentes, cada uno con sus propiedades.

### Persistencia y accesibilidad

- [x] Abrir, cerrar, buscar y desplazar son estado de interfaz: no marcan cambios.
- [x] Cada paso tiene identidad (`step.id`); reordenar, duplicar o quitar no mezcla notas ni referencias. Los tours guardados antes la reciben al abrirse, sin marcar cambios.
- [x] Teclado: encabezados y asas enfocables con foco visible, `aria-expanded`, menú con flechas y Esc, el paso activo con `aria-current`.

## Fuera de alcance

- Mover pasos entre tours.
- Virtualizar listas de cientos de pasos.

## Impacto en el modelo

`tour.steps[].id` opcional (único en su tour). Ausente en lienzos anteriores: se asigna al abrirlos.

## Impacto en la API

`GraphValidator`: un id de paso repetido en un tour responde 400. Sin endpoints nuevos.
