# ADR-0012: Módulo Discovery con la procedencia fuera del grafo

- Estado: aceptado
- Fecha: 2026-11-14 (revisado el mismo día: capa complementaria, compatibilidad, consistencia y bloqueo de seguridad)

## Contexto

La spec `walkie-live` carga en una app lo que un analizador local descubre en el código (entidades, relaciones y evidencia), lo revisa y aplica solo lo aprobado al catálogo, los módulos y las features. Hechos del repositorio:

- El lienzo es la fuente de verdad visual: un documento `jsonb` por feature con `version` (409, `CanvasDocument`), editado solo por acciones del store; `layout` va aparte del contenido.
- En `walkie-graph.schema.json`, `node` no tiene `additionalProperties: false` (`edge` y la raíz sí): hoy un nodo acepta campos extra.
- La API es un monolito modular. Cada módulo tiene su `DbContext` y su schema, pero **todos usan la misma base** (una sola cadena `ConnectionStrings:Walkie` en `Program.cs`). La importación del `.walkie` escribe por `IAppWriter` e `ICanvasWriter` y compensa si algo falla (ADR-0009), sin transacción compartida.
- `IAppWriter` ya crea features y módulos (id del cliente en `CreateModuleAsync`) y borra apps, features y elementos del catálogo (`DeleteCatalogItemsAsync`). `CreateCatalogItemAsync` genera el id en el servidor.
- No hay autorización por app: `AppsHandlers.ListAppsAsync` lista todas y cualquier usuario autenticado lee y escribe cualquier app. El roadmap deja «roles por app» para después del MVP.

## Opciones consideradas

### Dónde vive el descubrimiento

1. **Procedencia dentro del grafo** (ej. `node.source = { key, snapshotId }`): se ve donde está el nodo. Contras:
   - mezcla contenido y descubrimiento;
   - depende de una laxitud del schema;
   - reanalizar obligaría a reescribir lienzos (409 con editores abiertos);
   - no sirve para el catálogo, que no son nodos.
2. **Ampliar Export/Import** con el nuevo formato: reutiliza el código del `.walkie`. Contras: Export no tiene tablas y esto guarda análisis y decisiones; mezcla reconstruir lienzos con revisar candidatos.
3. **Módulo nuevo `Walkie.Modules.Discovery`** con schema `discovery` propio. Contras: un módulo y unas tablas más; un vínculo puede quedar apuntando a algo borrado a mano.
4. **Base de grafos o servicio aparte**: consultas de grafo nativas. Contras: infraestructura nueva sin una consulta que la pida.

### Cómo aplicar sin dejar cambios a medias entre Apps, Canvas y Discovery

- **A. Transacción compartida.** Como todos los módulos están en la misma base, los `DbContext` podrían compartir conexión y `DbTransaction`. Es atómico. Contras:
  - cambia cómo se registra cada `DbContext`;
  - acopla los módulos a una unidad de trabajo común;
  - contradice la dirección de ADR-0009;
  - deja de valer si un módulo pasa a otra base.
- **B. Compensación sola** (ADR-0009). Contras: si el proceso muere a mitad de camino quedan elementos sin vínculo y nada los recupera.
- **C. Bitácora de aplicación con ids del cliente, escritura idempotente y compensación.** Cada id se fija antes de escribir y la bitácora (`discovery.applies`) guarda el plan y su estado. Contras: una tabla más y un camino de recuperación que probar.

## Decisión

**Opción 3, con el método C.**

**Capa complementaria.** Discovery no reemplaza nada del modelo actual: Apps, Features, Canvas, Catálogo, Módulos, Interfaces, Portales y Tours siguen como están y siguen siendo la fuente de verdad. Discovery solo guarda lo que el análisis encontró y lo que la persona decidió:

- `sources`: fuentes;
- `snapshots`: análisis;
- `entities`, `relations` y `evidence`;
- `bindings`: vínculos, clave de entidad → elemento del catálogo, módulo o feature, con decisión `linked`, `created` o `rejected`;
- `applies`: la bitácora.

Las propuestas no se guardan: la revisión se calcula a partir del análisis, los vínculos y el catálogo y los módulos actuales. Discovery depende de Apps y Canvas por sus `Contracts/`, y nadie depende de él, así que no hay ciclos. Borrar Discovery no rompe nada.

