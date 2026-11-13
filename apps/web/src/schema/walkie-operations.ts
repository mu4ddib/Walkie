/* Generado desde packages/schema/walkie-operations.json. No editar a mano: `pnpm gen:schema`. */
import type { WalkieOperationsCatalog } from './walkie-operations-catalog';

export const WALKIE_OPERATIONS: WalkieOperationsCatalog = {
  "results": {
    "success": "resultado",
    "empty": "resultado vacío",
    "affected": "filas afectadas",
    "ack": "confirmación",
    "nack": "rechazo",
    "hit": "hit",
    "miss": "miss",
    "content": "contenido",
    "error": "error",
    "message": "mensaje",
    "end": "fin del flujo"
  },
  "patterns": {
    "request-response": "Solicitud y respuesta",
    "one-way": "Envío unidireccional",
    "pub-sub": "Publicación / suscripción",
    "stream": "Streaming"
  },
  "technologies": {
    "api": [
      "HTTP",
      "HTTPS",
      "GraphQL",
      "gRPC",
      "SOAP"
    ],
    "service": [
      "gRPC",
      "HTTP",
      "AWS Lambda",
      "Azure Functions"
    ],
    "database": [
      "PostgreSQL",
      "Oracle",
      "SQL Server",
      "MySQL",
      "MongoDB",
      "DynamoDB"
    ],
    "cache": [
      "Redis",
      "Memcached"
    ],
    "storage": [
      "S3",
      "Azure Blob",
      "GCS"
    ],
    "messaging": [
      "AMQP",
      "Kafka",
      "SQS",
      "SNS",
      "Service Bus",
      "Pub/Sub"
    ],
    "screen": [],
    "actor": [],
    "rule": [],
    "portal": [],
    "other": []
  },
  "operations": [
    {
      "id": "http.request",
      "name": "Enviar solicitud HTTP",
      "verb": "llama",
      "group": "API",
      "patterns": [
        "request-response",
        "one-way"
      ],
      "returns": {
        "action": "Añadir respuesta",
        "verb": "responde",
        "types": [
          "success",
          "error"
        ]
      },
      "sections": [
        "http",
        "result",
        "errors",
        "policy"
      ]
    },
    {
      "id": "service.invoke",
      "name": "Invocar",
      "verb": "invoca",
      "group": "Servicio o función",
      "patterns": [
        "request-response",
        "one-way"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "success",
          "error"
        ]
      },
      "sections": [
        "grpc",
        "params",
        "result",
        "errors",
        "policy"
      ]
    },
    {
      "id": "db.query",
      "name": "Consultar",
      "verb": "consulta",
      "group": "Base de datos",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "success",
          "empty",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "result",
        "errors",
        "policy"
      ],
      "access": "read"
    },
    {
      "id": "db.write",
      "name": "Escribir",
      "verb": "escribe",
      "group": "Base de datos",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "affected",
          "ack",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "db.insert",
      "name": "Insertar",
      "verb": "inserta",
      "group": "Base de datos",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "affected",
          "ack",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "db.update",
      "name": "Actualizar",
      "verb": "actualiza",
      "group": "Base de datos",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "affected",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "db.delete",
      "name": "Eliminar registros",
      "verb": "elimina",
      "group": "Base de datos",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "affected",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "db.procedure",
      "name": "Ejecutar procedimiento",
      "verb": "ejecuta",
      "group": "Base de datos",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "success",
          "empty",
          "affected",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "result",
        "errors",
        "policy"
      ]
    },
    {
      "id": "cache.get",
      "name": "Obtener de caché",
      "verb": "obtiene",
      "group": "Caché",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "hit",
          "miss",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "result",
        "errors",
        "policy"
      ],
      "access": "read"
    },
    {
      "id": "cache.set",
      "name": "Guardar en caché",
      "verb": "guarda",
      "group": "Caché",
      "patterns": [
        "request-response",
        "one-way"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "ack",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "cache.delete",
      "name": "Eliminar de caché",
      "verb": "invalida",
      "group": "Caché",
      "patterns": [
        "request-response",
        "one-way"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "ack",
          "error"
        ]
      },
      "sections": [
        "command",
        "params",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "storage.read",
      "name": "Leer objeto",
      "verb": "lee",
      "group": "Almacenamiento",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "content",
          "miss",
          "error"
        ]
      },
      "sections": [
        "params",
        "result",
        "errors",
        "policy"
      ],
      "access": "read"
    },
    {
      "id": "storage.write",
      "name": "Escribir objeto",
      "verb": "escribe",
      "group": "Almacenamiento",
      "patterns": [
        "request-response",
        "one-way"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "ack",
          "error"
        ]
      },
      "sections": [
        "params",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "storage.list",
      "name": "Listar objetos",
      "verb": "lista",
      "group": "Almacenamiento",
      "patterns": [
        "request-response"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "success",
          "empty",
          "error"
        ]
      },
      "sections": [
        "params",
        "result",
        "errors",
        "policy"
      ],
      "access": "read"
    },
    {
      "id": "storage.delete",
      "name": "Eliminar objeto",
      "verb": "elimina",
      "group": "Almacenamiento",
      "patterns": [
        "request-response",
        "one-way"
      ],
      "returns": {
        "action": "Añadir resultado",
        "verb": "devuelve",
        "types": [
          "ack",
          "error"
        ]
      },
      "sections": [
        "params",
        "errors",
        "policy"
      ],
      "access": "write"
    },
    {
      "id": "message.publish",
      "name": "Publicar",
      "verb": "publica",
      "group": "Mensajería",
      "patterns": [
        "pub-sub",
        "one-way"
      ],
      "returns": {
        "action": "Añadir confirmación del broker",
        "verb": "confirma",
        "types": [
          "ack",
          "nack"
        ]
      },
      "oneWayReturns": true,
      "sections": [
        "messaging",
        "errors"
      ]
    },
    {
      "id": "message.deliver",
      "name": "Entregar",
      "verb": "entrega",
      "group": "Mensajería",
      "patterns": [
        "pub-sub",
        "one-way"
      ],
      "returns": {
        "action": "Añadir reconocimiento del consumidor",
        "verb": "reconoce",
        "types": [
          "ack",
          "nack"
        ]
      },
      "oneWayReturns": true,
      "sections": [
        "messaging"
      ]
    },
    {
      "id": "message.consume",
      "name": "Consumir",
      "verb": "consume",
      "group": "Mensajería",
      "patterns": [
        "pub-sub",
        "one-way"
      ],
      "returns": {
        "action": "Añadir reconocimiento",
        "verb": "reconoce",
        "types": [
          "ack",
          "nack"
        ]
      },
      "oneWayReturns": true,
      "sections": [
        "messaging"
      ]
    },
    {
      "id": "message.reply",
      "name": "Responder (asíncrono)",
      "verb": "responde",
      "group": "Mensajería",
      "patterns": [
        "one-way"
      ],
      "returns": null,
      "sections": [
        "messaging",
        "correlation"
      ]
    },
    {
      "id": "stream.open",
      "name": "Abrir flujo",
      "verb": "abre flujo",
      "group": "Streaming",
      "patterns": [
        "stream"
      ],
      "returns": {
        "action": "Añadir mensaje del flujo",
        "verb": "emite",
        "types": [
          "message",
          "end",
          "error"
        ]
      },
      "sections": [
        "grpc",
        "messaging",
        "params",
        "errors",
        "policy"
      ]
    },
    {
      "id": "stream.send",
      "name": "Enviar mensaje al flujo",
      "verb": "envía",
      "group": "Streaming",
      "patterns": [
        "stream"
      ],
      "returns": null,
      "sections": [
        "messaging"
      ]
    },
    {
      "id": "stream.receive",
      "name": "Recibir mensaje del flujo",
      "verb": "recibe",
      "group": "Streaming",
      "patterns": [
        "stream"
      ],
      "returns": null,
      "sections": [
        "messaging"
      ]
    },
    {
      "id": "stream.close",
      "name": "Finalizar flujo",
      "verb": "cierra",
      "group": "Streaming",
      "patterns": [
        "stream"
      ],
      "returns": null,
      "sections": []
    },
    {
      "id": "relation.uses",
      "name": "Usa",
      "verb": "usa",
      "group": "Relación general",
      "patterns": [
        "one-way"
      ],
      "returns": null,
      "sections": []
    },
    {
      "id": "relation.depends",
      "name": "Depende de",
      "verb": "depende de",
      "group": "Relación general",
      "patterns": [
        "one-way"
      ],
      "returns": null,
      "sections": []
    },
    {
      "id": "navigation",
      "name": "Navegar",
      "verb": "navega",
      "group": "Interfaz",
      "patterns": [
        "one-way"
      ],
      "returns": null,
      "sections": []
    },
    {
      "id": "custom",
      "name": "Operación personalizada…",
      "verb": "opera",
      "group": "Otra",
      "patterns": [
        "request-response",
        "one-way",
        "pub-sub",
        "stream"
      ],
      "returns": {
        "action": "Añadir retorno",
        "verb": "devuelve",
        "types": [
          "success",
          "empty",
          "affected",
          "ack",
          "nack",
          "hit",
          "miss",
          "content",
          "error",
          "message",
          "end"
        ]
      },
      "sections": [
        "command",
        "params",
        "entities",
        "result",
        "errors",
        "policy",
        "messaging",
        "correlation"
      ]
    }
  ]
};
