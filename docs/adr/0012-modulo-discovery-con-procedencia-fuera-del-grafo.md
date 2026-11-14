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

**Seguridad: bloqueo explícito.** La falta de autorización por app es deuda técnica anterior a Walkie Live. Con Discovery, cualquier usuario autenticado vería rutas de archivos, nombres internos y estructura de proyectos privados. Por eso:

- **No se habilita la importación de proyectos privados para usuarios reales** (piloto ni producción) hasta que exista autorización por app.
- Mientras tanto, los endpoints de Discovery quedan detrás de la opción `Discovery:Enabled`, apagada por defecto fuera de Development.
- La evidencia va sin fragmentos de código por defecto (ADR-0013).
- Encender `Discovery:Enabled` en un entorno con usuarios reales exige un ADR que registre la autorización por app.

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
