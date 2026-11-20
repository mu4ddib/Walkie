# Spec: Walkie Live — inferencia arquitectónica, relaciones y exploración

- Issue padre: #177
- Estado: aprobada (2026-11-20)
- Depende de: spec `walkie-live` (tareas 1 a 11, en `main`) y spec `autorizacion-por-app` (D1, PR #176, sin fusionar)

## Objetivo

Que Walkie Live pase de un inventario de hallazgos a explicar la arquitectura de un proyecto: qué apps técnicas lo componen, qué llama a qué con evidencia, qué no se pudo resolver y qué grupos podrían ser features, para explorarlo sin decidir nada y luego incorporar un grupo coherente de una vez.

## Usuarios

- Quien acaba de importar un `.walkiepack` y quiere entender el sistema antes de revisar 80 hallazgos uno por uno.
- Quien documenta una app existente y quiere convertir un grupo de pantallas, APIs y módulo en una feature con su lienzo, sin conectar nada a mano.
- Quien hace onboarding y quiere ver qué se demostró y qué es hipótesis.

## Diagnóstico (Walkie analizándose, `main` en `d8159c5`)

Hoy el análisis da 80 hallazgos y 81 relaciones: 50 `exposes`, 22 `depends-on` y 9 `navigates`, con **0 `calls`**. Las 3 features propuestas («Apps», «Catalog», «Modules») tienen 2 pantallas cada una y ninguna conexión. Medido sobre `apps/web/src` y `apps/api/src`:

| # | Causa | Evidencia | Efecto |
|---|---|---|---|
| C1 | **Envoltorios HTTP no seguidos (D2).** `frontend-http` solo ve `fetch`, `axios` y `HttpClient` con URL legible en ese mismo punto. Walkie llama `getApp()` → `request(path, init)` → `send(path, init)` → `fetch(\`${baseUrl}${path}\`)`. | 43 llamadas a `request(` y 6 a `send(` en `api/client.ts`, todas con ruta literal o plantilla | Una sola limitación `dynamic-http-url (baseUrl)` y 0 `calls` |
| C2 | **Atribución solo léxica.** `FrontendModel.ScreensAt` atribuye una llamada a una pantalla solo si está escrita en el archivo de su componente. En Walkie las pantallas llegan a la API por *hooks* (`api/hooks.ts`) y componentes hijos. | Ningún archivo de pantalla llama a `fetch` | Aun con C1 resuelto, todo quedaría «desde la app», sin pantalla |
| C3 | **Navegación por funciones de rutas (D3).** `Url()` resuelve literales y constantes del mismo archivo; no evalúa `appPath(id)`, `featurePath(a, f)` ni `catalogPath(a, i?)`. | 38 de 61 navegaciones usan una función `*Path()`; 8 una constante importada | Se resuelven 9 |
| C4 | **Navegación desde componentes hijos.** `AddNavigation` descarta un enlace si su archivo no es el de una pantalla. | 34 de 61 navegaciones están en componentes (`FeatureCard`, `SourcesSection`, `LocationBar`…) | Se pierden en silencio |
| C5 | **Lo no resuelto no se declara.** Una navegación a una variable (`navigate(path)`), a un destino sin pantalla o desde código sin pantalla se ignora sin limitación. | 4 navegaciones a variables; ninguna limitación de navegación | Cobertura sobreestimada; contradice «declarar lo que no se vio» |
| C6 | **Features por último segmento.** `frontend-features` agrupa pantallas cuyo último segmento estático coincide. | «Modules» junta `/apps/:appId/modules/:moduleId` con `/s/:token/modules/:moduleId` (la vista pública de un enlace) | Grupos que no son una capacidad, sin navegación ni APIs |
| C7 | **Backend sin uso efectivo.** Los módulos tienen `exposes` y `depends-on` declarados (referencia de proyecto, un `DbContext` en el proyecto), pero no se sigue endpoint → handler → `DbContext`/`DbSet`. | `MapGet("/{appId}", GetApp)` → `GetApp(…, AppsHandlers handlers)` → `handlers.GetAppAsync` → `db.Apps.AsNoTracking()` es sintácticamente legible | No hay `reads`/`writes`; una feature no puede llegar de la API a la base |
| C8 | **Revisión de a uno (D8).** La revisión lista hallazgos; no hay una vista de conjunto ni una forma de decidir por grupo. La vista previa no avisa de llamadas sin resolver. | — | Hay que entender la arquitectura hallazgo por hallazgo |
| C9 | **Ruido.** 3 de las 4 `dynamic-http-url` son `fetch` de imágenes y fuentes (`canvasImage.ts`), no llamadas a la API. | — | El análisis queda `partial` por algo que no es la API |

`CanvasDraft` ya dibuja `navigates` como `navigation` y `calls` como `http.request` hacia el catálogo o la interfaz de un módulo: los lienzos vacíos salen de la detección, no del dibujo.

## Modelo de inferencia

Tres etapas, separadas en el código y en lo que se muestra:

1. **Descubrimiento** (CLI, como hoy): entidades con evidencia.
2. **Relación** (CLI): `calls`, `navigates`, `reads`, `writes`, `exposes`, `depends-on`, `contains`. Cada una con evidencia (archivo, línea, ancla y regla), `basis` y confianza.
3. **Interpretación** (CLI para las propuestas de feature, que necesitan clave estable; API para la proyección de arquitectura, calculada al pedirla): agrupaciones técnicas y funcionales, siempre `inferred`.

**Criterios de confianza (reproducibles):**

| Nivel | Cuándo |
|---|---|
| `observed` · `high` | El hecho está escrito en un solo lugar con todo literal (`MapGet("/x")` con prefijo resuelto; una página de Next.js) |
| `observed` · `medium` | Escrito en un solo lugar, con una parte que no se ve (prefijo que llega por parámetro; URL relativa) |
| `inferred` · `medium` | Cadena estática de hasta 3 saltos, cada uno una llamada por nombre a una función resuelta por importación, con un solo destino posible (pantalla → hook → función del cliente → API; endpoint → handler → `DbSet`) |
| `inferred` · `low` | La cadena pasa por un componente que la pantalla dibuja, o el grupo se sostiene solo en la forma de las rutas |
| no se crea | Más de 3 saltos, recursión, destino calculado, varios destinos posibles o un componente compartido por más de 3 pantallas (sus llamadas quedan en la app, no en cada pantalla) |

Una relación con varias evidencias muestra la cadena completa (cada salto con su archivo y línea). Lo inferido nunca es `high` (regla del contrato).

**Reglas de agrupación funcional (propuesta de feature):**

1. Solo pantallas de **una misma app técnica** (ámbito de ADR-0014).
2. **Familia de rutas:** la ruta sin parámetros (`/apps/:appId/catalog/:itemId` → `apps/catalog`). Pantallas de familias distintas no se juntan solo por compartir un segmento; `/s/:token/modules/:id` (familia `s/modules`) no se junta con `/apps/:appId/modules/:id`.
3. Una familia con **2 o más pantallas** es candidata. También 2 familias unidas por navegación en los dos sentidos y con APIs en común.
4. **Puntaje explicado:** navegación observada entre sus pantallas (fuerte), carga diferida común (fuerte), APIs en común (media), APIs de un mismo módulo backend (media), solo la forma de la ruta (débil). Confianza `medium` con al menos una fuerte y una media; si no, `low`.
5. La propuesta dice por qué existe, qué interacciones se detectaron y cuáles no se resolvieron.
6. Una pantalla está en una sola propuesta.

## Criterios de aceptación

**Relaciones (CLI)**

- [ ] Dado un envoltorio de fetch, axios o `HttpClient` cuya URL sale de un parámetro, cuando otro código lo llama con una ruta literal, constante, plantilla o función de rutas, entonces hay una `calls` hacia la API con el método del argumento u opción `method`. Esto vale también desde otro archivo por importación, con alias, a hasta 3 niveles de envoltorio y en servicios de Angular. Una ruta que no se puede leer deja una limitación con el archivo de la llamada, no la del `fetch`.
- [ ] Dada una pantalla que llama a la API por un *hook* o servicio importado, entonces la `calls` sale de la pantalla (`inferred`, con la cadena como evidencia). Si nada la une a una pantalla, la `calls` sale de la app técnica. Nunca se conecta una pantalla por compartir carpeta o dominio.
- [ ] Dado `navigate(appPath(id))` o `<Link to={featurePath(a, f)}>`, con la función de rutas en otro archivo, entonces hay una `navigates` a la pantalla con ruta normalizada. Un `?:` con las dos ramas resolubles da las dos. Una navegación desde un componente que dibuja una sola pantalla es de esa pantalla.
- [ ] Dada una navegación que no se resuelve, entonces queda una limitación `dynamic-navigation` (o `navigation-target-unknown`) con archivo, línea y qué parte faltó, y el análisis queda `partial`.
- [ ] Dado `MapGet("/x", Handler)` con `Handler(…, XHandlers h)` que llama `h.Metodo`, y `XHandlers(XDbContext db)` que en ese método usa `db.Tabla` con `Add`/`Remove`/`SaveChanges` o con una consulta, entonces hay `writes` o `reads` de la API a la base lógica de ese `DbContext` (`inferred` · `medium`, con la cadena). Que el servicio esté registrado en DI no basta.
- [ ] Un `fetch` de una URL que el propio código arma con `URL.createObjectURL`, un `data:`, o un `href` de una hoja de estilos queda como `non-api-fetch` y no deja el análisis `partial`.
- [ ] Las propuestas de feature siguen las reglas de agrupación de arriba. En Walkie, ninguna junta la vista pública `/s/…` con la autenticada.

**Explorar arquitectura (API y web)**

- [ ] Dado un análisis importado, cuando abro «Explorar arquitectura» desde la revisión, entonces veo, sin haber decidido nada:
  - las apps técnicas (front, servicios, módulos), bases y recursos agrupados, con sus relaciones agregadas y cuántas son observadas e inferidas;
  - qué hay dentro de un grupo, al abrirlo;
  - filtros por tipo, confianza y cobertura;
  - las limitaciones del grupo como «sin resolver»;
  - las propuestas de feature, con su motivo y confianza.
- [ ] La vista distingue contención (`exposes`, `contains`), ejecución (`calls`, `reads`, `writes`), navegación y dependencia declarada (`depends-on`). Una contención o una dependencia nunca se dibuja como solicitud.
- [ ] Seleccionar una relación o un elemento muestra su evidencia (con la cadena), bajo demanda.
- [ ] Nada se guarda: ni posiciones ni decisiones.
- [ ] Con 20.000 entidades, la vista general dibuja grupos (nunca miles de cajas), abre un grupo bajo demanda y responde en el presupuesto de rendimiento (abajo).

**Revisión por conjuntos**

- [ ] Dada una propuesta de feature, cuando la reviso, entonces veo sus pantallas, APIs, módulos y relaciones. Cada una dice si es observada o inferida, si ya está en el catálogo (vinculada o coincidencia única por firma) y si falta. Elijo qué incorporar.
- [ ] Al previsualizar, veo todo lo que se va a crear, reutilizar y omitir con su motivo: el elemento del catálogo de cada API que falta, la feature con su lienzo inicial y la navegación y solicitudes dibujadas. Al confirmar, es **una** aplicación (`applyId`, `dryRun`, bitácora y compensación de siempre).
- [ ] No se duplica una API ya confirmada ni se crea una copia. Una pantalla ya incluida en otra feature no se repite. Una coincidencia ambigua no se vincula sola. No se toca ningún lienzo existente. Un reintento usa los mismos ids.
- [ ] Al terminar, «Abrir lienzo» abre la feature con pantallas, navegación y llamadas a las APIs del catálogo (o a la interfaz del módulo que las ofrece).

**Calidad medida (Walkie y fixtures)**

- [ ] Las métricas se miden por separado (`validacion.md` nueva sección): endpoints llamados detectados, consumidores atribuidos (pantalla, servicio o app), navegaciones resueltas, no resueltas declaradas, falsos positivos, relaciones entre apps incorrectas (0), propuestas con evidencia suficiente o solo heurística, y conexiones dibujadas en los lienzos.
- [ ] Casos: A (Walkie), B (React + .NET con login, listado, detalle, crear, editar, servicios, EF Core), C (Angular standalone y lazy, servicios, `HttpClient`), D (monorepo con nombres iguales), E (incompleto: navegación y cliente no resolubles) y F (revisión agrupada E2E). Hay pruebas para todos.

## Fuera de alcance

- Cambiar el `.walkiepack` (`formatVersion`) o el schema del lienzo. Todo cabe en el contrato v1 (ver «Impacto»); si apareciera una relación que no se puede expresar sin ambigüedad, se para y se decide con un ADR.
- IA generativa como fuente de hallazgos, ejecutar el proyecto o enviar código afuera.
- Seguir cadenas de más de 3 saltos, callbacks, inyección dinámica, reflexión o rutas armadas en tiempo de ejecución.
- Un segundo editor: la exploración es de solo lectura y no guarda posiciones.
- «Aceptar todo».
- Vue, Svelte y otros enrutadores.
- Unir bases EF lógicas con la física del compose (sigue como decisión humana).

## Impacto en el modelo

- **`packages/schema`: ninguno.** Se usan los tipos de relación que el contrato ya tiene. Detalles:
  - `reads`/`writes` desde una `api` hacia una `database`: el validador no restringe extremos, solo exige que el detector declare el tipo. La descripción del `relationKind` dice «un servicio usa una base»; se amplía en texto, sin cambiar la forma.
  - El detector `efcore` (o uno nuevo `aspnetcore-data`) declara `reads` y `writes` en sus capacidades. Eso cambia el manifest del paquete, no el formato.
- **Limitaciones nuevas** (códigos libres en el contrato): `dynamic-navigation`, `navigation-target-unknown`, `http-wrapper-unresolved`, `non-api-fetch` (sin `incomplete`).
- **Respuestas nuevas de la API:** `walkie-discovery-architecture.schema.json` (vista general y detalle de un grupo), en `packages/schema`, con tipos generados para la web.
- Se registra la decisión en **ADR-0016** («Inferencia por etapas y proyección de arquitectura calculada»): etapas, criterios de confianza, límites de profundidad, por qué la proyección es calculada y no se guarda.

## Impacto en la API

- `GET /api/snapshots/{snapshotId}/architecture` (viewer, detrás de `Discovery:Enabled`). Devuelve la vista general:
  - grupos (apps técnicas, módulos, bases, recursos) con conteos;
  - aristas agregadas entre grupos por tipo, con observadas e inferidas;
  - limitaciones por grupo y cobertura;
  - propuestas de feature, cada una con motivo, puntaje, confianza, miembros y no resueltos.
- `GET /api/snapshots/{snapshotId}/architecture/groups/{groupKey}` (viewer): las entidades y relaciones del grupo y sus vecinos inmediatos, acotado y paginado.
- La evidencia sigue por `GET /api/snapshots/{id}/evidence` (ya existe, bajo demanda).
- La revisión agrupada usa `POST /api/snapshots/{id}/apply` con las operaciones de hoy (`create` de catálogo, `link`, `create` de feature con `canvas`) en **una** solicitud. Si hiciera falta otra operación, se documenta antes de cambiar `walkie-discovery-apply`.
- Todos los endpoints nuevos llevan `.RequireAppRole` (ADR-0015).

## Rendimiento (presupuesto)

| Medida | 2.000 entidades | 20.000 entidades |
|---|---|---|
| `GET …/architecture` (servidor, mediana) | < 300 ms | < 2 s |
| Detalle de un grupo | < 200 ms | < 800 ms |
| Cajas dibujadas a la vez en la vista | ≤ 200 | ≤ 200 |
| Primer dibujo de la vista general (web) | < 500 ms | < 1 s |

La proyección se calcula con consultas sin `jsonb` (claves, tipos, app, miembros, relaciones), sin N+1, fuera del render de React y con identidades estables; el diseño se calcula una vez por vista, no al mover.

## Entrega en dos PR

1. **PR A — relaciones** (`feat/walkie-live-relaciones`, desde `main`, solo `apps/cli` y docs): D2, D3, atribución, relaciones backend, propuestas por reglas, ruido de `fetch` y métricas del Caso A al E.
2. **PR B — exploración y revisión por conjuntos** (`feat/walkie-live-explorar`): proyección en la API, vista web y aplicación agrupada, con el Caso F en E2E. Necesita D1 (los endpoints nuevos llevan rol) y el PR A (las relaciones). Se abre apilado si #176 o el PR A no se fusionaron todavía.

## Decisiones (2026-11-20)

- El PR B se abre apilado sobre `feat/autorizacion-por-app` (D1) con el PR A dentro; su diff se limpia al fusionar los dos.
- `reads`/`writes` salen de la `api` hacia la base lógica de su `DbContext` (endpoint → handler → `DbSet`), inferidas con la cadena como evidencia. Solo cambia la descripción del tipo en el schema, no su forma.
- El nombre de una feature propuesta es el título de la pantalla de su familia con la ruta más corta (lo que una persona ya escribió), marcado como candidato.