**Compatibilidad (invariantes que no se negocian):**

- `walkie-graph` no cambia: la procedencia vive en `bindings`, nunca en un nodo.
- Aplicar **no escribe en lienzos existentes**:
  - no cambia posiciones, tamaños, presentación, conexiones, referencias, módulos, interfaces ni tours;
  - la `version` y el contenido de cada lienzo quedan iguales.
- **Vincular** un hallazgo a un elemento del catálogo o a un módulo existente no cambia ese elemento: ni título, ni descripción, ni contrato.
- Aplicar **nunca borra**. Lo que ya no aparece en un reanálisis solo se marca en la revisión.
- Lo que aplicar sí crea —elementos del catálogo, módulos con su lienzo y features con su lienzo inicial— se crea por los mismos caminos y validaciones que el editor (`ICanvasWriter.Validate`/`CreateAsync`), así que el editor actual lo abre sin código nuevo.

**Consistencia: aplicar en cuatro fases.**

1. **Validar y planificar** sin escribir. Con `dryRun` se responde aquí, y esa es la vista previa.
2. **Registrar el plan** en `discovery.applies`, con `applyId` del cliente, todos los ids ya generados (UUID v7) y estado `pending`.
3. **Escribir en orden:** catálogo (con `IAppWriter`, que suma crear con id dado), módulos y features con sus lienzos y, al final, los vínculos.
4. **Marcar** la bitácora como `completed`.

Cada escritura es idempotente por id: si el elemento ya existe con ese id, se da por hecha. Así:

- **Reintento** (doble clic, error de red): el mismo `applyId` devuelve el resultado guardado o retoma lo pendiente, sin duplicar.
- **Error a mitad de camino:** se compensa en orden inverso (`DeleteCatalogItemsAsync`, `DeleteFeaturesAsync`, `ICanvasWriter.DeleteAsync`) y la bitácora queda `compensated`.
- **Caída del proceso:** la bitácora queda `pending` con los ids planificados. El siguiente intento con ese `applyId`, o la siguiente revisión de esa fuente, la completa o la compensa. Nada queda huérfano en silencio.

La transacción compartida (A) queda como forma de revertir la decisión, detrás de las mismas interfaces.

**Cómo quedó en la tarea 6 (crear en el catálogo).** Precisiones al diseño de arriba, sin cambiar la opción C:

- **Una ejecución a la vez por `applyId`:** un candado de sesión de Postgres (`pg_try_advisory_lock`) sobre el `applyId`. Un doble clic o un reintento mientras la primera sigue recibe 409 («se está ejecutando»). Si el proceso muere, Postgres suelta el candado con la conexión, así el reintento retoma lo `pending` sin esperar un plazo.
- **Reserva de los hallazgos:** al registrar `pending`, cada hallazgo de la solicitud queda reservado (`bindings.pending_apply_id`) y su versión sube en la misma transacción. Dos aplicaciones distintas sobre el mismo hallazgo chocan ahí, antes de escribir en Apps: una gana y la otra recibe 409. Un id planificado es de una sola aplicación (índice único en `discovery.apply_steps`).
- **Pasos:** cada creación es un paso (`planned` → `created`, guardado después de cada escritura), así un reintento sabe qué falta y una compensación sabe qué creó esta aplicación y nada más.
- **Compensar sin perder datos:** se borra lo creado solo si sigue en su versión 1 y ningún lienzo lo usa (`IAppWriter.DeleteUntouchedCatalogItemAsync`). Lo que alguien ya editó o usó se deja (paso `kept`, aviso `compensation-kept`): queda en el catálogo sin vínculo, documentado en la bitácora y en la respuesta, y se puede vincular desde la revisión. La respuesta no dice que se revirtió lo que no se revirtió.
- **Cuándo se retoma una caída:** con el mismo `applyId` (el cliente reintenta) o cuando otra aplicación toca un hallazgo reservado por ella: esa la termina y responde 409 para que la persona vuelva a mirar. **Diferencia con el texto de arriba:** decía «o la siguiente revisión de esa fuente»; la revisión (`GET`) se dejó de solo lectura —una lectura que escribe en otro módulo sorprendería y rompería su transacción de lectura repetible—. Mientras tanto, los hallazgos reservados no se pueden decidir (409) hasta que se retome. Si se prefiere que la revisión también la retome, se suma sin cambiar la bitácora.
- **Lo que no usa el token de la solicitud:** la ejecución y la compensación no se cancelan si el cliente se va; terminan o compensan en vez de quedar a medias.

