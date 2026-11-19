# Walkie Live: validación integral (tarea 11, #173)

Fecha: 2026-11-19. Rama `feat/walkie-live-local-import`, PR #174 (draft). Esta página reúne qué se probó, qué se encontró y en qué estado queda Walkie Live. Las mediciones son de una sola máquina; no son garantías.

**Entorno local de las mediciones:** contenedor Linux x64 en la nube de 4 vCPU (kernel 6.18), .NET 10.0.15, Node 22, Chromium 1243 (Playwright 1.63) y WebKit (Playwright 1.63, instalado para esta tarea). Postgres 17 en Docker en la misma máquina, con la configuración por defecto de la imagen (Testcontainers para las pruebas de la API, `infra/docker-compose.yml` para los E2E). La API, la web y Postgres compiten por las mismas CPU. Los logs de la API van en `Warning` al medir. El CI (GitHub Actions, `ubuntu-latest`) corre las mismas pruebas, pero no la matriz de rendimiento.

## 1. Línea base (antes de cambiar nada)

- CI verde en los cinco jobs (`api`, `cli`, `web`, `schema`, `e2e`) sobre `8a970a5`; el e2e pasó al segundo intento (ver §11).
- Pruebas: 591 de la API, 91 de la CLI, 509 de Vitest y 64 E2E.
- Discovery: 6 migraciones, 8 endpoints (todos con ids `:guid` y detrás de `Discovery:Enabled`; 401 sin token y 404 con el flag apagado, probado en cuatro clases). Apagado por defecto; solo `appsettings.Development.json` lo enciende, y encenderlo fuera de Development deja un aviso en el log.
- PR #174: 232 archivos y unas 39.000 líneas contra `main` (CLI, módulo Discovery, schemas y ejemplos, web, docs).

## 2. Walkie analiza Walkie

`walkie scan .` sobre el repo, con `--source-id` para no escribir `.walkie/source.json` en el repo. El paquete (14 KB) se generó fuera del repo; tres corridas dieron el mismo `discovery.json` byte a byte (solo cambia `generatedAt` del manifest).

| Medida | Valor |
|---|---|
| Archivos en el alcance / leídos | 910 / 400 |
| Tiempo | 1,5 s (3,4 s en frío); en el proceso de pruebas, mediana 196 ms (§6) |
| Memoria | ~155 MB de pico del proceso de la CLI; 66 MB asignados por escaneo |
| Detectores | 11 corrieron, 0 omitidos, 0 fallidos (`nextjs` y `angular-router` sin nada que mirar) |
| Completitud | parcial (limitaciones `dynamic-http-url`) |

**Comparación con el código real:**

| Hallazgo | Detectado | Real | Conclusión |
|---|---|---|---|
| APIs | 46 | 46 llamadas `Map*` en `apps/api/src` | Completo |
| Servicios | 2 (`Walkie.Api`, `@walkie/web`) | 2 | Correcto, pero sin la relación web → API |
| Bases | 5 `DbContext` + `walkie` (compose) | una base física con 5 esquemas | Las lógicas no se unen a la física; declarado (`efcore-logical-database`) |
| Recursos | keycloak, rustfs | igual | Correcto |
| Módulos | 6 con sus APIs, bases y `depends-on` | el árbol de `apps/api/src` | Correcto |
| Pantallas | 11 | 11 rutas sin comodín | Completo |
| Navegación | 9 `navigates` | 56 `Link`/`navigate` (8 con ruta literal, 37 por funciones como `appPath()`) | **Incompleta y sin limitación** |
| Llamadas web → API | 0 `calls` | 43 endpoints distintos llamados desde `api/client.ts` | **Falso negativo** |
| Candidatos a feature | 3 (Apps, Catalog, Modules), confianza baja | — | Solo agrupan pantallas |
| Relaciones | 77 (46 `exposes`, 22 `depends-on`, 9 `navigates`) | — | — |

**Por qué faltan las llamadas.** Toda la web llama por `request()`/`send()` (`apps/web/src/api/client.ts`), que terminan en un único `fetch(\`${baseUrl}${path}\`)`. El detector `frontend-http` mira el `fetch` y no sigue funciones envoltorio. Por eso deja una sola limitación («una llamada GET usa una URL que no se puede resolver sin ejecutar (baseUrl)») y oculta 43 rutas que **sí** se leen sin ejecutar: cada función de `client.ts` pasa su ruta como literal (`'/api/apps'`, `` `/api/apps/${…}/features` ``). Las otras 3 limitaciones `dynamic-http-url` son ruido: imágenes y fuentes de `canvasImage.ts`, no la API.

