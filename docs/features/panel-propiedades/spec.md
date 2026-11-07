# Spec: Panel de propiedades y tipos de nodo restantes

- Issue padre: #19
- Estado: aprobada (2026-11-07)
- Fase 2 ("cajas ricas"), feature 1 de 3. Las otras dos: catálogo + `ref`; imágenes + `portal`.

## Objetivo

Documentar en el lienzo qué hace cada caja, no solo su nombre: descripción, inputs de pantalla con sus reglas, el contrato básico de una API y los nodos `actor`, `rule` y `service`.

## Usuarios

Desarrollador que documenta un flujo y necesita dejar escrito qué pide cada pantalla, qué valida cada regla y a qué endpoint llama. Lo lee después alguien que se está incorporando al equipo.

## Criterios de aceptación

**Paleta y tipos nuevos**

- [ ] 1. Dado un lienzo, cuando abro la paleta, entonces además de `screen`, `api` y `database` veo `actor`, `rule` y `service`, cada uno con su color y glifo, y los agrego igual que los demás.
- [ ] 2. Dado que conecto nodos de tipos nuevos, entonces la conexión toma un tipo por defecto según el par: `actor→screen` navigation, `api→service` request, `service→database` reads, `screen→rule` uses; cualquier otro par sigue en `uses`.

**Panel de propiedades**

- [ ] 3. Dado un lienzo, cuando selecciono un solo nodo, entonces se abre un panel lateral derecho con sus propiedades; con cero o varios seleccionados, el panel muestra un texto de ayuda.
- [ ] 4. Dado el panel de cualquier nodo, cuando edito título o descripción, entonces el cambio se ve en el nodo al instante y el lienzo queda "Sin guardar".
- [ ] 5. Dado un nodo `rule`, cuando escribo su expresión (texto libre, ej. "cc: solo dígitos, de 6 a 10"), entonces el nodo muestra las primeras líneas de la expresión.
- [ ] 6. Dado un nodo `api`, cuando elijo el método (GET, POST, PUT, PATCH, DELETE) y escribo la ruta (ej. `/clientes/{id}`), entonces el nodo muestra `MÉTODO /ruta`.
- [ ] 7. Dada una conexión seleccionada, cuando abro el panel, entonces puedo cambiar su tipo, su etiqueta (`label`) y su condición (`when`, ej. "200" o "404"), y la etiqueta y la condición se ven sobre la conexión.

**Inputs de pantalla y reglas**

- [ ] 8. Dado un nodo `screen`, cuando agrego un input en el panel, entonces puedo darle nombre, tipo (`string`, `number`, `boolean`, `date`, `enum`, `file`) y marcarlo como obligatorio; el nodo lista sus inputs y marca los obligatorios con `*`.
- [ ] 8b. Dado un input de tipo `enum`, cuando escribo sus opciones (una por línea, ej. "Ahorros", "Corriente"), entonces quedan guardadas con el input; al cambiar a otro tipo, las opciones se descartan.
- [ ] 8c. Dado un nodo con mucho contenido, entonces dentro de la caja se ven como máximo 5 inputs y 3 líneas de la expresión de una regla, seguidos de "+N más"; el detalle completo está en el panel.
- [ ] 9. Dado un input, cuando lo asocio a una o varias reglas, entonces solo puedo elegir nodos `rule` del mismo lienzo, y el panel de la regla muestra qué inputs la usan.
- [ ] 10. Dado un input, cuando lo quito, entonces desaparece del nodo; no hay inputs con el mismo nombre en una pantalla (el panel lo impide y avisa).
- [ ] 11. Dado un nodo `rule` asociado a inputs, cuando lo borro, entonces las asociaciones desaparecen de esos inputs (no quedan referencias rotas).

**Persistencia**

- [ ] 12. Dado un lienzo con todo lo anterior, cuando guardo y recargo, entonces aparece idéntico (descripciones, inputs, reglas asociadas, método y ruta, etiquetas y condiciones de las conexiones).
- [ ] 13. Dado un grafo con un input asociado a un nodo que no existe o que no es `rule`, cuando la API lo recibe, entonces responde 400 con la ruta del error (ej. `/nodes/n1/inputs/0/ruleIds/0`).

## Fuera de alcance

- Request y response de las APIs (cuerpos, códigos): se definen en el catálogo (feature 2), donde el contrato es compartido.
- Catálogo, nodos `ref` y `portal`; adjuntar imágenes a pantallas (features 2 y 3).
- Reordenar inputs (se agregan al final).
- Reglas ejecutables o validadas: la expresión es texto para personas.
- Formato enriquecido (Markdown) en descripciones.
- Deshacer/rehacer.

## Impacto en el modelo

`packages/schema/walkie-graph.schema.json` ya tiene casi todo (`description`, `inputs[]` con `ruleIds`, `expression`, `http.method/path`, `edge.label/when`). Cambios propuestos (schema v0 sigue siendo v0: solo se agregan límites y un campo opcional):

- `node.description`: `maxLength: 2000`.
- `node.expression`: `maxLength: 2000`.
- `input.name`: `minLength: 1`, `maxLength: 60`.
- `input.options`: `string[]` opcional (cada opción `minLength: 1`, `maxLength: 60`), solo para inputs `enum`.
- `edge.label`, `edge.when`: `maxLength: 60`.

Se regeneran los tipos de la web (`pnpm gen:schema`).

## Impacto en la API

Sin endpoints nuevos: todo viaja en el `PUT /api/features/{featureId}/canvas` existente. La validación de integridad suma:

- Cada `inputs[i].ruleIds[j]` apunta a un nodo existente de tipo `rule` → si no, 400 en `/nodes/{id}/inputs/{i}/ruleIds/{j}`.
- Nombres de input únicos dentro de cada nodo → si no, 400 en `/nodes/{id}/inputs/{i}/name`.
- `options` solo en inputs `enum` → si no, 400 en `/nodes/{id}/inputs/{i}/options`.

## Decisiones tomadas

1. Los inputs `enum` guardan su lista de opciones (`options`), editada como texto, una opción por línea.
2. Dentro del nodo se ve una lista corta: hasta 5 inputs y 3 líneas de la expresión, con "+N más". El detalle completo está en el panel.
3. Tipos de conexión por defecto del criterio 2 aprobados tal cual.