**Cómo quedó en la tarea 9 (crear módulos y features con su lienzo).** Misma opción C, con estas precisiones:

- **Qué se crea:** solo lo que una persona elige con `create` sobre un candidato a módulo o a feature. Un proyecto con endpoints no es por sí solo un módulo reutilizable, ni un grupo de rutas un objetivo funcional: la vista previa lo dice (`inferred`) y la persona puede renombrarlo (`name`).
- **El lienzo inicial (`CanvasDraft`, función pura):** solo lo observado y ya decidido.
  - **Feature:** sus pantallas, todas de la misma app técnica (`app`; el ámbito de la app técnica no es la App de Walkie); una pantalla descartada o ya creada en otra feature no entra. La navegación observada entre ellas va como `navigation`. Cada llamada observada va como `request` (`http.request`) hacia el elemento del catálogo de esa API o, si un solo módulo de la app la ofrece como interfaz `provides`, hacia esa interfaz (`toInterface`).
  - **Módulo:** un `ref` por cada API suya que ya está en el catálogo y, por cada una, la interfaz `provides` que justificó el análisis (un endpoint declarado en el código del módulo). `requires` y `event` no se generan: el analizador no tiene evidencia de ellos.
  - **Qué no entra:** una API entra solo si ya tiene una decisión (vinculada o creada, y el elemento sigue existiendo) o si la misma solicitud la crea; una coincidencia sugerida nunca se vuelve un `ref`. Una API que publican varios servicios (`ambiguous-api`) no se conecta desde una pantalla: no se elige un backend; la vista previa lo avisa y la persona puede agregar la conexión a mano. Sin respuestas, códigos ni pasos internos.
  - Todo lo que queda fuera va en `omitted`, con un código y el porqué.
- **Ids y posiciones del cliente:** como todo id de nodo, conexión e interfaz, son UUID v7 de la web. La vista previa devuelve el borrador por claves; la web les da ids y ubica las cajas con el mismo `autoLayout` del mapa de la app (pantallas en columnas siguiendo la navegación hacia rutas más profundas; las APIs y módulos debajo, bajo quien los usa). Al aplicar se mandan en `canvas`, y la API valida que cubran exactamente el borrador, sin ids repetidos ni cajas encimadas, y el grafo con `ICanvasWriter.Validate`. No hay otro motor de distribución ni otro editor.
- **Pasos de la bitácora:** catálogo → módulos → features (el lienzo de cada uno puede apuntar a lo anterior). Un módulo o una feature tiene dos marcas: la fila (`IAppWriter.CreateFeatureAsync` con id del cliente, idempotente → `created`) y su primer lienzo con sus interfaces, que se guardan juntos en el mismo guardado del lienzo (`ICanvasWriter.CreateInitialAsync` → `saved`). No hay un estado «lienzo sin interfaces». Después, en una transacción de Discovery, los vínculos (la feature o el módulo, y cada pantalla como `created` en su feature) y `completed`.
- **Caídas entre pasos:** el mismo `applyId` retoma desde la última marca. Una fila ya creada no se duplica, y un lienzo que ya existe nunca se pisa, aunque una persona lo haya editado entre la caída y el reintento: se toma como hecho.
- **Compensar sin perder lo de una persona:** en orden inverso (features, módulos, catálogo). El lienzo se borra solo si sigue en versión 1 y ningún otro lienzo apunta a esa feature o módulo (`ICanvasWriter.DeleteUntouchedAsync`); la fila, solo si conserva el nombre y la descripción con que se creó (`IAppWriter.DeleteUntouchedFeatureAsync`). Si no, `kept` y `compensation-kept`. No se supone atomicidad entre Discovery, Apps y Canvas.
- **Reanalizar:** lo creado no se vuelve a crear (tiene una decisión) y su lienzo no se toca; la revisión lo muestra `created` o `changed`.

