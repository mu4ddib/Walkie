using System.Text.Json;
using Walkie.Modules.Apps.Contracts;

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
    IReadOnlyList<CatalogItemResponse> Catalog);
