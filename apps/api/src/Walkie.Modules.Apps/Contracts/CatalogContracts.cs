using System.Text.Json;
using System.Text.Json.Serialization;

namespace Walkie.Modules.Apps.Contracts;

/// <summary>
/// <c>Http</c> (solo <c>api</c>), <c>Database</c> (solo <c>database</c>), <c>Resource</c> (solo y siempre en
/// <c>resource</c>) y <c>Runtime</c> (solo <c>service</c>) son la definición compartida: la misma estructura que
/// <c>$defs/http</c>, <c>$defs/database</c>, <c>$defs/resource</c> y <c>$defs/runtime</c> de
/// <c>packages/schema/walkie-graph.schema.json</c>.
/// </summary>
public sealed record CreateCatalogItemRequest(
    string Type,
    string Title,
    string? Description,
    JsonElement? Http,
    JsonElement? Database = null,
    JsonElement? Resource = null,
    string? Runtime = null);

/// <summary>Cambia título, descripción y contrato si <c>Version</c> coincide con la guardada. El tipo no cambia.</summary>
public sealed record UpdateCatalogItemRequest(
    string Title,
    string? Description,
    JsonElement? Http,
    int Version,
    JsonElement? Database = null,
    JsonElement? Resource = null,
    string? Runtime = null);

/// <summary>Coincide con <c>packages/schema/walkie-catalog-item.schema.json</c> (los campos vacíos no se envían).</summary>
public sealed record CatalogItemResponse(
    Guid Id,
    Guid AppId,
    string Type,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Http,
    int Version,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Database = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Resource = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Runtime = null)
{
    /// <summary>Método del contrato (<c>http.method</c>), si hay.</summary>
    [JsonIgnore]
    public string? HttpMethod => Text(Http, "method");

    /// <summary>Ruta del contrato (<c>http.path</c>), si hay.</summary>
    [JsonIgnore]
    public string? HttpPath => Text(Http, "path");

    private static string? Text(JsonElement? obj, string name) =>
        obj is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}
