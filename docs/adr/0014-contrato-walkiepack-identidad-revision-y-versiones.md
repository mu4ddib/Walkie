# ADR-0014: Contrato del `.walkiepack`: identidad estable, revisión por operaciones y versiones del formato

- Estado: aceptado
- Fecha: 2026-11-14

## Contexto

ADR-0012 fija que Discovery es una capa complementaria que guarda análisis y decisiones fuera del grafo. ADR-0013 fija un `.walkiepack` generado por un CLI .NET estático. Falta el contrato que consumirán el CLI y la API. Tiene que cumplir esto:

- Llevar versión de formato y de analizador, fecha, alcance y procedencia.
- No ser un lienzo: sin posiciones, sin código fuente completo por defecto y sin secretos.
- Aceptar análisis parciales y describir lo que el analizador puede y no puede hacer.
- Distinguir lo observado, lo inferido y lo confirmado.
- Reconocer un componente entre análisis sucesivos sin depender de líneas ni de rutas volátiles.
- Representar snapshots, vínculos con lo que ya existe, revisión y propuestas de cambio.
- Evolucionar de forma controlada sin tocar `walkie-graph`.

## Opciones consideradas

1. **Estructura del paquete.**
   - Un archivo por sección (manifest, fuente, entidades, relaciones, evidencia, capacidades): cada parte por separado. Contras: las referencias cruzan archivos y la integridad se valida entre ellos.
   - **`manifest.json` + `discovery.json`:** el manifest es pequeño y se lee primero; el resto se valida en una pasada.
   - NDJSON (una entidad por línea): se puede leer en streaming. Contras: no hay necesidad medida y el schema es más difícil de aplicar.
2. **Identidad entre análisis.**
   - Ids aleatorios por análisis: no reconocen nada entre análisis.
   - Ruta y línea: cambian con cualquier edición o movimiento.
   - Hash del contenido como identidad: cambia con cualquier edición.
   - **Clave semántica normalizada + fingerprint de contenido aparte:** la clave dice *qué es*, el fingerprint dice *si cambió*.
3. **Confirmación.** Dentro del paquete: el analizador se confirmaría a sí mismo. **Solo en Walkie, como vínculo que decide una persona.**
4. **Cambios desde la revisión.**
   - Un endpoint por acción (vincular, descartar, aplicar): varios caminos con reglas propias.
   - **Una lista de operaciones** (`create`, `link`, `reject`, `reset`), con `dryRun` como vista previa: un solo camino idempotente.
5. **Evolución del formato.**
   - Esquema abierto (`additionalProperties` libre): ningún lector detecta lo que no entiende.
   - **Esquema cerrado con `formatVersion` entero y migraciones puras:** lo que no se entiende se rechaza con un mensaje claro.

## Decisión

**Paquete.** Un zip con dos archivos:
- `manifest.json` (`walkie-discovery-pack.schema.json`):
  - `format`, `formatVersion` y `schemaVersion` (del grafo cuyos `$defs` usa);
  - `generatedAt`, `analyzer` (nombre y SemVer);
  - `source` (id estable de `.walkie/source.json` y nombre, nunca una ruta) y `vcs`;
  - `detectors`, que son las capacidades: id, versión, `status` (`ran`, `skipped` o `failed`, con motivo) y `produces` (qué tipos de entidad y relación puede dar);
  - `scope`, `completeness` (`complete` o `partial`), `technologies`, `limitations`, `stats` e `includeSnippets`.
- `discovery.json` (`walkie-discovery.schema.json`): `entities`, `relations` y `evidence`.

**Lo que no puede llevar:** no hay campos de posición ni de layout. El schema es cerrado, así que no se pueden agregar, y las pruebas lo verifican. Tampoco hay campos de decisión. Un fragmento de código solo es posible con `includeSnippets`, con un máximo de 2.000 caracteres. Los secretos los excluye el analizador y quedan anotados en `limitations` (`secret-excluded`).

**Observado, inferido y confirmado:**
- **Observado** (`basis: observed`): declarado tal cual en el código o la configuración. Puede tener confianza `high`.
- **Inferido** (`basis: inferred`): deducido por convención o heurística. Nunca tiene confianza `high` y puede decir de qué entidades sale (`derivedFrom`).
- **Confirmado:** solo existe como vínculo en Walkie (`walkie-discovery-binding`, decisión `linked`, `created` o `rejected`, con quién y cuándo).

**Identidad estable.** La clave sale de lo que define al componente; `DiscoveryKeys` (`Walkie.Shared`) la arma y el validador la exige:

| Tipo | Clave |
|---|---|
| api | `api:<MÉTODO> <ruta>` |
| screen | `screen:<ruta>` |
| service | `service:<nombre>` |
| database | `database:<motor en minúsculas>/<nombre>` |
| resource | `resource:<subtipo>/<nombre>` |
| module, feature | `module:<nombre>`, `feature:<nombre>` |
| relación | `<kind>:<from>-><to>` |

- **Ruta normalizada:** barra inicial, sin barras repetidas ni final, sin query, y cada parámetro como `{}` (`{id}`, `{id:int}`, `{*x}`, `:id`, `[id]` y `[...slug]` dan lo mismo). Renombrar un parámetro no cambia la identidad.
- **Evidencia:** lleva `path` relativo y un ancla `symbol` estable (ej. `PedidosEndpoints.MapPedidos`, `services.db`). Las líneas son informativas y no forman parte de ninguna identidad.

