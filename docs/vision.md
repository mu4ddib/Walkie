# Visión

## Problema

La documentación de una app vive dispersa: diseños en Figma, contratos en Swagger, reglas de negocio en la cabeza de alguien, arquitectura en un diagrama desactualizado. Un integrante nuevo tarda semanas en entender cómo se conectan.

## Propuesta

Walkie une en un solo lienzo, por funcionalidad:

- **Pantallas** con su diseño (captura o Figma) y los datos que piden (inputs).
- **Reglas y validaciones** asociadas a esos inputs.
- **APIs** con request y response, **servicios** y **bases de datos**.
- **Tours** guiados paso a paso, con estilo pixel art, para onboarding.

## Público

1. Desarrolladores nuevos en un equipo (onboarding).
2. Equipos que presentan una feature nueva.
3. Líderes técnicos y de producto que necesitan entender el alcance y la integración de componentes.

Contexto principal: apps internas en banca (self-hosted, SSO, auditoría).

## Qué no es

- No es un editor de diseño (no reemplaza a Figma).
- No es un pizarrón libre (no reemplaza a Miro): cada caja tiene tipo y datos estructurados.
- No genera código de la app documentada.

## Métrica de éxito del MVP

Una persona nueva entiende un flujo real (ejemplo: login) solo siguiendo el tour, sin explicación adicional.

## Referencias del estado del arte

- Overflow: flujos de usuario con pantallas reales, sin backend ni reglas.
- IcePanel: arquitectura C4 con flows interactivos, sin pantallas ni UI.
- Eraser: diagramas como código para ingeniería, sin enfoque narrativo.
- Miro / FigJam: lienzo libre, cajas sin semántica.
