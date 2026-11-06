# Roadmap del MVP

Estimado para una persona a medio tiempo (~12 semanas). Plan completo y diagramas: documento "Walkie — Roadmap MVP, stack e infraestructura" en Claude.

| Fase | Semanas | Entregables | Gate |
| --- | --- | --- | --- |
| 0 Fundamentos | 1-2 | Monorepo, devcontainer, CI, docker-compose, schema v0, auth básica | — |
| 1 Lienzo base | 3-5 | React Flow, App y Feature, 3 tipos de nodo, guardar/cargar con versión, estilo pixel v1 | Un flujo se guarda y se recarga igual |
| 2 Cajas ricas | 6-8 | 8 tipos de nodo, panel de propiedades, adjuntar imagen, inputs y reglas, catálogo + `ref` + `portal` | — |
| 3 Modo tour | 9-10 | Tours por pasos, personaje pixel, resaltar nodo, notas por paso | Una persona nueva entiende el tour sin ayuda |
| 4 Compartir | 11-12 | Enlace de solo lectura, export Markdown, deploy en la nube, piloto | MVP listo: piloto con un equipo |

## Post-MVP

1. Colaboración: presencia (SignalR) → edición concurrente (Yjs + Hocuspocus).
2. Organizaciones, roles por app/feature, SSO (OIDC/SAML).
3. Importar/exportar OpenAPI.
4. Integración con Figma.
5. Historial y comparación de versiones; auditoría.
6. Despliegue self-hosted (Helm) para banca.
