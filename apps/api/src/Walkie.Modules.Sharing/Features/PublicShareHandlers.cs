using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Modules.Sharing.Domain;
using Walkie.Modules.Sharing.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Sharing.Features;

/// <summary>
/// Lo que se ve con un enlace, sin sesión (spec enlace-solo-lectura, criterios 9 a 11; ADR-0005).
/// Un enlace revocado, caducado o inexistente da <c>null</c> en todos los casos: el endpoint responde 404 igual.
/// </summary>
internal sealed partial class PublicShareHandlers(
    SharingDbContext db,
    IFeatureDirectory features,
    ICatalogDirectory catalog,
    ICanvasReader canvas,
    IAssetDirectory assets,
    IModuleDirectory modules,
    TimeProvider clock)
{
    /// <summary>La feature compartida; registra el acceso.</summary>
    public async Task<SharedFeatureResponse?> GetAsync(string token, CancellationToken ct)
    {
        if (await FindActiveAsync(token, ct).ConfigureAwait(false) is not { } share
            || await features.DescribeAsync(share.FeatureId, ct).ConfigureAwait(false) is not { } feature)
        {
            return null;
        }

        var graph = await canvas.GraphOfFeatureAsync(feature.Id, ct).ConfigureAwait(false);
        var refs = NodeIds(graph, "ref", "catalogId");
        var items = refs.Count == 0
            ? []
            : await catalog.ItemsOfAppAsync(feature.AppId, refs, ct).ConfigureAwait(false);
        // Los módulos que usa (a cualquier profundidad), sin decir qué otras features los usan.
        var reachable = await modules.ReachableAsync(feature.AppId, graph, ct).ConfigureAwait(false);

        share.LastAccessedAt = clock.GetUtcNowForDb();
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return new SharedFeatureResponse(
            feature.AppName,
            feature.Name,
            share.ExpiresAt,
            graph,
            items,
            reachable.Count == 0 ? null : [.. reachable.Select(m => m.Summary with { UsedBy = [] })]);
    }

    /// <summary>Un módulo que la feature del enlace usa (directa o indirectamente); <c>null</c> si no.</summary>
    public async Task<SharedModuleResponse?> GetModuleAsync(string token, Guid moduleId, CancellationToken ct)
    {
        if (await FindActiveAsync(token, ct).ConfigureAwait(false) is not { } share
            || await features.AppOfFeatureAsync(share.FeatureId, ct).ConfigureAwait(false) is not { } appId)
        {
            return null;
        }

        var graph = await canvas.GraphOfFeatureAsync(share.FeatureId, ct).ConfigureAwait(false);
        var module = (await modules.ReachableAsync(appId, graph, ct).ConfigureAwait(false)).FirstOrDefault(m => m.Summary.Id == moduleId);
        if (module is null)
        {
            return null;
        }

        var refs = NodeIds(module.Graph, "ref", "catalogId");
        var items = refs.Count == 0 ? [] : await catalog.ItemsOfAppAsync(appId, refs, ct).ConfigureAwait(false);
        return new SharedModuleResponse(module.Summary.Name, module.Summary.Description, module.Graph, items);
    }

    /// <summary>Los bytes de una imagen solo si una pantalla del grafo actual (o de un módulo que usa) la usa.</summary>
    public async Task<AssetContent?> OpenAssetAsync(string token, Guid assetId, CancellationToken ct)
    {
        if (await FindActiveAsync(token, ct).ConfigureAwait(false) is not { } share
            || await features.AppOfFeatureAsync(share.FeatureId, ct).ConfigureAwait(false) is not { } appId)
        {
            return null;
        }

        var graph = await canvas.GraphOfFeatureAsync(share.FeatureId, ct).ConfigureAwait(false);
        var used = NodeIds(graph, "screen", "assetId").Contains(assetId)
            || (await modules.ReachableAsync(appId, graph, ct).ConfigureAwait(false))
                .Any(m => NodeIds(m.Graph, "screen", "assetId").Contains(assetId));
        return used ? await assets.OpenInAppAsync(appId, assetId, ct).ConfigureAwait(false) : null;
    }

    private async Task<Share?> FindActiveAsync(string token, CancellationToken ct)
    {
        if (!TokenFormat().IsMatch(token))
        {
            return null;
        }

        var hash = ShareTokens.Hash(token);
        var share = await db.Shares.SingleOrDefaultAsync(s => s.TokenHash == hash, ct).ConfigureAwait(false);
        return share is not null && share.IsActiveAt(clock.GetUtcNow()) ? share : null;
    }

    /// <summary>Ids en <paramref name="property"/> de los nodos de tipo <paramref name="type"/>.</summary>
    private static HashSet<Guid> NodeIds(JsonElement graph, string type, string property) =>
        graph.GetProperty("nodes").EnumerateObject()
            .Select(n => n.Value)
            .Where(n => n.GetProperty("type").GetString() == type && n.TryGetProperty(property, out _))
            .Select(n => Guid.TryParse(n.GetProperty(property).GetString(), out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToHashSet();

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")]
    private static partial Regex TokenFormat();
}
