# Spec: Puertos de conexión

- Issue padre: #116
- Estado: implementada

## Objetivo

Que un nodo con muchas conexiones se lea sin enredos: cada conexión entra o sale por el lado de la caja que mira hacia el otro extremo, y las que comparten lado se reparten a lo largo de él en vez de salir del mismo punto.

## Usuarios

Quien arma y lee un lienzo con varias integraciones por nodo (una pantalla que navega y llama, una API con varios servicios).

## Criterios de aceptación

- [ ] Dado un nodo, cuando paso el puntero, entonces veo un punto de conexión en cada uno de sus cuatro lados, y puedo empezar o terminar una conexión en cualquiera.
- [ ] Dada una conexión, entonces sale del lado del origen que mira hacia el destino y entra por el lado del destino que mira hacia el origen (arriba/abajo si están más separados en vertical que en horizontal; si no, izquierda/derecha). El sentido, la flecha y la etiqueta no cambian.
- [ ] Dado un lado con varias conexiones (ej. «Home» → navega, llama, navega), entonces cada una tiene su propio punto, repartido a lo largo del lado y ordenado según dónde está su otro extremo, para que los trazos no se crucen al salir.
- [ ] Dado un par de nodos con varias conexiones entre sí (ej. solicitud y respuesta), entonces cada una va por su propio punto en ambos extremos y sus etiquetas no se tapan.
- [ ] Dada una decisión, entonces cada rama sigue saliendo del punto de su salida («Sí», «No»…); el reparto aplica al extremo de llegada.
- [ ] Dado un grupo plegado que recibe varias conexiones, entonces también las reparte por sus lados.
- [ ] Dado que muevo una caja, cuando cambia qué lado mira al otro extremo, entonces la conexión cambia de lado al soltarla (y durante el arrastre).
- [ ] Los recorridos, la previsualización, los tours y el enlace de solo lectura dibujan las conexiones igual.
- [ ] Los E2E existentes de conexiones siguen pasando.

## Fuera de alcance

- Fijar a mano el lado de una conexión (ver preguntas abiertas).
- Esquivar cajas que quedan en medio del trazo (enrutado con obstáculos).

## Impacto en el modelo

Ninguno: el lado y el punto se calculan al dibujar. Las conexiones existentes se ven repartidas sin migrar nada.

## Impacto en la API

Ninguno.

## Decisiones

- Solo reparto automático; fijar el lado a mano queda para más adelante (aprobado por el autor, 2026-11-10).