**Por qué falta navegación.** Solo se resuelven rutas literales; las de funciones (`appPath(id)`, `featurePath(…)`) no, y no queda ninguna limitación que lo diga. Esto contradice la regla de declarar lo que no se pudo ver.

**Impacto en los lienzos iniciales.** Las features propuestas salen solo con sus pantallas (el E2E lo muestra: «Llama a ninguna · 0 de navegación y 0 solicitudes HTTP») y nunca con las APIs ni los módulos que usan. Los módulos salen bien (APIs, interfaces, base). No se inventa ninguna conexión: el resultado es incompleto, no falso. Prioridad en §8.

## 3. Recorrido E2E obligatorio

`apps/web/e2e/walkie-live-walkie.spec.ts`, con la CLI, la API, la web, Keycloak y Postgres reales:

1. La CLI corre sobre una copia de `apps/api/src`, `apps/web/src` y el compose de Walkie.
2. «Crear app desde proyecto local»: vista previa (46 APIs, análisis parcial), nombre y crear.
3. La revisión muestra la limitación de `request()`.
4. Matching: una API documentada a mano (`GET /api/health`) aparece como «Coincide» por «Misma firma» y se vincula.
5. Se crea `GET /api/apps` en el catálogo.
6. Se crea el módulo `Walkie.Modules.Files`, con sus APIs sumadas en la misma solicitud (ver §10, defecto 3).
7. Se crea la feature `Catalog`: dos pantallas, **ninguna API inventada**.
8. Se abre el lienzo, se renombra una caja y se guarda.
9. Se reanaliza con una API nueva en el módulo de imágenes y se compara: «Nuevo en este análisis 1», lo vinculado y lo creado se conservan.
10. Lo documentado a mano sigue igual: la API de salud con la misma versión y descripción, y la caja renombrada en el lienzo.

`walkie-live.spec.ts`, `walkie-live-lienzos.spec.ts` y `walkie-live-reanalisis.spec.ts` cubren las variantes: monorepo, dos «Pedidos», API ambigua, interrupciones de red y paquete parcial.

## 4. Verificación no destructiva

`DiscoveryNonDestructiveTests`. Una app documentada a mano tiene:

- un elemento del catálogo editado (versión 2) y una base;
- un módulo con interfaces;
- dos features con lienzos guardados dos veces (versión 2), con pantalla, `ref`, base, caja de módulo conectada a una interfaz, portal, regla, grupo, nota, tour y posiciones manuales;
- el mapa acomodado.

Sobre esa app se hace:

- un análisis con vincular, descartar, crear dos APIs, un módulo y una feature;
- el mismo `applyId` otra vez, que devuelve el resultado guardado;
- otro `applyId` sobre lo ya decidido, que da 409;
- ediciones a mano de lo creado (descripción del elemento, nombre de la feature, nota en su lienzo);
- un reanálisis con una pantalla nueva;
- una decisión sobre el análisis viejo, que da 409;
- el mismo paquete otra vez, que devuelve `existing`.

**Resultado:** todos los lienzos, elementos del catálogo, nombres y el mapa previos son iguales en contenido (`JsonElement.DeepEquals`) y versión, y lo editado después de crear también. Lo único nuevo es lo aprobado.

Además, `DiscoveryCanvasTests.Si_alguien_guarda_el_lienzo_de_la_feature_durante_la_caida_el_reintento_no_lo_pisa`: si una persona guarda un lienzo mientras la aplicación está caída entre «feature creada» y «lienzo guardado», el reintento deja el lienzo de la persona.

## 5. Límites

Medidos por los dos caminos que reciben un paquete (`DiscoveryUploadTests`, `DiscoveryLimitsTests`, `SafeZipTests`). Ningún rechazo deja un análisis, una fuente, una app ni una bitácora a medias.