**Fingerprints** (`DiscoveryFingerprint`): `sha256:` + SHA-256 del JSON canónico (claves ordenadas, sin espacios, escape mínimo de RFC 8785, enteros tal cual).
- El de una **entidad** excluye `key`, `fingerprint`, `basis`, `confidence`, `derivedFrom` y `evidence`. Cambia si cambia lo que describe, no si se mueve de línea.
- El del **contenido** es el de todo `discovery.json`. Dos análisis del mismo árbol dan el mismo aunque cambie `generatedAt`.

**Snapshots** (`walkie-discovery-snapshot`): un análisis cargado es inmutable. Guarda:
- la procedencia del manifest (incluida la versión de formato con la que llegó);
- quién y cuándo lo cargó;
- `packSha256` (el archivo) y `contentFingerprint`.

Cargar el mismo archivo, o uno con el mismo contenido que el último análisis de esa fuente, devuelve el existente.

**Vínculos y revisión:**
- El vínculo une `(fuente, clave)` con un elemento por id (`target`: `catalogItem`, `module` o `feature`; sin copiar su contenido). Guarda el fingerprint de cuando se decidió.
- La revisión (`walkie-discovery-review`) se calcula y no se guarda. Cada hallazgo tiene un estado:
  - `new`: sin vínculo ni coincidencia;
  - `matched`: coincide por firma o por título; por título solo es sugerencia;
  - `linked`, `created` o `rejected`: el vínculo y su decisión;
  - `changed`: el fingerprint cambió desde la decisión;
  - `missing`: estaba vinculado y ya no aparece, **solo si un detector que produce ese tipo corrió** en este análisis. Un análisis parcial nunca da `missing` por lo que no miró.
- Cada hallazgo trae una propuesta (`create`, `link` o `none`).

**Operaciones** (`walkie-discovery-apply` → `walkie-discovery-apply-result`): una lista con `applyId` del cliente.
- `create` lleva el id (UUID v7) del cliente; `link` lleva el `target`; `reject` y `reset` no llevan ninguno de los dos.
- Cada operación puede llevar `bindingVersion` (concurrencia, 409).
- Con `dryRun` el resultado es `planned`: la vista previa, que dice qué se crea, se vincula, se descarta, se restablece y **qué no cambia**.
- Esto reemplaza el `PUT .../bindings/{key}` que preveía la spec: descartar o vincular es una operación más.

**Integridad que el schema no expresa** (`DiscoveryPackValidator`, puro, en `Walkie.Shared`, para el CLI y la API):
- claves e ids únicos y en orden ordinal;
- referencias que existen: evidencia, extremos, miembros, `derivedFrom`, interfaces dentro de los miembros, tecnologías y detectores;
- fingerprints y claves normalizadas que coinciden;
- la evidencia viene de detectores que corrieron, y el tipo, de un detector que dice producirlo;
- `complete` solo si todo corrió sobre `**/*`;
- `snippet` solo con permiso;
- `stats` coincide con el contenido.

Los errores llevan la ruta dentro del paquete (`discovery.json/entities/3/evidence/0`).

**Versiones:**
- `formatVersion` sube con cualquier cambio que un lector actual rechazaría: un campo nuevo (el schema es cerrado), un valor nuevo en un enum o un requisito nuevo.
- Un lector acepta desde 0 hasta su versión, subiendo el paquete con migraciones puras (`DiscoveryFormat.Migrations`, una por versión). Una versión mayor se rechaza **antes del schema** con un mensaje propio («actualiza Walkie»), y lo mismo un `schemaVersion` del grafo mayor que el del lector.
- Al subir la versión:
  - el schema vigente se congela en `packages/schema/walkiepack/v<N>/`;
  - sus ejemplos se conservan;
  - una prueba los sube y valida con el schema nuevo.
- La versión 0 se definió en la tarea 1, sin consumidores ni paquetes en circulación, y esta tarea la reescribe sin subirla. La política rige desde que llega a `main`.
- Los registros de la API (snapshot, vínculo, revisión, operaciones) siguen la regla del resto de schemas del repo: si cambian, cambian en el mismo PR que la API y la web.

**Compatibilidad:**
- `walkie-graph.schema.json` no cambia.
- Las entidades usan sus `$defs` (`http`, `database`, `resource`, `runtime`) por `$ref`, sin copiarlos: lo aprobado se vuelve un elemento del catálogo válido sin traducir (`DiscoveryCompatibilityTests`).
- `target` referencia por id, como `catalogId` y `moduleId` en el grafo.

## Consecuencias

- Positivas:
  - un solo contrato verificable por el CLI y la API, con el mismo validador;
  - un componente se reconoce entre análisis aunque cambien las líneas, el archivo o el nombre de un parámetro;
  - un análisis parcial es válido y nunca da por desaparecido lo que no miró;
  - la vista previa usa las mismas reglas que aplicar;
  - un paquete de una versión futura falla con un mensaje claro.
- Negativas / costos:
  - el paquete exige orden y fingerprints, así que el analizador tiene que calcularlos (`DiscoveryFingerprint`, `DiscoveryKeys`);
  - cada campo nuevo sube `formatVersion` y requiere una migración;
  - cambiar el nombre de un servicio o de un módulo cambia su clave: se ve como uno que no aparece y otro nuevo, y la persona lo vuelve a vincular;
  - el JSON canónico escribe los números no enteros con el formato de .NET (`R`); el formato solo usa enteros.
- Qué habría que hacer para revertirla:
  - las claves y los fingerprints viven en `Walkie.Shared`: cambiar el algoritmo es una versión nueva del formato con una migración que recalcule;
  - pasar a NDJSON o a varios archivos es otra versión, con el mismo modelo.
