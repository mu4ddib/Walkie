# ADR-0012: Módulo Discovery con la procedencia fuera del grafo

- Estado: aceptado
- Fecha: 2026-11-14

## Contexto

La spec `walkie-live` carga en una app lo que un analizador local descubre en el código (entidades, relaciones y evidencia), lo revisa y aplica solo lo aprobado al catálogo, los módulos y las features. Hechos del repositorio:

- El lienzo es la fuente de verdad visual: un documento `jsonb` por feature con `version` (409), editado solo por acciones del store; `layout` va aparte del contenido.
- En `walkie-graph.schema.json`, `node` no tiene `additionalProperties: false` (`edge` y la raíz sí): hoy un nodo acepta campos extra.
- La API es un monolito modular sin transacción entre módulos; la importación escribe por `IAppWriter` e `ICanvasWriter` y compensa (ADR-0009).
- Los elementos del catálogo reciben id del servidor (`CatalogItem.Id`); los módulos, id del cliente (`IAppWriter.CreateModuleAsync`).
- No hay autorización por app: cualquier usuario autenticado lee y escribe cualquier app.

## Opciones consideradas

1. **Procedencia dentro del grafo** (ej. `node.source = { key, snapshotId }`): se ve donde está el nodo. Contras: mezcla contenido y descubrimiento, depende de una laxitud del schema, reanalizar obligaría a reescribir lienzos (409 con editores abiertos) y no sirve para elementos del catálogo, que no son nodos.
2. **Ampliar Export/Import** con el nuevo formato: reutiliza el código del `.walkie`. Contras: Export no tiene tablas y esto necesita guardar análisis y decisiones; mezcla reconstruir lienzos con revisar candidatos.
3. **Módulo nuevo `Walkie.Modules.Discovery`** con schema `discovery` propio: fuentes, análisis (snapshots), entidades, relaciones, evidencia y vínculos (`bindings`: clave de la entidad → elemento del catálogo, módulo o feature, con decisión `linked`, `created` o `rejected`). Lee el catálogo y los módulos por `ICatalogDirectory`, `IFeatureDirectory` e `IModuleDirectory` y aplica por `IAppWriter` e `ICanvasWriter` con compensación. Contras: un módulo y unas tablas más; un vínculo puede quedar apuntando a algo borrado a mano.
4. **Base de grafos o servicio aparte**: consultas de grafo nativas. Contras: infraestructura nueva sin una consulta que lo pida; Postgres con `jsonb` e índices alcanza para miles de entidades por análisis.

## Decisión

Opción 3. Discovery depende de Apps y Canvas y nadie depende de él, así que no hay ciclos. El grafo no cambia: la procedencia se resuelve consultando los vínculos. Las propuestas no se guardan: la revisión se calcula a partir del análisis, los vínculos y el catálogo y los módulos actuales. Solo se guardan las decisiones, que persisten entre análisis de la misma fuente. Aplicar valida todo, crea en orden (catálogo con id del cliente, módulos, features con lienzo nuevo), escribe los vínculos al final y compensa si algo falla. Nunca escribe en lienzos existentes ni borra nada. Un `applyId` del cliente, junto con la unicidad `(fuente, clave)` de los vínculos, hace idempotente el reintento.

## Consecuencias

- Positivas: el editor, el store y el contrato del grafo no cambian; un análisis inválido no toca nada; los descartes se recuerdan; la evidencia se consulta sin abrir lienzos.
- Negativas / costos:
  - `IAppWriter` suma crear un elemento del catálogo con id dado y borrarlo para compensar;
  - la lectura segura del zip sale de `ImportHandlers` a `Walkie.Shared`;
  - si el proceso muere a mitad de aplicar pueden quedar elementos sin vínculo, como en ADR-0009 (el siguiente review los ofrece como coincidencia por firma);
  - un vínculo a un elemento borrado se muestra como pendiente;
  - sin autorización por app, cualquier usuario autenticado ve rutas de archivos y nombres internos. Se acepta como riesgo y se mitiga sin fragmentos de código por defecto (ADR-0013).
- Qué habría que hacer para revertirla: borrar el módulo y su schema; los lienzos y el catálogo creados quedan como contenido normal, porque no dependen de Discovery.
