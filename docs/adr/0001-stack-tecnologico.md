# ADR-0001: .NET 10 + React Flow + PostgreSQL en un monolito modular

- Estado: aceptado
- Fecha: 2026-11-06

## Contexto

Walkie lo desarrolla al inicio una sola persona, desde dos computadores. Debe ser robusto, aceptable en banca y capaz de volverse colaborativo en tiempo real más adelante.

## Opciones consideradas

1. **.NET 10** — dominio previo del autor, alto rendimiento, SignalR para tiempo real, común en banca. Menos librerías CRDT maduras.
2. **Java 25 + Spring Boot** — muy común en banca, ecosistema enorme. Más ceremonia y menor velocidad para una persona.
3. **Go** — excelente concurrencia y binarios pequeños. Menos "baterías incluidas" para CRUD, auth y ORM.
4. **Node/TypeScript** — mismo lenguaje que el front, Yjs nativo. Menos estructura para un dominio complejo.

## Decisión

API en .NET 10 (LTS) como monolito modular, front en React + TypeScript + React Flow, PostgreSQL con `jsonb` para el grafo. Si la colaboración necesita CRDT, se agrega un servicio de sincronización pequeño (Hocuspocus en Node, o Go) sin reescribir la API.

## Consecuencias

- Positivas: velocidad de desarrollo, un solo despliegue en el MVP, camino claro a tiempo real.
- Negativas: dos lenguajes (C# y TS); el servicio de sync agregaría un tercer runtime.
- Revertir: el contrato está en JSON Schema, así que la API podría reescribirse sin tocar el front.
