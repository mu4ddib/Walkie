using System.Text.Json.Serialization;

namespace Walkie.Modules.Apps.Contracts;

/// <summary>Método y ruta de un elemento <c>api</c>.</summary>
public sealed record HttpContract(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Method,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Path);

public sealed record CreateCatalogItemRequest(string Type, string Title, string? Description, HttpContract? Http);

/// <summary>Cambia título, descripción y <c>http</c> si <c>Version</c> coincide con la guardada. El tipo no cambia.</summary>
public sealed record UpdateCatalogItemRequest(string Title, string? Description, HttpContract? Http, int Version);

/// <summary>Coincide con <c>packages/schema/walkie-catalog-item.schema.json</c> (los campos vacíos no se envían).</summary>
public sealed record CatalogItemResponse(
    Guid Id,
    Guid AppId,
    string Type,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] HttpContract? Http,
    int Version);
