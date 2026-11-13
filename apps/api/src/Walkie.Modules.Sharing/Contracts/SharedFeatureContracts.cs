using System.Text.Json;
using System.Text.Json.Serialization;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;

namespace Walkie.Modules.Sharing.Contracts;

/// <summary>
/// Coincide con <c>packages/schema/walkie-shared-feature.schema.json</c>: lo que ve quien abre un enlace.
/// <c>Catalog</c> trae solo los elementos que usan los nodos <c>ref</c> del grafo.
/// </summary>
public sealed record SharedFeatureResponse(
    string AppName,
    string FeatureName,
    DateTimeOffset ExpiresAt,
    JsonElement Graph,
    IReadOnlyList<CatalogItemResponse> Catalog,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<ModuleSummary>? Modules = null);

/// <summary>
/// Un módulo que usa la feature de un enlace (spec modulos-compartidos; <c>walkie-shared-module.schema.json</c>): su
/// lienzo y los elementos del catálogo que usa, para verlo de solo lectura.
/// </summary>
public sealed record SharedModuleResponse(
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    JsonElement Graph,
    IReadOnlyList<CatalogItemResponse> Catalog);
