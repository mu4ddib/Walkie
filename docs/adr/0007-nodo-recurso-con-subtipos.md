# ADR-0007: Un tipo de nodo «resource» con subtipos para la infraestructura

- Estado: aceptado
- Fecha: 2026-11-12

## Contexto

Los tipos de nodo (actor, pantalla, regla, API, servicio, base de datos, portal y `ref`) no alcanzan para dibujar una arquitectura: buckets, funciones serverless, colas, tópicos o buses de eventos, cachés, CDN, gateways, secretos y programadores terminan como «Servicio», que pierde su significado. La base de datos asume tablas aunque `engine` acepte motores NoSQL. El autor pidió poder representarlos (spec `nodos-de-infraestructura`, #136) y eligió un nodo con subtipos.

## Opciones consideradas

1. **Un tipo de nodo por recurso** (`bucket`, `function`, `queue`…) — el schema y el código los nombran directo. Contras: cada recurso nuevo cambia el `enum` de tipos, la paleta, los colores, el catálogo, la validación y el export; la paleta crece con cada uno.
2. **Un tipo `resource` con un subtipo de una lista cerrada, y uno `custom` con nombre libre** — los recursos comparten caja, inspector, catálogo y conexiones. Los subtipos se agregan en un solo `enum` (`$defs/resource/kind`) y lo que falte lo cubre `custom`. Contras: un nivel más para leer el tipo (`type` + `resource.kind`).
3. **Nodo totalmente configurable por el usuario** (tipo, color, glifo y campos propios) — máxima flexibilidad. Contras: no hay forma de dar sentido a sus conexiones, validarlos ni exportarlos de forma útil; cada equipo inventaría sus tipos.

## Decisión

Opción 2. `node.type` suma `resource` y el nodo lleva `resource`: `kind` (enum, obligatorio), `label` (solo y siempre con `custom`), `provider`, `name` y `details` (pares clave/valor). Va en `$defs/resource` para que el catálogo lo reutilice con `$ref`, como ya hacen `http` y `database`. Lo que no es un recurso se precisa en los tipos existentes: `database.model` (relacional, documental, clave-valor…) y `runtime` en un servicio (contenedor, VM, serverless, gestionado).

## Consecuencias

- Positivas:
  - Un recurso nuevo es un valor más en `resource.kind` (con su etiqueta, glifo y forma en el export), sin tocar la lista de tipos.
  - El catálogo, los `ref`, las conexiones, los grupos y los tours funcionan igual que con cualquier nodo.
  - Los lienzos anteriores no cambian: todo es opcional, salvo `resource` dentro de un nodo `resource`.
- Negativas / costos:
  - El catálogo suma dos columnas (`resource` `jsonb` y `runtime`), con su migración.
  - Quien lea el grafo debe mirar `resource.kind` para saber qué es un recurso.
  - El front y el export repiten la lista de subtipos con sus textos; agregar uno pide tocar los tres.
- Qué habría que hacer para revertirla: convertir cada nodo `resource` en el tipo que corresponda (o en `service` con notas) con una migración del `jsonb` de los lienzos y del catálogo, y quitar `resource` del `enum` y de `$defs`.
