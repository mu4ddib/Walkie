# ADR-0010: Módulos compartidos como features de tipo `module` con interfaces en su lienzo

- Estado: aceptado
- Fecha: 2026-11-13

## Contexto

La spec `modulos-compartidos` pide definir una vez un conjunto de componentes conectados y reutilizarlo en varias features. Un módulo necesita lo mismo que una feature: un lienzo con nodos, grupos, conexiones, tours, guardado con versión (409), autoguardado, deshacer, imágenes de la app y catálogo. Las features que lo usan solo necesitan un resumen (nombre, descripción e interfaces con su contrato), no su grafo entero. Los módulos no tienen FK entre sí (Apps y Canvas son módulos de la API sin transacción común, ADR-0009).

## Opciones consideradas

1. Tabla propia `apps.modules` y lienzo en una tabla nueva de Canvas — separa los conceptos, pero duplica guardado, versión, validación de referencias, endpoints del lienzo y el editor.
2. Copiar el grafo del módulo dentro de cada feature — sin consultas extra, pero cada cambio tendría que reescribir todas las features y el grafo crece con cada uso.
3. **Una feature con `kind = module`** — reutiliza `canvas.canvases`, `GET/PUT /api/features/{id}/canvas`, el editor y el import/export; las listas de features filtran por tipo.

## Decisión

Opción 3. El módulo es una fila de `apps.features` con `kind = 'module'` y su lienzo es un lienzo más. Sus **interfaces** viven en su propio grafo (`interfaces`: id estable, nombre, tipo, caja interna), así se versionan, se deshacen y se guardan con él. Una feature lo referencia con un nodo `module` (`moduleId` + presentación local) y sus conexiones apuntan a una interfaz por id (`toInterface`/`fromInterface`, con el último nombre conocido para reparar). La web pide **un resumen por app** (`GET /api/apps/{appId}/modules`, una consulta compartida que se invalida al guardar cualquier lienzo) y carga el grafo completo solo al abrir el módulo.

La validación de referencias (Canvas) exige que `moduleId` sea un módulo de la misma app (un id que no existe se acepta: es una referencia pendiente, ej. a un módulo borrado), que solo un módulo tenga `interfaces` y que no haya ciclos de contención entre módulos (las conexiones entre módulos no cuentan). La conversión de una selección (`POST /api/apps/{appId}/modules/extract`) crea el módulo y su lienzo y guarda la feature al final; si esto falla, borra lo creado (compensación, como ADR-0009). El id del módulo lo genera el cliente: reintentar con el mismo id no duplica.

## Consecuencias

- Positivas: el editor, el guardado (manual, automático, 409), el historial, las imágenes y el catálogo funcionan en un módulo sin código nuevo; los resúmenes cuestan una consulta por app.
- Negativas / costos: toda lista de features de la API filtra por `kind` (`IFeatureDirectory` lo hace por defecto y `ModulesOfAppAsync` da los módulos); reasignar o borrar una interfaz reescribe los lienzos que la usan (sube su versión: un editor abierto ahí recibe 409 y recarga); el resumen se calcula leyendo los lienzos de la app (aceptable para decenas de features).
- Qué habría que hacer para revertirla: mover las filas `kind = module` a una tabla propia y sus lienzos a otra, manteniendo los ids (los `moduleId` de los grafos siguen valiendo).
