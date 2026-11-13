using System.Text.Json;
using Walkie.Shared.Schemas;

namespace Walkie.Modules.Export.Features;

/// <summary>
/// Operaciones de una conexión para el export (spec interacciones, ADR-0011). Lee el catálogo único
/// <c>packages/schema/walkie-operations.json</c> (el mismo del que se genera la web): nombre, verbo, verbo del retorno
/// y acceso a datos. La operación es la fuente de verdad; sin ella, la conexión se describe por su tipo como antes.
/// </summary>
internal static class EdgeOperations
{
    private sealed record Operation(string Name, string Verb, string? ReturnVerb, string? Access, bool OneWayReturns);

    private static readonly Dictionary<string, Operation> Catalog;

    public static readonly Dictionary<string, string> ResultLabels;

    public static readonly Dictionary<string, string> PatternLabels;

    static EdgeOperations()
    {
        using var doc = JsonDocument.Parse(WalkieSchemas.OperationsCatalog);
        var root = doc.RootElement;
        Catalog = root.GetProperty("operations").EnumerateArray().ToDictionary(
            o => o.GetProperty("id").GetString()!,
            o => new Operation(
                o.GetProperty("name").GetString()!,
                o.GetProperty("verb").GetString()!,
                o.GetProperty("returns").ValueKind == JsonValueKind.Object
                    ? o.GetProperty("returns").GetProperty("verb").GetString()
                    : null,
                o.TryGetProperty("access", out var access) ? access.GetString() : null,
                o.TryGetProperty("oneWayReturns", out var oneWay) && oneWay.GetBoolean()),
            StringComparer.Ordinal);
        ResultLabels = Labels(root.GetProperty("results"), lower: false);
        // En una línea de texto («solicitud y respuesta · PostgreSQL») el patrón va en minúsculas.
        PatternLabels = Labels(root.GetProperty("patterns"), lower: true);
    }

    /// <summary>Ids del catálogo (la prueba los compara con el enum <c>operation</c> del grafo).</summary>
    public static IReadOnlyCollection<string> Ids => Catalog.Keys;

    /// <summary>Operación explícita de la conexión (<c>operation</c>), o <c>null</c>.</summary>
    public static string? Of(JsonElement edge) =>
        edge.TryGetProperty("operation", out var op) && op.ValueKind == JsonValueKind.String ? op.GetString() : null;

    /// <summary>Nombre visible; la personalizada, con el suyo.</summary>
    public static string? Name(JsonElement edge) => Of(edge) switch
    {
        null => null,
        "custom" => Custom(edge) ?? Catalog["custom"].Name.TrimEnd('…'),
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

    private static Dictionary<string, string> Labels(JsonElement labels, bool lower) =>
        labels.EnumerateObject().ToDictionary(
            p => p.Name,
            p => lower ? p.Value.GetString()!.ToLowerInvariant() : p.Value.GetString()!,
            StringComparer.Ordinal);

    private static string? Custom(JsonElement edge) =>
        edge.TryGetProperty("customOperation", out var name) && name.GetString() is { Length: > 0 } text ? text : null;
}