**Seguridad: bloqueo explícito.** La falta de autorización por app es deuda técnica anterior a Walkie Live. Con Discovery, cualquier usuario autenticado vería rutas de archivos, nombres internos y estructura de proyectos privados. Por eso:

- **No se habilita la importación de proyectos privados para usuarios reales** (piloto ni producción) hasta que exista autorización por app.
- Mientras tanto, los endpoints de Discovery quedan detrás de la opción `Discovery:Enabled`, apagada por defecto fuera de Development.
- La evidencia va sin fragmentos de código por defecto (ADR-0013).
- Encender `Discovery:Enabled` en un entorno con usuarios reales exige un ADR que registre la autorización por app.

**Crear una app desde un proyecto local** (agregado en la tarea 10): `POST /api/sources/import` escribe en Apps (la app) y en Discovery (el análisis), sin transacción compartida. Usa la misma idea que la bitácora de aplicación:
- **Identidad de la operación:** `importId` (UUID v7 del cliente, uno por archivo y nombre; la web lo reutiliza en cada reintento). La fila `discovery.source_imports` guarda el hash de la solicitud (`sha256(paquete) + nombre`) y el id de la app, generado **antes** de crearla. Un `importId` con otro hash da 409.
- **Orden:** validar todo → candado por `importId` → fila `pending` (un solo `pending` por fuente: índice único parcial) → `IAppWriter.CreateAppAsync` con el id dado → guardar el análisis y marcar `completed` en el mismo `SaveChanges`. Solo entonces se responde 201.
- **Reintento y caída:** el mismo `importId` retoma desde donde quedó y responde la misma app (`existing`). Si el proceso murió, la siguiente importación de esa fuente intenta recuperar la pendiente (si su candado está libre) antes de crear otra.
- **Compensación:** si falla antes del análisis, borra la app solo si sigue con el mismo nombre y sin features, catálogo ni datos de Discovery (`DeleteUntouchedAppAsync`); si alguien la tocó, queda `pending` con el error y la respuesta lo dice.
- **Pendiente que nadie reintenta (tarea 11):** si la app ya tenía cambios y la ejecución murió, la siguiente creación desde la misma fuente la deja `abandoned`: no borra nada, la app queda sin el análisis y la fuente se desbloquea. El `importId` original recibe 409 con qué hacer. Tampoco borra nada `SaveAsync`, que desde la tarea 11 guarda los análisis de una misma fuente de a uno (candado de transacción).
- **Atribución (tareas 6, 9 y 10):** un «ya existe» con el mismo id solo cuenta como propio si es del mismo tipo, del mismo usuario y creado después de la fila de la bitácora; si no, el paso falla y se compensa. Así un reintento no se adueña de algo creado por otra persona.
- **Orden de la compensación de una feature o módulo:** primero se comprueba que su lienzo sigue sin tocar, después se borra la fila (nombre y descripción en la condición del `DELETE`) y al final el lienzo (versión 1 y sin referencias). Queda una carrera: si alguien agrega una referencia al módulo entre la comprobación y el borrado, esa referencia queda pendiente, un estado que el editor ya muestra (ADR-0010).

## Consecuencias

- Positivas:
  - el editor, el store, el contrato del grafo y los lienzos actuales no cambian;
  - un análisis inválido no toca nada;
  - los descartes se recuerdan entre análisis;
  - una caída a mitad de aplicar es recuperable, a diferencia de la importación del `.walkie`;
  - la evidencia se consulta sin abrir lienzos.
- Negativas / costos:
  - `IAppWriter` suma `CreateCatalogItemAsync` con id dado;
  - la lectura segura del zip sale de `ImportHandlers` a `Walkie.Shared`;
  - hay una tabla de bitácora y un camino de recuperación que probar;
  - un vínculo a un elemento borrado a mano se muestra como pendiente;
  - Discovery no sirve a usuarios reales hasta que exista autorización por app.
- Qué habría que hacer para revertirla: borrar el módulo y su schema. Lo creado (catálogo, módulos, features) queda como contenido normal, porque no depende de Discovery.
