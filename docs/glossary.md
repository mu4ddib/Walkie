# Glosario

| Término | Definición |
| --- | --- |
| **App** | Aplicación documentada. Contiene un catálogo y varias features. |
| **Feature** | Funcionalidad con un único objetivo de usuario (iniciar sesión, transferir). Tiene un lienzo y sus tours. |
| **Lienzo (canvas)** | Grafo de nodos y conexiones de una feature, más su `layout`. |
| **Catálogo** | Nodos reutilizables de la app (`api`, `service`, `database`) definidos una sola vez. |
| **Nodo** | Caja del lienzo. Tipos: `actor`, `screen`, `rule`, `api`, `service`, `database`, `ref`, `portal`. |
| **ref** | Nodo que apunta a un elemento del catálogo (`catalogId`). Si el elemento cambia, cambia en todos los lienzos. |
| **portal** | Nodo que lleva a otra feature. Permite recorrer la app sin un lienzo gigante. |
| **Conexión (edge)** | Relación entre nodos. Tipos: `navigation`, `request`, `response`, `uses`, `reads`, `writes`. |
| **Input** | Dato que una pantalla pide al usuario (ej. `cc`), con sus reglas. |
| **Regla** | Validación o lógica de negocio (ej. `cc` de 6 a 10 dígitos). |
| **Tour** | Secuencia de pasos sobre nodos de una feature, con notas; puede continuar por un portal. |
| **Layout** | Posición `x, y` de cada nodo, guardada aparte del contenido. |

## Regla de corte

Un lienzo cubre un solo objetivo de usuario. Si necesita scroll para entenderse, se divide en dos features unidas por un portal.
