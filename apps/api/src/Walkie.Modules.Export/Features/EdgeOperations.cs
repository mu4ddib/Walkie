using System.Text.Json;

namespace Walkie.Modules.Export.Features;

/// <summary>
/// Operaciones de una conexión para el export (spec interacciones, ADR-0011): el mismo catálogo que
/// <c>apps/web/src/interactions/operations.ts</c> (nombre, verbo y verbo del retorno). La operación es la fuente de
/// verdad; sin ella, la conexión se describe por su tipo como antes.
/// </summary>
internal static class EdgeOperations
{
    private sealed record Operation(string Name, string Verb, string? ReturnVerb, string? Access = null, bool OneWayReturns = false);

    private static readonly Dictionary<string, Operation> Catalog = new(StringComparer.Ordinal)
    {
        ["http.request"] = new("Enviar solicitud HTTP", "llama", "responde"),
        ["service.invoke"] = new("Invocar", "invoca", "devuelve"),
        ["db.query"] = new("Consultar", "consulta", "devuelve", "read"),
        ["db.write"] = new("Escribir", "escribe", "devuelve", "write"),
        ["db.insert"] = new("Insertar", "inserta", "devuelve", "write"),
        ["db.update"] = new("Actualizar", "actualiza", "devuelve", "write"),
        ["db.delete"] = new("Eliminar registros", "elimina", "devuelve", "write"),
        ["db.procedure"] = new("Ejecutar procedimiento", "ejecuta", "devuelve"),
        ["cache.get"] = new("Obtener de caché", "obtiene", "devuelve", "read"),
        ["cache.set"] = new("Guardar en caché", "guarda", "devuelve", "write"),
        ["cache.delete"] = new("Eliminar de caché", "invalida", "devuelve", "write"),
        ["storage.read"] = new("Leer objeto", "lee", "devuelve", "read"),
        ["storage.write"] = new("Escribir objeto", "escribe", "devuelve", "write"),
        ["storage.list"] = new("Listar objetos", "lista", "devuelve", "read"),
        ["storage.delete"] = new("Eliminar objeto", "elimina", "devuelve", "write"),
        ["message.publish"] = new("Publicar", "publica", "confirma", OneWayReturns: true),
        ["message.deliver"] = new("Entregar", "entrega", "reconoce", OneWayReturns: true),
        ["message.consume"] = new("Consumir", "consume", "reconoce", OneWayReturns: true),
        ["message.reply"] = new("Responder (asíncrono)", "responde", null),
        ["stream.open"] = new("Abrir flujo", "abre flujo", "emite"),
        ["stream.send"] = new("Enviar mensaje al flujo", "envía", null),
        ["stream.receive"] = new("Recibir mensaje del flujo", "recibe", null),
        ["stream.close"] = new("Finalizar flujo", "cierra", null),
        ["relation.uses"] = new("Usa", "usa", null),
        ["relation.depends"] = new("Depende de", "depende de", null),
        ["navigation"] = new("Navegar", "navega", null),
        ["custom"] = new("Operación personalizada", "opera", "devuelve"),
    };

    public static readonly Dictionary<string, string> ResultLabels = new(StringComparer.Ordinal)
    {
        ["success"] = "resultado",
        ["empty"] = "resultado vacío",
        ["affected"] = "filas afectadas",
        ["ack"] = "confirmación",
        ["nack"] = "rechazo",
        ["hit"] = "hit",
        ["miss"] = "miss",
        ["content"] = "contenido",
        ["error"] = "error",
        ["message"] = "mensaje",
        ["end"] = "fin del flujo",
    };

    public static readonly Dictionary<string, string> PatternLabels = new(StringComparer.Ordinal)
    {
        ["request-response"] = "solicitud y respuesta",
        ["one-way"] = "envío unidireccional",
        ["pub-sub"] = "publicación / suscripción",
        ["stream"] = "streaming",
    };

    /// <summary>Operación explícita de la conexión (<c>operation</c>), o <c>null</c>.</summary>
    public static string? Of(JsonElement edge) =>
        edge.TryGetProperty("operation", out var op) && op.ValueKind == JsonValueKind.String ? op.GetString() : null;

    /// <summary>Nombre visible; la personalizada, con el suyo.</summary>
    public static string? Name(JsonElement edge) => Of(edge) switch
    {
        null => null,
        "custom" => Custom(edge) ?? Catalog["custom"].Name,
        var id => Catalog.TryGetValue(id, out var op) ? op.Name : id,
    };

    /// <summary>Verbo de la conexión con operación («consulta»); <c>null</c> sin operación.</summary>
    public static string? Verb(JsonElement edge) => Of(edge) switch
    {
        null => null,
        "custom" => Custom(edge)?.ToLowerInvariant() ?? Catalog["custom"].Verb,
        var id => Catalog.TryGetValue(id, out var op) ? op.Verb : null,
    };

    /// <summary>Verbo de un retorno según la operación a la que responde («devuelve», «confirma»…).</summary>
    public static string? ReturnVerb(string? parentOperation, string? resultType) =>
        parentOperation is null ? null
        : resultType == "error" ? "error"
        : Catalog.TryGetValue(parentOperation, out var op) ? op.ReturnVerb : null;

    /// <summary>¿La operación espera retorno con su patrón? (un envío unidireccional no, salvo las confirmaciones de mensajería).</summary>
    public static bool ExpectsReturn(string? operation, string? pattern) =>
        operation is null || (Catalog.TryGetValue(operation, out var op) && op.ReturnVerb is not null
            && (pattern != "one-way" || op.OneWayReturns));

    /// <summary>Acceso a datos que implica la operación efectiva (explícita o, sin ella, por el tipo anterior).</summary>
    public static string? Access(JsonElement edge, string kind) => Of(edge) is { } id
        ? Catalog.GetValueOrDefault(id)?.Access
        : kind switch
        {
            "reads" => "read",
            "writes" => "write",
            _ => null,
        };

    private static string? Custom(JsonElement edge) =>
        edge.TryGetProperty("customOperation", out var name) && name.GetString() is { Length: > 0 } text ? text : null;
}
