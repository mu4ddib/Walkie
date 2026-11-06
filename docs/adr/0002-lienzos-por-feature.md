# ADR-0002: Un lienzo por feature, con catálogo compartido y portales

- Estado: aceptado
- Fecha: 2026-11-06

## Contexto

Un solo lienzo por app crece sin control, se vuelve ilegible y pesado de renderizar, y genera más conflictos cuando haya edición concurrente.

## Opciones consideradas

1. Un lienzo por app con zoom y agrupación.
2. **Un lienzo por feature**, con un catálogo de nodos compartidos a nivel de app y portales entre features.

## Decisión

Opción 2. App → Catálogo + Features; cada Feature tiene un lienzo y tours. Los nodos `api`, `service` y `database` viven en el catálogo y se usan en los lienzos mediante nodos `ref`. Los nodos `portal` enlazan features.

## Consecuencias

- Positivas: lienzos pequeños y enfocados; un contrato de API se edita en un solo lugar; tours por objetivo de usuario; menos conflictos al colaborar.
- Negativas: hace falta una vista de "mapa de la app" para ver todas las features; borrar un elemento del catálogo exige revisar sus referencias.
- Regla de corte: un lienzo = un objetivo de usuario.
