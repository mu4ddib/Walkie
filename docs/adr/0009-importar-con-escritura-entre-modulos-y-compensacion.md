# ADR-0009: Importar un `.walkie` con interfaces de escritura entre módulos y compensación

- Estado: aceptado
- Fecha: 2026-11-12

## Contexto

La spec `exportar-e-importar` (tarea 6, #148) pide `POST /api/apps/{appId}/import`. Importar crea, a partir de un `.walkie`:

- features (módulo Apps);
- los elementos del catálogo que usan, también de Apps;
- las imágenes de sus pantallas (módulo Files: fila en `files.assets` y bytes en S3);
- el lienzo de cada feature (módulo Canvas).

La importación es «todo o nada»: un archivo inválido no crea nada y un error a mitad de camino no deja nada a medias.

El monolito modular tiene estas restricciones (`apps/api/CLAUDE.md`):

- cada módulo tiene su `DbContext` internal y su schema de Postgres;
- un módulo solo habla con otro por interfaces de `Contracts/`;
- hasta ahora, esas interfaces solo leían.

Los bytes de una imagen van a S3, que no participa de una transacción de Postgres.

## Opciones consideradas

1. **Una transacción de Postgres compartida.** Los cuatro `DbContext` usan la misma conexión y `DbTransaction`, por ejemplo con un `IUnitOfWork` en `Walkie.Shared`. Atómico para la base. Contras:
   - acopla todos los módulos a una sola conexión y obliga a cambiar cómo se registra cada `DbContext`;
   - S3 sigue afuera, así que de todos modos hay que borrar bytes si algo falla.
2. **Que el módulo Export escriba en las tablas de los otros.** Contras: rompe la regla de no tocar el `DbContext` de otro módulo.
3. **Interfaces públicas de escritura en cada módulo y compensación.** Export valida todo primero, sin escribir. Después crea en orden con `IAppWriter` (Apps), `IAssetWriter` (Files) e `ICanvasWriter` (Canvas). Si algo falla, borra lo que creó en orden inverso con las mismas interfaces. Contras:
   - no es atómico frente a una caída del proceso a mitad de camino: puede quedar basura;
   - mientras dura la importación, otro usuario puede ver la feature a medio crear.

## Decisión

Opción 3.

**Primera fase: leer y validar** (`ImportHandlers.Read` y `PlanAsync`), sin escribir. Se revisa todo lo que puede fallar:

- el zip, con límites: 50 MB de archivo, 2000 entradas y 200 MB descomprimido;
- el `manifest.json`: primero el formato y las versiones, con un mensaje propio; después el schema `walkie-package`;
- cada lienzo, con la misma validación que el `PUT` (`ICanvasWriter.Validate`);
- `catalog.json`, contra `walkie-catalog-item`;
- las imágenes: que estén y tengan tipo y tamaño válidos;
- las referencias: un `catalogId` tiene que estar en el archivo o en la app de destino.

Los errores llevan la ruta dentro del archivo, por ejemplo `features/<id>/canvas.json/edges/e1/to`. Con `dryRun=true` se responde aquí el resumen.

**Segunda fase: escribir.** Se crea en este orden:

1. los elementos del catálogo nuevos;
2. las imágenes;
3. las features;
4. los lienzos, con `catalogId`, `assetId` y `targetFeatureId` reescritos y `version` 0.

Si algo falla, `UndoAsync` borra lo creado al revés, sin el token de cancelación del pedido. Tras la primera fase, la segunda solo falla por causas externas (base, S3, un error de programación).

**Ids:**

- Una feature e imagen reciben id nuevo.
- Un elemento del catálogo que ya está en la app (mismo id, al reimportar en la app de origen) se reutiliza; si no, se crea con id nuevo.
- Los nodos y las conexiones conservan su id, porque son únicos en su lienzo.

**Lo que no se puede conservar se avisa en el resumen (`warnings`), sin error:**

- un portal sin destino pierde `targetFeatureId`;
- una pantalla sin su imagen pierde `assetId`;
- una descripción de más de 500 caracteres se recorta.

## Consecuencias

- Positivas:
  - cada módulo sigue siendo dueño de sus tablas y de sus reglas: Files reconoce la imagen con `ImageInspector` y Canvas valida el grafo como en el `PUT`;
  - las interfaces de escritura sirven también para importar la app completa (tarea 7);
  - un archivo inválido no escribe nada.
- Negativas / costos:
  - si el proceso muere entre la primera escritura y el final, puede quedar una importación a medias: no hay recolector de basura;
  - `IFileStorage` suma `DeleteAsync`;
  - el archivo entero se lee en memoria (hasta 50 MB por pedido).
- Qué habría que hacer para revertirla:
  - pasar a una transacción compartida (opción 1) detrás de las mismas interfaces;
  - o marcar lo importado como «pendiente» y confirmarlo al final, con una limpieza periódica de lo que quedó pendiente.
