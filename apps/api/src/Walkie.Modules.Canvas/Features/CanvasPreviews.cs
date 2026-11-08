using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas.Features;

/// <summary>Vistas previas de los lienzos guardados de una app (galería de features).</summary>
internal sealed class CanvasPreviews(CanvasDbContext db, IAppDirectory apps, IFeatureDirectory features, ICatalogDirectory catalog)
{
    /// <summary>Una vista previa por feature con lienzo guardado; <c>null</c> si la app no existe.</summary>
    public async Task<IReadOnlyList<CanvasPreview>?> OfAppAsync(Guid appId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var featureIds = await features.FeatureIdsOfAppAsync(appId, ct).ConfigureAwait(false);
        var canvases = await db.Canvases.AsNoTracking()
            .Where(c => featureIds.Contains(c.FeatureId))
            .Select(c => new { c.FeatureId, c.UpdatedAt, c.Graph })
            .ToListAsync(ct).ConfigureAwait(false);

        var graphs = canvases.Select(c => (c.FeatureId, c.UpdatedAt, Graph: CanvasHandlers.Parse(c.Graph))).ToList();
        var refTypes = await RefTypesAsync(appId, graphs.Select(g => g.Graph), ct).ConfigureAwait(false);

        return graphs
            .Select(g => new CanvasPreview(g.FeatureId, g.UpdatedAt, Nodes(g.Graph, refTypes), Edges(g.Graph)))
            .ToList();
    }

    /// <summary>Tipo (api, service, database) de cada elemento del catálogo usado por un <c>ref</c>.</summary>
    private async Task<IReadOnlyDictionary<Guid, string>> RefTypesAsync(
        Guid appId, IEnumerable<JsonElement> graphs, CancellationToken ct)
    {
        var ids = graphs
            .SelectMany(g => g.GetProperty("nodes").EnumerateObject())
            .Where(n => n.Value.TryGetProperty("catalogId", out _))
            .Select(n => Guid.TryParse(n.Value.GetProperty("catalogId").GetString(), out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToHashSet();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        var items = await catalog.ItemsOfAppAsync(appId, ids, ct).ConfigureAwait(false);
        return items.ToDictionary(i => i.Id, i => i.Type);
    }

    private static List<PreviewNode> Nodes(JsonElement graph, IReadOnlyDictionary<Guid, string> refTypes)
    {
        var layout = graph.GetProperty("layout");
        var nodes = new List<PreviewNode>();
        foreach (var node in graph.GetProperty("nodes").EnumerateObject())
        {
            if (!layout.TryGetProperty(node.Name, out var position))
            {
                continue;
            }

            nodes.Add(new PreviewNode(
                node.Name,
                TypeOf(node.Value, refTypes),
                position.GetProperty("x").GetDouble(),
                position.GetProperty("y").GetDouble(),
                position.TryGetProperty("w", out var w) ? w.GetDouble() : null,
                position.TryGetProperty("h", out var h) ? h.GetDouble() : null));
        }

        return nodes;
    }

    private static string TypeOf(JsonElement node, IReadOnlyDictionary<Guid, string> refTypes)
    {
        var type = node.GetProperty("type").GetString() ?? "";
        return type == "ref"
            && node.TryGetProperty("catalogId", out var catalogId)
            && Guid.TryParse(catalogId.GetString(), out var id)
            && refTypes.TryGetValue(id, out var refType)
                ? refType
                : type;
    }

    private static List<PreviewEdge> Edges(JsonElement graph) =>
        graph.GetProperty("edges").EnumerateObject()
            .Select(e => new PreviewEdge(e.Value.GetProperty("from").GetString()!, e.Value.GetProperty("to").GetString()!))
            .ToList();
}
