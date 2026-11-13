using System.Text.Json;
using System.Text.Json.Serialization;

namespace Walkie.Modules.Canvas.Contracts;

/// <summary>
/// Resumen de un módulo compartido (<c>packages/schema/walkie-module-summary.schema.json</c>, spec modulos-compartidos):
/// lo que una feature necesita para dibujar su caja y resolver sus interfaces sin cargar su lienzo.
/// </summary>
public sealed record ModuleSummary(
    Guid Id,
    Guid AppId,
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    int Version,
    int Nodes,
    IReadOnlyList<ModuleInterfaceSummary> Interfaces,
    IReadOnlyList<Guid> Modules,
    IReadOnlyList<Guid> UsedBy,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<InterfaceRedirect>? Redirects = null);

/// <summary>Interfaz quitada y adónde pasan sus conexiones (<c>To</c>; sin él, al módulo completo).</summary>
public sealed record InterfaceRedirect(
    string From,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? To);

/// <summary>Una interfaz con lo que se sabe de su caja interna (tipo efectivo, título y contrato).</summary>
public sealed record ModuleInterfaceSummary(
    string Id,
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    string Kind,
    string NodeId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? NodeType,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? NodeTitle,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Method,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Path,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TourId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TourName);

/// <summary>Crear un módulo vacío. <c>Id</c> lo puede generar el cliente (UUID v7): reintentar no duplica.</summary>
public sealed record CreateModuleRequest(string Name, string? Description = null, Guid? Id = null);

/// <summary>Dónde se usa un módulo: cada lienzo (feature o módulo) con sus cajas y las conexiones a sus interfaces.</summary>
public sealed record ModuleUsage(Guid FeatureId, string Name, string Kind, IReadOnlyList<string> Nodes, IReadOnlyList<ModuleEdgeUsage> Edges);

/// <param name="End"><c>from</c> o <c>to</c>: qué extremo de la conexión es la caja del módulo.</param>
/// <param name="InterfaceId">Interfaz a la que apunta; <c>null</c> si va al módulo completo.</param>
public sealed record ModuleEdgeUsage(
    string EdgeId,
    string NodeId,
    string End,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? InterfaceId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? InterfaceName);

/// <summary>
/// Convertir una selección en módulo (spec modulos-compartidos, criterios 5 a 10): el lienzo del módulo nuevo
/// (<c>version</c> 0) y el de la feature ya reescrito (con la versión que tiene guardada).
/// </summary>
public sealed record ExtractModuleRequest(
    Guid ModuleId, string Name, string? Description, JsonElement Module, Guid FeatureId, JsonElement Feature);

/// <summary>El módulo creado y el lienzo de la feature tal como quedó guardado.</summary>
public sealed record ExtractModuleResponse(ModuleSummary Module, JsonElement Feature);
