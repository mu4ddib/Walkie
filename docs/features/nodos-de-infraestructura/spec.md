# Spec: Nodos de infraestructura

- Issue padre: #136
- Estado: en curso (tarea 1 de 3 hecha)

## Objetivo

Que una arquitectura se pueda dibujar completa en Walkie: almacenamiento de objetos, funciones, colas, buses y tópicos, cachés y los distintos tipos de base de datos, con un nodo que diga qué es cada cosa sin tener que usar «Servicio» como comodín.

## Situación actual

Tipos de nodo: actor, pantalla, regla (o decisión), API, servicio, base de datos, portal y `ref` (componente del catálogo), más notas adhesivas y grupos. «Servicio» termina representando cualquier cosa que no es una API ni una base (un bucket, una lambda, una cola…), y «Base de datos» asume tablas aunque `engine` acepte MongoDB. El catálogo solo guarda `api`, `service` y `database`.

## Propuesta

1. **Nodo «Recurso»** (`resource`) con un subtipo de una lista cerrada, cada uno con su glifo y color:
   - almacenamiento de objetos (bucket), función (serverless), cola, tópico o bus de eventos, caché, CDN, balanceador o API gateway, secreto o configuración, programador (cron), y **personalizado** (nombre libre del subtipo, ej. «Step Functions»).
   - Campos comunes: proveedor opcional (AWS, Azure, GCP, on-premise, otro), nombre del recurso, y «Detalles» como pares clave/valor (ej. `retención: 7 días`, `runtime: node20`), además de notas.
2. **Base de datos con modelo**: un campo opcional `model` (relacional, documental, clave-valor, columnar, grafo, búsqueda, series de tiempo). La estructura se adapta: tablas en relacional, colecciones en documental, etc. (hoy `kind` ya admite `table`, `collection` y `view`).
3. **Servicio más claro**: «Servicio» se describe como lógica de negocio desplegada (microservicio, worker, monolito), con un campo opcional `runtime` (contenedor, VM, serverless, gestionado). El texto de ayuda de la paleta lo explica; lo que no es lógica propia va como recurso.

## Usuarios

Quien documenta la arquitectura de una feature o de un banco (onboarding técnico, revisión de integraciones).

## Criterios de aceptación

### Crear y ver

- [ ] Dada la barra de herramientas, entonces hay un botón «Recurso» (con su tecla, la 8) que abre la lista de subtipos con glifo y una línea de qué es; elegir uno lo crea en el centro (o arrastrándolo al lienzo, como los demás).
- [ ] Dado un recurso, entonces su caja muestra el glifo y el nombre del subtipo en la cabecera (ej. «Bucket», con un glifo propio en el estilo pixel, como los demás tipos), su título, el proveedor y hasta tres detalles.
- [ ] Dado un recurso personalizado, entonces la cabecera muestra el subtipo escrito por el usuario.
- [ ] Dado el inspector de un recurso, entonces edita subtipo (cambiarlo conserva título, conexiones y detalles), proveedor, nombre, detalles y notas.
- [ ] Dada una base de datos, entonces el inspector ofrece el modelo y la caja lo muestra («Base de datos · documental»).

### Conexiones

- [ ] Dado un recurso, entonces el tipo de conexión por defecto sigue su naturaleza: hacia una cola o tópico, `event`; hacia un bucket o caché, `writes`; desde ellos, `reads`; hacia una función, `request` (invocación); el resto, `uses`. Siempre se puede cambiar.

### Catálogo y resto de Walkie

- [ ] Dado un recurso, entonces «Guardar como componente» funciona como con API, servicio y base de datos, y se reutiliza desde «Componentes».
- [x] El export a Markdown tiene una sección «Recursos» agrupada por subtipo, con tipo, proveedor, nombre y detalles; el diagrama Mermaid usa la forma adecuada (cilindro para bases y almacenamiento, bandera para colas y tópicos, subrutina para funciones) y el subtipo como etiqueta. El contexto para IA lo hará `exportar-e-importar`.
- [ ] El mapa de la app, los tours, los grupos, los enlaces compartidos y deshacer funcionan con recursos igual que con cualquier nodo.
- [x] Lienzos anteriores se abren sin cambios; ningún nodo existente cambia de tipo solo.

## Fuera de alcance

- Íconos oficiales de proveedores (AWS, Azure, GCP): marcas registradas; se usan glifos propios.
- Importar infraestructura desde Terraform o CloudFormation.
- Tipos de nodo definidos por el usuario con campos propios (más allá del subtipo personalizado y los detalles clave/valor).
- Convertir automáticamente servicios existentes en recursos (se puede cambiar a mano con «Cambiar tipo»).

## Impacto en el modelo

`packages/schema/walkie-graph.schema.json`:
- `node.type` agrega `resource`, que lleva (obligatorio) el objeto `resource` = `$defs/resource`: `kind` (`storage`, `function`, `queue`, `topic`, `cache`, `cdn`, `gateway`, `secret`, `scheduler`, `custom`), `label` (≤ 40, solo y siempre con `custom`), `provider` (`aws`, `azure`, `gcp`, `on-premise`, `other`), `name` (≤ 120) y `details` (≤ 30 pares `{ key ≤ 40, value ≤ 200 }`). Un objeto y no campos sueltos: así el catálogo lo reutiliza con `$ref`, como `http` y `database`.
- `$defs/database.model` (`relational`, `document`, `key-value`, `wide-column`, `graph`, `search`, `time-series`) y `runtime` en el nodo = `$defs/runtime` (`container`, `vm`, `serverless`, `managed`, `other`), opcionales.
- `walkie-catalog-item.schema.json`: `type` agrega `resource`, con `resource` y `runtime` por `$ref`.
- ADR-0007: un tipo con subtipos y no un tipo por recurso.

## Impacto en la API

- `GraphValidator`: el schema valida los campos y límites; la integridad suma `resource` solo en nodos `resource` y `runtime` solo en `service`.
- Catálogo: acepta `type: resource` (con `resource` obligatorio) y `runtime` en servicios; columnas `resource` (`jsonb`) y `runtime` (migración `CatalogResourceAndRuntime`).
- Export: sección «Recursos». Sin endpoints nuevos.

## Decisiones

- 2026-11-12, autor: un solo nodo «Recurso» con subtipos (más «personalizado» con nombre libre), `model` en Base de datos y `runtime` en Servicio. Sin color ni glifo elegidos por el usuario.

## Preguntas abiertas

- ¿Faltan subtipos para banca (ej. HSM, core bancario o mainframe, ETL, data lake)? Mientras tanto, «personalizado» los cubre.
