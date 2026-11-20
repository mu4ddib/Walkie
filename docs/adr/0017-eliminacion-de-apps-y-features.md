# ADR-0017: Eliminación de apps y features en dos fases con bitácora

- Estado: propuesto (2026-11-20). Implementado en la rama `feat/eliminar-apps-y-features` (`docs/features/eliminar-apps-y-features`), apilada sobre la autorización por app (ADR-0015, PR #176)
- Fecha: 2026-11-20

## Contexto

Walkie no deja borrar una app ni una feature desde la interfaz. Existen `IAppWriter.DeleteAppAsync` y `DeleteFeaturesAsync`, pero son para **compensar** una importación a medio hacer (ADR-0009): borran filas de Apps y nada más. Lo que pertenece a una app vive en varios módulos sin claves foráneas entre ellos (monolito modular):

| Módulo | Qué guarda de una app o feature |
|---|---|
| Apps | la app, sus features y módulos (ADR-0010), el catálogo y las membresías (ADR-0015) |
| Canvas | el lienzo de cada feature o módulo (con sus tours y recorridos) y el mapa de la app |
| Files | las imágenes (fila en `files.assets` y bytes en S3/RustFS, ADR-0004) |
| Sharing | los enlaces públicos de cada feature (ADR-0005) |
| Discovery | fuentes, análisis inmutables con su evidencia, vínculos, bitácoras de aplicación y de importación (ADR-0012, ADR-0014) |

No hay transacción entre esos `DbContext` ni con S3. Un borrado que falla a mitad no puede dejar la app oculta en la galería mientras sus enlaces públicos, imágenes o análisis siguen accesibles, ni registros huérfanos sin forma de saberlo.

## Opciones consideradas

1. **Eliminación definitiva inmediata.** Pros: lo que se borra deja de existir; no hay estados intermedios para el resto del producto. Contras: no se recupera; hay que coordinar cinco módulos sin transacción.
2. **Eliminación lógica con recuperación** (una marca en la app). Pros: reversible. Contras: **cada** consulta de Canvas, Files, Sharing, Discovery y Export tendría que respetar la marca, también las públicas y las que hacen otros módulos por sus contratos; una sola que la olvide deja la app visible o editable (justo lo que no queremos). Además, los bytes de las imágenes y los análisis seguirían ocupando espacio sin plazo.
3. **Papelera con retención y purga posterior.** Pros: reversible por un tiempo y limpia después. Contras: suma a la opción 2 un trabajo programado de purga, una pantalla de papelera y la restauración coherente de membresías, enlaces y vínculos; es una funcionalidad entera.

## Decisión

Opción 1, **eliminación definitiva, en dos fases y con bitácora**. La preferencia era reversible, pero con la estructura actual exigiría que cada módulo filtre una marca en todas sus rutas (opción 2) o una papelera completa (opción 3); el riesgo de dejar una app accesible por una ruta olvidada es mayor que el beneficio en esta etapa. La interfaz lo dice claramente («no se puede deshacer») y la app pide escribir su nombre.

**Fase 1 — dejar de ser accesible, de una vez (una transacción de Apps).**

- Se escribe la bitácora `apps.deletions` (id del cliente, tipo, app, feature, nombre, quién, cuándo, estado `pending`).
- Feature: `features.deleting_at`. App: `apps.deleting_at`, `deleting_at` en todas sus features y módulos, y se borran sus **membresías**.
- Efecto inmediato: un filtro global de EF oculta las features marcadas, así que sus resolvedores (`featureId`, `moduleId`) dan 404, la galería, el mapa y los portales ya no las listan, y la vista pública de un enlace (que pasa por `IFeatureDirectory.DescribeAsync`) deja de servirse. Sin membresías, ninguna ruta de la app pasa `RequireAppRole`: la app desaparece para todos a la vez.

**Fase 2 — limpiar cada módulo, en orden, idempotente.** Apps define el contrato `IDeletionParticipant` (consultar impacto y bloqueos, borrar lo de una feature, borrar lo de una app) y cada módulo lo implementa sobre sus propias tablas; Apps nunca escribe en tablas ajenas.

1. **Sharing:** borra los enlaces.
2. **Discovery:** de una feature, **conserva** los vínculos (ver abajo); de una app, purga su historial entero (fuentes, análisis, entidades, relaciones, evidencia, vínculos, bitácoras de aplicación y de importación) con una operación de mantenimiento explícita (`DiscoveryPurge`) que registra lo borrado. La inmutabilidad de los análisis protege el uso normal; la purga es la única excepción y solo la llama la eliminación.
3. **Canvas:** de una feature, borra las imágenes que **solo** usaba su lienzo (por `IAssetWriter`; las que usa otro lienzo de la app se conservan), su lienzo y su posición en el mapa; de una app, todos sus lienzos y el mapa. Nunca toca el lienzo de otra feature.
4. **Files:** de una app, todas sus imágenes (filas y bytes en S3).
5. **Apps:** la feature, o el catálogo, las features, los módulos y la app.

Cada paso se anota en la bitácora (`steps`). Si uno falla, la bitácora queda `pending` con el paso y el error, la respuesta es **202** con el estado, y un servicio en segundo plano (`DeletionRecovery`) la retoma desde el principio (cada paso es idempotente). Que no corran dos ejecuciones a la vez lo garantiza el candado de la app (ver «Exclusión mutua»), no la idempotencia; `retry_at` solo es la espera entre reintentos. La app o la feature ya es inaccesible desde la fase 1. La bitácora conserva el nombre y el resultado: es el registro auditable de qué se borró, cuándo y quién.

**Bloqueos (409, sin borrar nada):**

- Una feature con **portales** que la apuntan desde otra feature: la persona los resuelve antes (no hay `force`; borrarlos dejaría portales rotos o reescribiría otros lienzos).
- Un **módulo**: se borra con su propia acción (`DELETE /api/modules/{id}`, ADR-0010).
- Una aplicación o una importación de Walkie Live **en curso** (su candado tomado) sobre esa feature o esa app.
- La feature **cambió** desde que se vio el resumen (`canvasVersion`), o el nombre escrito no es el de la app.

El impacto y los bloqueos se calculan **con el candado exclusivo de la app tomado** (ver abajo): nadie guarda un lienzo ni crea un portal entre la revisión y la marca, así que no hay que revertir nada.

**Exclusión mutua y escrituras en curso (revisión final del PR #181).** Un candado por app en PostgreSQL (`pg_advisory_lock(int, int)`, clase `AppLocks`), sostenido por una conexión propia mientras dura:

- **Compartido** en toda solicitud que escribe en una app (cualquier método distinto de GET/HEAD/OPTIONS con `RequireAppRole`): lo toma el mismo filtro de autorización, resuelve otra vez el recurso con el candado tomado (lo marcado mientras esperaba ya no existe: 404) y lo suelta al terminar el handler. Cubre lienzo, mapa, features, módulos, catálogo, imágenes (S3 incluido), importar `.walkie`, análisis y decisiones de Walkie Live, enlaces y miembros sin tocar ningún módulo.
- **Exclusivo** en una eliminación, desde antes de revisar el impacto hasta el final de la fase 2: espera a que terminen las escrituras en curso (que la limpieza se lleva después) y ninguna nueva empieza mientras lo tiene. Las eliminaciones (`DELETE` de feature y app) no toman el compartido (`WithoutAppWriteGate`).
- La **recuperación** (en cualquier instancia), la consulta del estado y un reintento lo piden sin esperar (`pg_try_advisory_lock`): si otra ejecución lo tiene, solo informan el estado. Si el proceso o su conexión mueren, PostgreSQL lo suelta y la recuperación la retoma enseguida.
- **Ficha (fencing):** cada ejecución que toma el candado escribe una `owner_token` nueva. Antes de cada paso comprueba que su conexión sigue teniendo el candado y que la ficha es la suya; el cierre de la bitácora y el borrado de las filas de Apps van en una transacción que exige la ficha. Un ejecutor que perdió el candado (corte de red) no escribe nada más.
- Esperar el candado tiene un límite (30 s, `lock_timeout`): una escritura o una eliminación que no lo consigue responde 409 «ocupada» sin hacer nada.

**Discovery y procedencia.** Borrar una feature creada por Walkie Live no reescribe ningún análisis ni bitácora `completed`, ni crea nada: su vínculo `created` se conserva tal cual. La revisión siguiente ya lo muestra con `targetMissing` («el elemento se borró») y la persona decide de nuevo (restablecer y crear otra, o descartar). Nada se recrea solo.

**Autorización.** `DELETE /api/apps/{appId}`, `DELETE /api/features/{featureId}` y sus consultas de impacto exigen `owner` con `RequireAppRole` (404 a quien no es miembro, 403 a un rol menor). La app de una feature la resuelve el servidor. `GET /api/deletions/{id}` responde solo a quien pidió esa eliminación (la app ya puede no existir).

**Reintentos.** El cliente genera el id de la eliminación (UUID v7) y lo reutiliza. El mismo id solo es un reintento si es la **misma solicitud**: mismo tipo (feature o app), misma app (la resuelve el servidor), misma feature, misma persona y los mismos datos (la `canvasVersion` que vio, guardada en la bitácora, o el nombre que escribió). Entonces devuelve su estado y retoma una pendiente; si no, 409: un id nunca sirve para dos recursos. Si la respuesta se perdió y la app ya no es accesible, el cliente consulta `GET /api/deletions/{id}`; la interfaz ofrece «Consultar estado» en el aviso de una eliminación pendiente (202).

## Consecuencias

- Borrar es definitivo: no hay papelera. Exportar la app (`.walkie`) antes es la forma de conservar una copia de features, módulos, catálogo, lienzos e imágenes; **no** guarda el historial de Walkie Live (análisis, evidencia, decisiones), los miembros ni los enlaces. La confirmación lo dice.
- Mientras se elimina una feature, las demás escrituras de su app esperan (normalmente milisegundos; lo que tarde S3 en borrar sus imágenes). Cada escritura usa una conexión más del pool mientras dura.
- Toda consulta nueva sobre `Features` hereda el filtro de las marcadas; el código de eliminación usa `IgnoreQueryFilters`.
- Un módulo nuevo que guarde datos de una app tiene que implementar `IDeletionParticipant`; si no, la prueba de huérfanos de la app lo detecta.
- Una eliminación incompleta queda visible en la bitácora (paso y error) y se reintenta sola; no hay estados en los que la app esté oculta pero sus enlaces o análisis sigan accesibles, porque la fase 1 los corta antes.
- Si más adelante se quiere recuperación, una papelera puede construirse sobre la fase 1 (la marca ya oculta todo) posponiendo la fase 2: este ADR se revisaría entonces.
