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

**Respuesta de la subida** (agregado en la tarea 3): `walkie-discovery-upload.schema.json` es la respuesta de `POST /api/apps/{appId}/sources/snapshots`, con `status` (`preview`, `created` o `existing`), `duplicate` (`pack` o `content`), el `snapshot` y un `summary` del paquete. Se agregó porque `walkie-discovery-snapshot` exige `id` e `importedAt`, que una vista previa (`dryRun`) no tiene. Los schemas anteriores no cambian: reutiliza sus `$defs` por `$ref`.

**Revisión, decisiones y fuentes** (agregado en la tarea 4):
- **Coincidencia ambigua:** `walkie-discovery-review` suma `candidates`, opcional y con dos o más elementos, en un ítem `new`. Varios elementos existentes coinciden por el mismo motivo y no se elige ninguno; la propuesta es `none` y decide la persona. Se agregó porque `match` admite un único `target`: con varios candidatos, el contrato obligaba a elegir uno al azar o a ocultar la ambigüedad.
- **`walkie-discovery-sources`:** es la respuesta de `GET /api/apps/{appId}/sources`, que la spec nombraba sin contrato.
- **Firma verificable:** la clave de `DiscoveryKeys` calculada desde el contrato del elemento existente (api: método y ruta; database: motor y nombre; resource: subtipo y nombre). Servicios, módulos y features no tienen firma: coinciden solo por título, como sugerencia.
- **`missing`:** solo si cada detector que dio la evidencia en el análisis anterior corrió entero en el actual, cada archivo de esa evidencia está en el alcance actual y ninguna limitación alcanza a esos archivos, a esos detectores ni al análisis entero (`file-limit`, `entity-limit`).
- **Versión del vínculo:** restablecer conserva la fila sin decisión, así la versión del vínculo nunca vuelve atrás. `bindingVersion` 0 significa «sin decisión activa».
- **Solo sobre el último análisis:** las decisiones se toman sobre el último análisis de la fuente. Decidir sobre uno anterior guardaría un fingerprint que ya no es el actual.

**Front y dos puntos pendientes** (tarea 8). El analizador del front no cambió el formato: produce `screen`, `feature` (inferida, con `members`), `api`, `calls`, `navigates` y `exposes` con los contratos de siempre. Dos diferencias quedan para decidir, sin cambiar el comportamiento:

1. **La clave de una pantalla no distingue la app.**
   - **Qué pasa:** `screen:<ruta>` hace que, en un monorepo, `/pedidos` de dos apps sea una sola pantalla. Hoy se avisa con la limitación `ambiguous-route`.
   - **Propuesta:** si hace falta separarlas, `screen:<app>:<ruta>` con `formatVersion` 1 y su migración.
2. **El texto del schema y el validador no dicen lo mismo sobre `skipped`.**
   - **Qué pasa:** `walkie-discovery-pack` describe `skipped` como «no corrió (no aplica o se excluyó)», pero el validador exige que todos hayan corrido para un análisis `complete`.
   - **Qué hace el analizador hoy:** un detector sin nada que mirar (no hay apps Angular) informa `ran` con su motivo en `reason`, y `skipped` queda para `--detectors`.
   - **Propuesta:** corregir solo la descripción del schema a «no corrió porque se excluyó (`--detectors`); un detector sin nada que mirar corre e informa por qué en `reason`».

**Crear en el catálogo** (agregado en la tarea 6):
- `create` lleva el id (UUID v7) del cliente: se valida que sea v7, que no esté en el catálogo (de ninguna app) ni planificado por otra aplicación. Solo `api`, `service`, `database` y `resource`; `module` y `feature` llegan en la tarea 9 y una pantalla entra con su feature.
- Un hallazgo con una decisión activa no se crea: primero se restablece (409).
- **Transformación hallazgo → elemento:** tipo y título del hallazgo; descripción solo si el análisis la trajo; `http`, `database`, `resource` y `runtime` se copian tal cual (el paquete usa los mismos `$defs` que el catálogo). Nada de la procedencia entra al elemento: lo observado o inferido, la confianza y la evidencia quedan en el hallazgo y su vínculo. La validación es la oficial del catálogo (`IAppWriter.ValidateCatalogItem`) y la vista previa la arma Apps con la misma limpieza que al crear (`IAppWriter.PreviewCatalogItem`).
- **Sin duplicar:** si ya hay un elemento del mismo tipo con la misma firma, crear da 409 y pide vincular. Un título igual solo avisa (`same-title`).
- **Avisos** en la vista previa: `inferred`, `low-confidence`, `logical-database` (una base que solo viene de un DbContext de EF es el modelo de la aplicación, no una base física confirmada) y `to-complete` (campos sin evidencia que quedan vacíos).
- `walkie-discovery-apply-result` suma `created[].item`: el elemento tal como queda (`walkie-catalog-item`), con su id. `walkie-discovery-review` suma `targetMissing`: el elemento vinculado o creado se borró a mano y la decisión ya no apunta a nada.
- **Procedencia:** `walkie-discovery-provenance.schema.json` es la respuesta de `GET /api/apps/{appId}/bindings?target={kind}:{id}` (la spec la nombraba sin contrato): los vínculos activos que apuntan al elemento, con su fuente, el hallazgo y hasta 20 evidencias del análisis en que se decidió, y si el último análisis lo sigue viendo (`same`, `changed`, `not-found`). `targetExists` dice si el elemento sigue existiendo.

**Evidencia de un hallazgo** (agregado en la tarea 5): `walkie-discovery-evidence.schema.json` es la respuesta de `GET /api/snapshots/{snapshotId}/evidence?entityKey=`: la evidencia (los `$defs` de `walkie-discovery`) y las relaciones (hasta 100) de un solo hallazgo, con `foundIn` (el análisis pedido o, para un `missing`, el anterior). Se agregó porque la revisión trae solo `evidenceCount` (sumar la evidencia a cada ítem multiplicaría el tamaño de cada página) y la web no debe pedir el análisis entero para mostrar un hallazgo.

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
  - cambiar el nombre de un servicio o de un módulo cambia su clave: se ve como uno que no aparece y otro nuevo, y la persona lo vuelve a vincular. Para que la revisión pueda proponer la correspondencia sin un sistema de matching, la evidencia conserva lo que no cambia con el nombre: la carpeta y el ancla (`symbol`, ej. `Project` del `.csproj`, `services.<nombre>` de compose). Un `missing` y un `new` del mismo tipo con la misma carpeta y ancla son una posible correspondencia, nunca una decisión automática (prueba `Renombrar_un_proyecto_…` en `apps/cli/tests`);
  - el JSON canónico escribe los números no enteros con el formato de .NET (`R`); el formato solo usa enteros.
- Qué habría que hacer para revertirla:
  - las claves y los fingerprints viven en `Walkie.Shared`: cambiar el algoritmo es una versión nueva del formato con una migración que recalcule;
  - pasar a NDJSON o a varios archivos es otra versión, con el mismo modelo.
