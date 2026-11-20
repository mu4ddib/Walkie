# ADR-0016: Inferencia por etapas, relaciones con cadena de evidencia y arquitectura calculada

- Estado: aceptado
- Fecha: 2026-11-20

## Contexto

Walkie Live (ADR-0012, ADR-0013 y ADR-0014) descubre entidades, pero casi no las relaciona. Analizando Walkie, hay 0 `calls` (las 43 llamadas pasan por `request()`/`send()`) y 9 de 61 navegaciones. Las features propuestas se agrupan por el último segmento de la ruta y no tienen conexiones. El diagnóstico completo está en `docs/features/walkie-live-arquitectura/spec.md` (C1–C9).

Para mejorar sin perder la regla de no adivinar, hay que decidir cuatro cosas:

1. Hasta dónde sigue el análisis estático una llamada.
2. Cómo se distingue lo visto de lo deducido.
3. Si hace falta cambiar el `.walkiepack`.
4. Dónde se calcula una vista de conjunto que no es un lienzo.

## Opciones consideradas

1. **Cambiar el formato** (`formatVersion` 2), con entidades nuevas para servicios del front, handlers y cadenas. Daría más detalle, pero obliga a migrar todo el contrato. Además, buena parte de esas entidades no se proponen como nada en Walkie.
2. **Relaciones del contrato v1 con varias evidencias, y proyección de arquitectura calculada en la API** (elegida). Cada salto de la cadena es una evidencia (archivo, línea, ancla, regla) de la misma relación. La vista de conjunto se calcula al pedirla, con lo que ya está guardado.
3. **Guardar la arquitectura inferida** como otra tabla. Habría que mantenerla al día con cada análisis y cada decisión, y no agrega información: todo sale de los hallazgos.

## Decisión

**Tres etapas.**

1. **Descubrimiento** (CLI): entidades con evidencia, como hoy.
2. **Relación** (CLI): `calls`, `navigates`, `reads`, `writes`, `exposes`, `depends-on`, `contains`. Cada una con `basis` y confianza.
3. **Interpretación**:
   - Las propuestas de feature salen de la CLI, porque necesitan clave estable para la revisión y los vínculos.
   - La proyección de arquitectura (grupos, aristas agregadas, cobertura y motivos) sale de la API: calculada, sin guardar y sin efectos.

**Análisis estático acotado (CLI).**

- Una llamada se sigue por nombre a funciones resueltas en el mismo archivo o por importación relativa (también objetos de funciones, `import * as` y métodos de servicios de Angular inyectados). Se cuentan aparte dos límites de **3 saltos**:
  - **hacia adentro:** envoltorios HTTP (`getApp` → `request` → `send` → `fetch`) y funciones que arman rutas (`appPath(id)` → `` `/apps/${id}` ``);
  - **hacia afuera:** consumidores (pantalla → hook → función del cliente).
- Un envoltorio se reconoce por la forma de su URL. Su parámetro ocupa el principio de la ruta (después de una base opcional: una constante del módulo que no es literal, `this.apiUrl`, `environment.x`) o un pedazo que no es un segmento entero (`/v1${path}`). Un parámetro que ocupa un segmento entero (`/api/apps/${appId}`) es un parámetro de la ruta: la llamada ya se resuelve ahí. El método sale de la opción `method` (literal, de un parámetro o de las opciones que llegan como parámetro); sin ella, el de `fetch` (`GET`).
- No se siguen callbacks, recursión, valores calculados, inyección dinámica ni paquetes.
- Un componente que dibujan más de **3 pantallas** es compartido: sus llamadas y enlaces quedan en la app técnica, no en cada pantalla.
- En .NET, endpoint → método del handler (grupo de métodos o lambda) → método de un parámetro inyectado → `DbSet` del `DbContext` del constructor. Esto da `reads` (consulta) o `writes` (`Add`, `Update`, `Remove`, `ExecuteUpdate`, `ExecuteDelete`, `SaveChanges`) desde la **api** hacia la base lógica. Un registro de DI solo no prueba nada.

**Confianza.**

| Nivel | Cuándo |
|---|---|
| `observed` · `high` | Todo literal y en un solo lugar |
| `observed` · `medium` | En un solo lugar, con una parte que no se ve |
| `inferred` · `medium` | Cadena de hasta 3 saltos por nombre resuelto, un solo destino |
| `inferred` · `low` | La cadena pasa por un componente dibujado, o el grupo solo se sostiene en la forma de las rutas |

Lo inferido nunca es `high` (ADR-0014).

**Lo que no se resuelve se declara**, con archivo y detector:

- `dynamic-navigation`: una navegación a una ruta calculada;
- `navigation-target-unknown`: el destino no coincide con ninguna pantalla;
- `http-wrapper-unresolved`: el argumento de un envoltorio no se puede leer.

Las dos primeras dejan el análisis `partial`. `non-api-fetch` (un `fetch` de un blob, un `data:` o una hoja de estilos) no lo deja parcial.

**Propuestas de feature.** Se arman por familia de rutas (la ruta sin parámetros) dentro de una app técnica, con un puntaje explicado:

- navegación entre sus pantallas y carga diferida común: evidencia fuerte;
- APIs en común y APIs de un mismo módulo: evidencia media;
- solo la forma de la ruta: evidencia débil.

El nombre es el título de la pantalla con la ruta más corta. Una pantalla está en una sola propuesta.

**Contrato.**

- Sin cambio de `formatVersion`.
- `reads`/`writes` pueden salir de una `api`: el validador no restringe los extremos, y se amplía la descripción del tipo.
- Las capacidades nuevas de los detectores van en el manifest de cada paquete, como siempre.

## Consecuencias

- Los análisis guardados no cambian: son inmutables y se interpretan igual. Un reanálisis con la CLI nueva da más relaciones y otras propuestas.
  - Una propuesta nueva tiene otra clave y la revisión la muestra como nueva.
  - Una feature ya creada conserva su vínculo.
- La proyección se calcula en cada pedido. Por eso tiene que ser barata: consultas sin `jsonb`, sin N+1 y con un presupuesto medido con 2.000 y 20.000 entidades.
- La vista de arquitectura nunca guarda posiciones ni decisiones: no es un segundo editor.
- La explicación de una relación inferida es su lista de evidencias. Si una cadena necesitara más de 3 saltos para ser útil, se revisa este ADR antes de subir el límite.
