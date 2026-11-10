# Spec: Mapa de la app

- Issue padre: #125
- Estado: implementada

## Objetivo

Ver una app entera de un vistazo: cada feature como una caja y, entre ellas, cómo se conectan (portales) y qué componentes del catálogo comparten, para entender el panorama completo antes de entrar al lienzo de cada una.

## Alcance: una vista adicional

El mapa **se suma** a lo que ya existe, no lo reemplaza: la página de la app sigue mostrando su galería de features (miniaturas, búsqueda, orden, crear y editar) y cada feature se sigue abriendo y editando en su lienzo como hoy. El mapa es otra forma de mirar la misma app, a la que se llega a propósito con «Ver mapa».

## Usuarios

Quien llega nuevo a una app (onboarding), quien la presenta o revisa su alcance, y quien documenta y quiere comprobar que las features quedaron enlazadas.

## Criterios de aceptación

### Abrir el mapa

- [ ] Dada la página de una app, entonces sigue siendo la galería de siempre, con un botón adicional «Ver mapa»; nada de la galería cambia ni se mueve.
- [ ] Dada la página de una app, cuando uso «Ver mapa», entonces se abre `/apps/:appId/map` con el lienzo de la app. También desde el selector de app de la barra del editor.
- [ ] Dada una app sin features, entonces el mapa lo dice y ofrece crear la primera.

### Features y conexiones

- [ ] Cada feature es una caja con su nombre, su descripción (recortada), cuántas pantallas, APIs y tours/recorridos tiene, y la fecha de su última actualización.
- [ ] Dado un portal en la feature A con destino en la feature B, entonces hay una flecha A → B. Varios portales entre el mismo par se ven como una sola flecha con su cantidad («2 portales»).
- [ ] La etiqueta de la flecha dice desde dónde se llega: la caja que navega al portal (ej. «Home → Conectar cuentas para eventos»). Al seleccionar la flecha, el panel lista cada portal con su caja de origen y «Abrir en el lienzo», que abre la feature A con ese portal seleccionado.
- [ ] Una feature sin conexiones también aparece. Un portal sin destino se señala en su feature («1 portal sin destino»).
- [ ] Las flechas usan los puertos y el esquivado de cajas del lienzo (spec puertos-de-conexion).

### Componentes compartidos

- [ ] Con «Mostrar componentes compartidos» activado, cada elemento del catálogo usado por dos o más features aparece como una caja (API, servicio o base de datos) unida a cada feature que lo usa («usa»). Apagado por defecto; se recuerda.

### Recorrer y abrir

- [ ] Seleccionar una feature resalta sus conexiones y atenúa el resto; el panel muestra su resumen, de dónde llegan y a dónde salen sus portales, sus componentes compartidos y «Abrir lienzo».
- [ ] Doble clic en una feature abre su lienzo; desde el lienzo, la barra ofrece volver al mapa.
- [ ] Zoom, «Ver todo» y desplazamiento como en el lienzo de una feature. Es de solo lectura respecto del contenido: no se editan nodos ni portales desde aquí.

### Distribución

- [ ] La primera vez, las features se ubican solas de izquierda a derecha siguiendo los portales (las de entrada a la izquierda), sin encimarse.
- [ ] Las cajas se pueden mover y la distribución se guarda por app (para todos). Una feature nueva se ubica sola sin encimarse; «Reordenar» vuelve a la distribución automática.

## Fuera de alcance

- Crear o editar portales desde el mapa.
- Mapa en el enlace de solo lectura (más adelante).
- Conexiones entre apps distintas.

## Impacto en el modelo

- Nuevo `packages/schema/walkie-app-map.schema.json`: respuesta del mapa (features con resumen, conexiones por portal con su caja de origen, portales sin destino y uso del catálogo por feature).
- Posiciones por feature (`layout`: id de feature → `{x, y}`) a nivel de app.

## Impacto en la API

- `GET /api/apps/{appId}/map` → 200 con el mapa (último lienzo guardado de cada feature); 404 si la app no existe. Lo arma el módulo Canvas con `IFeatureDirectory` e `ICatalogDirectory`.
- `PUT /api/apps/{appId}/map/layout` con versión (409 si cambió), en el módulo Apps (tabla nueva o columna `jsonb` en apps; migración).

## Decisiones (autor, 2026-11-10)

- Distribución automática la primera vez, movible y guardada por app.
- Componentes compartidos del catálogo con el interruptor «Mostrar componentes compartidos», apagado por defecto.

- El mapa es una característica adicional: la galería y los lienzos de cada feature quedan como están.
