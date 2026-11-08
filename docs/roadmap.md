# Roadmap del MVP

Estimado para una persona a medio tiempo (~12 semanas). Plan completo y diagramas: documento "Walkie — Roadmap MVP, stack e infraestructura" en Claude.

| Fase | Semanas | Entregables | Gate |
| --- | --- | --- | --- |
| 0 Fundamentos ✅ | 1-2 | Monorepo, devcontainer, CI, docker-compose, schema v0, auth básica | — |
| 1 Lienzo base ✅ | 3-5 | React Flow, App y Feature, 3 tipos de nodo, guardar/cargar con versión, estilo pixel v1 | Un flujo se guarda y se recarga igual (E2E `apps/web/e2e/lienzo-base.spec.ts` en CI) |
| 2 Cajas ricas ✅ | 6-8 | 8 tipos de nodo, panel de propiedades, adjuntar imagen, inputs y reglas, catálogo + `ref` + `portal` | Una feature documentada (inputs, reglas, catálogo, imagen y portal) se guarda y se recarga igual (E2E `panel-propiedades`, `catalogo` e `imagenes-portal` en CI) |
| 3 Modo tour ✅ | 9-10 | Tours por pasos, personaje pixel, resaltar nodo, notas por paso | Una persona nueva entiende el tour sin ayuda (flujo verificado por el E2E `modo-tour` en CI; falta la prueba con alguien del equipo) |
| 4 Compartir | 11-12 | Enlace de solo lectura ✅ (E2E `enlace-solo-lectura` en CI), export Markdown ✅ (E2E `export-markdown` en CI), deploy en la nube, piloto | MVP listo: piloto con un equipo |

## Post-MVP

1. Colaboración: presencia (SignalR) → edición concurrente (Yjs + Hocuspocus).
2. Organizaciones, roles por app/feature, SSO (OIDC/SAML).
3. Importar/exportar OpenAPI.
4. Integración con Figma.
5. Historial y comparación de versiones; auditoría.
6. Despliegue self-hosted (Helm) para banca.