| Límite | Dónde se aplica | Rechazo (crear app) |
|---|---|---|
| 50 MB comprimido | `ContentLength` y tamaño del archivo antes de leer el zip (413) | 230 ms (subir 50 MB) |
| 200 MB descomprimido (zip bomb) | suma de tamaños declarados y conteo real al leer, entrada por entrada | 6 ms |
| Entradas: solo `manifest.json` y `discovery.json`; nombres limpios (Zip Slip `../`, absolutas, `\`), sin repetidas, máx. 2000 | `SafeZip` estricto, antes de descomprimir | 4–10 ms |
| JSON inválido y profundidad | `JsonDocument` con profundidad máxima | 10 ms |
| 20.000 entidades, 100.000 relaciones, 100.000 evidencias | `DiscoveryLimits` antes del schema | 87 / 516 / 242 ms (incluye leer el JSON) |
| Referencias rotas, duplicados, fingerprints, rutas absolutas, fragmentos | `DiscoveryPackValidator` | 40 ms |
| CLI: 20.000 archivos, 1 MB por archivo, 20.000 entidades, 50 MB | `AnalyzerLimits` (deja el análisis parcial; solo el tamaño aborta) | `Los_limites_cortan_el_analisis_y_lo_dicen` |

Nada del proyecto analizado se ejecuta: la CLI no usa `Process` (una prueba lo revisa) y la API solo lee los dos JSON del zip.

## 6. Rendimiento

`DiscoveryLoadTests.Matriz_de_rendimiento` (`WALKIE_BENCH=1 Logging__LogLevel__Default=Warning dotnet test apps/api --filter Matriz_de_rendimiento --logger "console;verbosity=detailed"`). El escaneo corre en el proceso de pruebas (sin el arranque de la CLI); los tiempos de la API incluyen HTTP en memoria y Postgres local. Medidas en milisegundos (memoria en MB), con su n:

| Escenario | Medición | n | Mediana | p95 | Máx |
|---|---|---|---|---|---|
| A pequeño (Tienda) | escaneo | 15 | 34 | 341 | 341 |
| | memoria asignada por escaneo (MB) | 15 | 1,3 | 1,3 | 1,3 |
| | validar contrato | 15 | 5,5 | 15 | 15 |
| | subir y guardar | 5 | 51 | 1144 | 1144 |
| | revisión, 1ª página | 20 | 19 | 29 | 516 |
| | evidencia | 20 | 13 | 24 | 80 |
| B mediano (300 APIs, 6 bases, 60 pantallas) | escaneo | 15 | 528 | 2534 | 2534 |
| | CPU del escaneo | 15 | 916 | 3920 | 3920 |
| | memoria asignada por escaneo (MB) | 15 | 87 | 90 | 90 |
| | validar contrato | 15 | 66 | 87 | 87 |
| | subir y guardar | 5 | 413 | 434 | 434 |
| | revisión, 1ª página / filtrada | 20 | 12 / 11 | 15 / 14 | 16 / 21 |
| | vista previa + crear feature con lienzo | 1 | 82 + 152 | — | — |
| C Walkie | escaneo | 10 | 196 | 486 | 486 |
| | memoria asignada por escaneo (MB) | 10 | 66 | 68 | 68 |
| | validar contrato | 10 | 14 | 79 | 79 |
| | subir y guardar | 5 | 56 | 105 | 105 |
| | revisión, 1ª página / filtrada / evidencia | 20 | 5,7 / 4,5 / 2,8 | 7,3 / 5,5 / 3,4 | 7,7 / 13 / 3,5 |
| | módulo / feature: vista previa + crear con lienzo | 1 | 28+45 / 18+28 | — | — |
| D sintético (20.000 APIs) | descomprimir (1,3 MB) | 5 | 12 | 12 | 12 |
| | validar contrato | 5 | 2312 | 2512 | 2512 |
| | subir y guardar | 5 | 5536 | 5736 | 5736 |
| | revisión, 1ª página / filtrada | 20 | 62 / 54 | 297 / 256 | 342 / 350 |
| | evidencia | 20 | 3,5 | 4,7 | 4,7 |
| E 6 análisis de 5.000 de la misma fuente | revisión comparada, 1ª página | 30 | 23 | 149 | 165 |

Los p95 altos de A y B en el escaneo y la subida son las primeras corridas (compilación JIT y cachés frías). La revisión de un análisis de 20.000 entidades sigue debajo de 350 ms en el peor caso medido.

**Lienzos (E2E, Chromium):** abrir un lienzo generado dibuja sus cajas en 180–270 ms; «Ver todo» da 72 cuadros con el peor en 17 ms y 0 tareas largas (`walkie-live-lienzos.spec.ts`, también en el CI). WebKit: §12.

## 7. Concurrencia y memoria

`DiscoveryLoadTests.Las_operaciones_concurrentes_no_duplican_ni_bloquean_y_no_agotan_conexiones` corre siempre (también en el CI):

| Caso | Resultado |
|---|---|
| 6 subidas de paquetes distintos de la misma fuente a la vez | **Defecto encontrado y corregido** (§10, defecto 4): antes, 5 de 6 respondían 500. Ahora las 6 se guardan en cadena (1,5–2,8 s) |
| 6 subidas del mismo paquete a la vez | 1 creada, 5 `existing`; un solo análisis |
| 3 validaciones de 5.000 entidades a la vez (`dryRun`) | 2,7–4,7 s, sin escribir |
| 20 revisiones del mismo análisis con distintos filtros | 270–470 ms en total |
| 6 `apply` sobre el mismo hallazgo con distintos `applyId` | 1 OK, 5 × 409; un solo vínculo |
| El mismo `applyId` 6 veces a la vez | una ejecución (un solo paso en la bitácora); el resto 409 o el resultado guardado |
| Crear app: el mismo `importId` 6 veces / 6 `importId` de la misma fuente | una sola app en los dos casos |
| Al terminar | 40 conexiones abiertas (pool por contexto), 0 candados de sesión colgados; pico de memoria del proceso de pruebas (API incluida) 449–471 MB |

No se vio agotamiento de memoria ni bloqueos largos. Validar el contrato de 20.000 entidades es lo más caro (2,3 s y CPU). Varias subidas grandes a la vez reparten las 4 CPU, sin errores.

## 8. Calidad del analizador

Cubierto por las 91 pruebas de la CLI (proyectos ficticios de ASP.NET Core con Minimal APIs y controllers, EF Core, OpenAPI 3 y Swagger 2 en JSON y YAML, docker-compose, React Router, Next.js con App y Pages Router, Angular standalone y NgModules, y monorepos mixtos) y por el análisis de Walkie (§2):

- **Detección, identidad y determinismo:** claves estables ante renombrar paquetes, mover archivos y cambiar parámetros (`DiscoveryReanalysisTests`). La misma ruta en dos apps son dos pantallas. Las APIs ambiguas quedan como `ambiguous-api` y nunca se conectan. La migración v0 → v1 rechaza lo ambiguo. El paquete es byte a byte determinista.
- **Robustez:** un detector que falla deja el análisis parcial con su motivo. Un archivo roto es una limitación y no detiene el resto. Secretos, `appsettings*`, `.env`, claves y certificados se excluyen (`secret-excluded`). No se siguen enlaces simbólicos.

Limitaciones, por prioridad:

| Prioridad | Limitación | Impacto |
|---|---|---|
| Alta | Clientes HTTP envoltorio (`request(path)` → `fetch(base + path)`) no se siguen | En apps con un cliente propio (Walkie, la mayoría de los fronts serios), las features nacen sin APIs ni módulos: hay que conectarlas a mano |
| Alta | Navegación por funciones (`appPath(id)`) no se resuelve **y no se declara** | Navegación incompleta sin aviso; contradice «declarar lo que no se vio» |
| Media | La vista previa de una feature no avisa cuando la app tiene llamadas sin resolver | La persona ve «Llama a ninguna» sin saber que pueden faltar |
| Media | Bases EF lógicas sin unir a la física del compose | Duplicados conceptuales (5 lógicas + 1 física) que hay que vincular a mano |
| Baja | `dynamic-http-url` de imágenes y fuentes (`canvasImage.ts`) | Ruido en las limitaciones |
| Baja | Vue y Svelte sin analizar | Declarado (`frontend-semantics-not-analyzed`) |

Ninguna se corrige en esta tarea (sin heurísticas nuevas); las dos altas son la siguiente mejora del analizador.

## 9. Operaciones pendientes

| Bitácora | Cómo queda `pending` | Qué la resuelve |
|---|---|---|
| `discovery.applies` + `apply_steps` + `bindings.pending_apply_id` | caída entre la reserva y `completed`, o un fallo que tampoco se pudo compensar (base caída) | el mismo `applyId` (retoma el plan guardado), o la siguiente aplicación que toque un hallazgo reservado (`TryRecoverAsync`: termina o compensa). Termina en `completed` o `compensated` (lo editado queda `kept`) |
| `discovery.source_imports` antes de crear la app | caída al registrar | el mismo `importId` la termina; otra creación desde la fuente la compensa (no hay app) |
| `source_imports` con la app creada y nadie la tocó | caída o fallo antes de guardar el análisis | el mismo `importId` la termina; otra creación desde la fuente borra la app intacta (`compensated`) |
| `source_imports` con la app tocada | fallo y alguien usó la app | el mismo `importId` la termina. **Defecto corregido** (§10, defecto 1): si nadie lo reintenta, la siguiente creación desde la fuente la deja `abandoned` (no borra nada) |
| cualquiera, compensación con error | la base o la red fallan al deshacer | queda `pending` con el error; lo retoman los caminos anteriores |

`GET /review`, `/evidence`, `/sources` y `/bindings` no escriben ni retoman nada; abrir una pantalla no ejecuta compensaciones.

**Operación explícita:** no se expone ninguna acción administrativa a usuarios finales mientras no exista autorización por app (ADR-0015). La resolución ocurre solo al repetir la operación (mismo id) o al empezar otra sobre lo mismo, y nunca borra lo que una persona tocó.

**Procedimiento operativo verificable (solo lectura):**

```sql
-- Importaciones pendientes, con su app y cuánto llevan así
SELECT import_id, source_id, app_id, app_name, error, created_at, updated_at, now() - updated_at AS espera
FROM discovery.source_imports WHERE status = 'pending' ORDER BY updated_at;

-- Aplicaciones pendientes y los hallazgos que reservan
SELECT a.apply_id, a.snapshot_id, a.created_by, a.updated_at, count(b.*) AS reservas
FROM discovery.applies a LEFT JOIN discovery.bindings b ON b.pending_apply_id = a.apply_id
WHERE a.status = 'pending' GROUP BY a.apply_id ORDER BY a.updated_at;

-- ¿Alguien la está ejecutando? (candado de sesión tomado)
SELECT objid FROM pg_locks WHERE locktype = 'advisory';
```

Para resolver una pendiente basta repetir la operación desde la web: abrir la app y cargar de nuevo el mismo proyecto, o repetir la decisión sobre ese hallazgo. Nunca se edita la bitácora a mano.

## 10. Integridad y compensación

| Escenario | Riesgo | Estado |
|---|---|---|
| Referencia agregada durante una compensación | la referencia queda pendiente (módulo) o el lienzo no se puede volver a guardar hasta quitar la caja (`ref` a un elemento borrado: 400) | Residual, ventana de milisegundos entre «nadie lo usa» y el `DELETE`; documentado en ADR-0012. No hay pérdida de datos |
| Módulo referenciado mientras se borra | igual que el anterior | Residual |
| Feature editada durante un reintento | — | El reintento no cambia nombre ni descripción; la compensación no borra si cambiaron (condición en el `DELETE`) |
| Lienzo existente que no es el del plan | — | `CreateInitialAsync` nunca pisa; prueba nueva. La procedencia de sus pantallas apunta a la feature aunque su lienzo sea otro (baja) |
| Componente borrado a mano / vínculo a un destino que ya no existe | — | `targetMissing` en la revisión y `targetExists: false` en la procedencia |
| Importación interrumpida con la app creada | **defecto 1** | Corregido |
| Cambios concurrentes en varios `DbContext` | — | Cada borrado compensatorio lleva la versión, el nombre o la descripción en la condición del `DELETE`; nunca se borra lo editado |

**Defectos encontrados y corregidos en esta tarea:**

1. **Una importación pendiente con la app tocada bloqueaba la fuente para siempre.** Toda creación nueva desde ese proyecto respondía 409 «en curso». Ahora pasa a `abandoned` sin borrar nada (migración `SourceImportAbandoned`). Prueba: `Una_pendiente_con_la_app_tocada_que_nadie_reintenta_no_bloquea_la_fuente_ni_borra_la_app`. Falla sin la corrección.
2. **`ApplyJournal.Down` no se podía ejecutar.** Ponía `''` como valor por defecto de una columna `jsonb`, y Postgres no lo acepta como JSON, ni siquiera sin filas. Ahora usa `{}`.
3. **La vista previa de un módulo sin ninguna API en el catálogo no tenía salida.** Respondía 400 y la web no ofrecía «Crear también en el catálogo las APIs que faltan». Ahora la vista previa muestra el borrador vacío, las APIs sin decidir y el aviso `module-without-apis`; confirmar sin ellas se sigue rechazando. Lo encontró el E2E de §3.
4. **Análisis simultáneos de la misma fuente.** La primera vez daban 500 (la fuente se creaba dos veces), y dos reanálisis podían apuntar al mismo anterior. `SaveAsync` ahora guarda de a uno por (app, fuente) con un candado de transacción.
5. **Contraste (§12):** tres colores de texto de Walkie Live no llegaban a 4,5:1.

## 11. E2E intermitente (`deshacer-y-cajas`)

El fallo en el CI (`8a970a5`, primer intento) fue: después de seleccionar con un clic la caja «API usuarios v2» y pulsar `Supr`, la caja seguía ahí. En local pasó 20 de 20 veces con las 4 CPU ocupadas y 10 de 10 sin carga; no se pudo reproducir.

- **Hipótesis con evidencia en el código:** la selección es estado de `Canvas` y llega a React Flow en el render siguiente; React Flow borra solo lo que su propio estado tiene seleccionado. Un `Supr` que llega antes de ese render no borra nada.
- **Corrección de la prueba:** esperar a que la caja se vea seleccionada (`toHaveClass(/selected/)`) antes de la tecla, como haría una persona. No es un timeout más largo ni un reintento.

No se encontraron otros patrones de clic seguido de `Supr` en los E2E. Si vuelve a fallar con la espera puesta, la causa es otra: revisar el reporte del CI.

**`modo-tour` (también intermitente, encontrado en las repeticiones de esta tarea):**

- Al cerrar con Esc el **segundo** tour, la vista vuelve a `translate(0.035px, 0.027px) scale(1.00001)` en vez de la vista exacta que se guardó al abrirlo (`0,0,1`).
- Se repite 2 de 8 veces con el encuadre inicial que considera las etiquetas y 1 de 5 sin él. Es anterior a esta tarea, y la corrección del encuadre puede hacerlo más frecuente.
- Ya se corrigieron dos carreras reales de la prueba: guardar la vista de referencia antes de que el encuadre inicial termine, y comparar sin esperar la transición de la cámara.
- Lo que queda es una deriva real de la vista (un `fitView` o un `fitAll` que corre entre los dos tours). Queda abierta como tarea aparte, sin agrandar timeouts. Si el CI la muestra, no es de Walkie Live.

## 12. Experiencia visual y accesibilidad

- **Navegadores:** Chromium en local y en el CI. WebKit en local, ver el resultado abajo; no se afirma compatibilidad con Safari real ni con Firefox (no se ejecutaron).
- **Teclado:** la revisión navega con flechas; los diálogos cierran con Esc; todos los botones tienen nombre accesible (las pruebas los ubican por rol y nombre).
- **Estados sin depender del color:** cada estado tiene glifo y texto (Nuevo, Cambió, Ya no aparece, Sin cobertura…).
- **Contraste (WCAG, calculado sobre los tokens):** «Análisis parcial» (`--warn`, 2,85:1), la clave de cada hallazgo (`--stone-500`, 3,57:1) y «Requiere revisión» (`--spice`, 4,48:1) no llegaban a 4,5:1. Ahora usan texto `--ink` con el color en el borde, `--stone-700` (7,0:1) y `--spice-strong` (6,2:1).
- **Errores:** en «Crear app desde proyecto local», el error y «Reintentar» quedaban fuera de la vista. Se corrigió en la tarea 10 (acciones fijas al pie), con capturas.
- **Lienzos:** «Ver todo» y el encuadre al abrir incluyen las etiquetas de las conexiones. Nunca se escriben posiciones (abrir no deja «Sin guardar», probado).
- **Anchos:** el editor se prueba a 768, 1024 y 1440 px (`tours-y-recorridos`, `recorrido-completo`). Las páginas de Walkie Live solo a 1280×800: falta una pasada a anchos chicos (deuda baja).

**WebKit (local, `WALKIE_BROWSER=webkit`):**

- `walkie-live-lienzos`, `walkie-live-reanalisis` y la primera prueba de `walkie-live` pasan.
- Al abrir los lienzos generados, las cajas se dibujan en 198–422 ms. «Ver todo» dio 32–68 cuadros, con el peor entre 85 y 127 ms y 0 tareas largas: los cuadros son más lentos que en Chromium (peor 17 ms) y la cámara lo compensa.
- Fallan, de forma reproducible, `walkie-live-walkie` y la segunda prueba de `walkie-live`, pero **no** en una pantalla de Walkie Live. Después de iniciar sesión, WebKit vuelve a `/` (abre el último lienzo) o queda en «Iniciar sesión», en vez de volver a la ruta pedida. Pasa con un contexto nuevo cuando el mismo trabajador ya corrió otra prueba.
- Es el flujo de inicio de sesión (`signinRedirect` con `state` y `onSigninCallback`), anterior a Walkie Live, y queda como deuda media para quien use Safari.
- No se afirma compatibilidad con Safari real.

## 13. Seguridad

| Control | Estado |
|---|---|
| `Discovery:Enabled` | Apagado por defecto. Con el flag apagado: 404 después de autenticar (401 sin token). Probado en upload, revisión, decisiones, fuentes, procedencia e importación |
| Autenticación | Todos los endpoints exigen JWT (ADR-0003) |
| Contenido no confiable | Todo texto del paquete se pinta como texto; no hay `dangerouslySetInnerHTML` ni `innerHTML` en `apps/web/src` |
| Separación por app | Un `link` solo acepta destinos de la app del análisis; las fuentes y decisiones son por app. **No hay autorización por app**: cualquier usuario autenticado lee y decide sobre cualquier app |
| Subida y ZIP | Ver §5 |
| Secretos | La CLI excluye `.env*`, claves, certificados y `appsettings*`; no copia variables; la evidencia va sin fragmentos de código por defecto |
| IDs | `:guid` en todas las rutas; los ids del cliente se validan como UUID v7 |
| Idempotencia y concurrencia | `applyId` e `importId` con hash de la solicitud, candados de sesión y, desde esta tarea, el candado de guardado por fuente (§7) |

**Bloqueo:** la falta de autorización por app sigue siendo el bloqueo para cualquier piloto o uso real con proyectos privados. Mantener `Discovery:Enabled` apagado lo mitiga, pero no lo resuelve. La propuesta está en [ADR-0015](../../adr/0015-autorizacion-por-app.md), con roles, reglas por endpoint, migración de las apps existentes y pruebas IDOR.

## 14. Calidad de datos y ciclo de vida

- **Inmutabilidad:** los análisis, sus entidades, relaciones y evidencia no se modifican ni se borran (`DiscoveryDbContext` lo rechaza; probado).
- **Trazabilidad:** la procedencia da la fuente, el análisis en que se decidió y la evidencia. `decidedKey` y `legacyBinding` conservan las decisiones v0. `missing` solo cuando el análisis nuevo podía ver el hallazgo; si no, `unverified` con el motivo.
- **Fuentes duplicadas:** la misma fuente en dos apps son dos registros independientes. Se avisa al crear (`source-in-other-apps`).
- **Borrar apps:** la API no tiene `DELETE /api/apps`, así que hoy no quedan datos de Discovery huérfanos por borrar una app. Borrar un módulo o un elemento del catálogo deja el vínculo, marcado como destino inexistente.
- **Huérfanos y retención:** no hay limpieza automática, y no se agregó ninguna. Una app `abandoned` queda visible (alguien la usó). Los análisis viejos se acumulan: falta una política de retención antes de producción (deuda media).

## 15. Distribución de la CLI

| Aspecto | Estado real |
|---|---|
| Forma | .NET Tool (`Walkie.Cli` 0.1.0, comando `walkie`), dependiente del framework |
| Runtime | requiere .NET 10 instalado |
| Instalación reproducible | `dotnet pack apps/cli/src/Walkie.Cli -c Release -o <dir>` + `dotnet tool install Walkie.Cli --tool-path <dir> --add-source <dir>`; o `dotnet run --project apps/cli/src/Walkie.Cli -- scan` desde el repo |
| Publicación | ninguna: no está en NuGet ni en npm. **`npx @walkie/cli` no existe** |
| Sistemas | probado en Linux x64 (local y CI). Windows y macOS no se probaron; el código es .NET puro (Roslyn, YamlDotNet), sin nativo |
| ARM64 | no probado; un tool dependiente del framework corre donde corra .NET 10 |
| Binarios autocontenidos | no hay |
| Firma y procedencia | sin firma ni atestación |
| Versiones | el paquete declara `formatVersion` y la versión del analizador; la API rechaza un formato futuro con «actualiza Walkie» y migra v0 → v1 |

**Incremento mínimo antes de usuarios externos:**

1. Publicar `Walkie.Cli` en un feed NuGet (privado o público), con versión semántica atada a `formatVersion`.
2. Un job de CI que lo empaquete y lo pruebe en Windows, macOS y Linux.
3. Firma del paquete NuGet.

Los binarios autocontenidos y un envoltorio npm son opcionales y se deciden después.

## 16. Migraciones

`DiscoveryMigrationTests`, siempre en bases propias creadas para la prueba:

- **Base vacía:** todas las migraciones aplicadas, Discovery revertido hasta `InitialDatabase` y aplicado otra vez. Encontró el defecto 2 (§10).
- **Estado anterior con datos:** Discovery revertido al estado previo a la tarea 10 (`ApplyContainers`). Se cargan datos reales por la API (análisis, creación en el catálogo, descarte) y se migra hacia adelante, dos veces: la segunda no hace nada. Los conteos y la revisión quedan idénticos, y las restricciones (`ck_*`) e índices (`ux_source_imports_*`) existen. Crear una app después de migrar funciona.
- **Despliegue interrumpido:** cada migración corre en su propia transacción (el script idempotente `dotnet ef migrations script --idempotent` da 7 bloques `START TRANSACTION`). Una caída deja la base en una migración completa y la siguiente ejecución sigue.
- **Backups y restauración:** no se probaron (no hay datos de producción ni procedimiento de backup en el repo). Antes de producción: un `pg_dump` previo a migrar, como procedimiento.
- `PersistenceTests` comprueba las tablas de cada módulo.

## 17. Riesgos y recomendación

| Severidad | Riesgo | Estado |
|---|---|---|
| **Bloqueante** (piloto y producción) | Sin autorización por app: cualquier usuario autenticado ve y decide sobre los análisis de cualquier app | Propuesta en ADR-0015; sin implementar. `Discovery:Enabled` apagado fuera de Development |
| Alta (valor) | El analizador no sigue clientes HTTP envoltorio: las features de apps reales nacen sin APIs | Documentado (§2, §8); siguiente mejora del analizador |
| Alta (honestidad del análisis) | Navegación por funciones sin resolver ni declarar | Documentado; hay que sumar la limitación al detector |
| Media | Sin política de retención de análisis ni limpieza de huérfanos | Deuda antes de producción |
| Media | CLI sin publicar, sin firma y sin pruebas en Windows ni macOS | Incremento mínimo en §15 |
| Media | Inicio de sesión en WebKit vuelve a `/` en vez de la ruta pedida (anterior a Walkie Live) | §12 |
| Baja | Referencia agregada durante una compensación: queda pendiente, o el lienzo no se puede guardar hasta quitar la caja | Residual, ventana de milisegundos (§10) |
| Baja | Páginas de Walkie Live sin probar en anchos chicos | §12 |
| Baja | Un E2E intermitente sin reproducir (`deshacer-y-cajas`) | Prueba sincronizada; vigilar el CI (§11) |
| Baja | `modo-tour`: la vista no vuelve exacta al cerrar el segundo tour (anterior a Walkie Live; ~1 de 5 a 2 de 8 en local) | Tarea aparte (§11) |

**Recomendación:**

- **Integración técnica a `main`: mergeable con condiciones.** Las condiciones son el CI verde sobre el último commit, `Discovery:Enabled` apagado por defecto (ya lo está) y el bloqueo de ADR-0015 visible en la spec. El código está detrás del flag, no cambia lienzos ni el contrato del grafo, y las regresiones de Apps, Canvas, Import/Export y Tours pasan.
- **Habilitación para desarrollo:** sí, con datos ficticios o del propio equipo (`appsettings.Development.json`).
- **Piloto con usuarios reales: bloqueado** hasta implementar y probar ADR-0015 (incluidas las pruebas IDOR). Conviene además seguir los envoltorios HTTP, porque si no las features no muestran sus APIs, y publicar la CLI.
- **Producción: bloqueado** por lo anterior, más retención de datos, backups probados antes de migrar y la CLI firmada.
