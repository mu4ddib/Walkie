using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Persistence;
using Walkie.Modules.Files.Contracts;
using Walkie.Shared.Time;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Lienzos, tours, recorridos, posiciones del mapa e imágenes de lienzo al eliminar (ADR-0017). Nunca toca el lienzo de
/// otra feature: si una la apunta con un portal, la eliminación se bloquea (la persona lo resuelve). De una feature borra
/// solo las imágenes que usaba su lienzo y ningún otro de la app, antes del lienzo (así un reintento las recalcula).
/// </summary>
internal sealed class CanvasDeletion(CanvasDbContext db, IFeatureDirectory features, IAssetWriter assets, TimeProvider clock) : IDeletionParticipant
{
    public string Step => "canvas";

    public int Order => 30;

    public async Task DescribeFeatureAsync(FeatureDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken)
    {
        var canvas = await db.Canvases.AsNoTracking().Where(c => c.FeatureId == target.FeatureId)
            .Select(c => new { c.Graph, c.Version }).SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        impact.CanvasVersion = canvas?.Version ?? 0;
        var graph = canvas is null ? null : JsonNode.Parse(canvas.Graph)?.AsObject();
        impact.Add("nodes", Count(graph, "nodes"));
        impact.Add("edges", Count(graph, "edges"));
        var (tours, flows) = Tours(graph);
        impact.Add("tours", tours);
        impact.Add("flows", flows);

        var others = await OtherGraphsAsync(target, cancellationToken).ConfigureAwait(false);
        var portals = others.Where(o => Nodes(o.Graph).Any(n => SameId(n?["targetFeatureId"], target.FeatureId))).ToList();
        if (portals.Count > 0)
        {
            impact.Blockers.Add(new DeletionBlocker("portal",
                portals.Count == 1
                    ? "Otra feature tiene un portal hacia esta: quítalo o cámbialo antes de eliminarla."
                    : $"{portals.Count} features tienen portales hacia esta: quítalos o cámbialos antes de eliminarla.",
                [.. portals.Select(p => new DeletionReference(p.Kind, p.Id, p.Name)).OrderBy(r => r.Name, StringComparer.Ordinal)]));
        }

        var (exclusive, shared) = Images(graph, others);
        impact.Add("images", exclusive.Count);
        impact.Add("imagesShared", shared);
        impact.Add("mapPosition", await HasMapPositionAsync(target, cancellationToken).ConfigureAwait(false) ? 1 : 0);
    }

    public async Task DeleteFeatureAsync(FeatureDeletionTarget target, CancellationToken cancellationToken)
    {
        var graph = await db.Canvases.AsNoTracking().Where(c => c.FeatureId == target.FeatureId).Select(c => c.Graph)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (graph is not null)
        {
            var others = await OtherGraphsAsync(target, cancellationToken).ConfigureAwait(false);
            var (exclusive, _) = Images(JsonNode.Parse(graph)?.AsObject(), others);
            await assets.DeleteAsync(exclusive, cancellationToken).ConfigureAwait(false);
            await db.Canvases.Where(c => c.FeatureId == target.FeatureId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        }

        // Su posición en el mapa de la app (la clave es el id de la feature); el resto del mapa queda igual.
        var map = await db.AppMaps.SingleOrDefaultAsync(m => m.AppId == target.AppId, cancellationToken).ConfigureAwait(false);
        if (map is not null && JsonNode.Parse(map.Positions) is JsonObject positions && positions.Remove(target.FeatureId.ToString()))
        {
            map.Positions = positions.ToJsonString();
            map.Version++;
            map.UpdatedAt = clock.GetUtcNowForDb();
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task DescribeAppAsync(AppDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken)
    {
        var graphs = await db.Canvases.AsNoTracking().Where(c => target.FeatureIds.Contains(c.FeatureId)).Select(c => c.Graph)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        impact.Add("canvases", graphs.Count);
        foreach (var graph in graphs.Select(g => JsonNode.Parse(g)?.AsObject()))
        {
            var (tours, flows) = Tours(graph);
            impact.Add("tours", tours);
            impact.Add("flows", flows);
        }

        impact.Add("map", await db.AppMaps.AnyAsync(m => m.AppId == target.AppId, cancellationToken).ConfigureAwait(false) ? 1 : 0);
    }

    public async Task DeleteAppAsync(AppDeletionTarget target, CancellationToken cancellationToken)
    {
        await db.Canvases.Where(c => target.FeatureIds.Contains(c.FeatureId)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        await db.AppMaps.Where(m => m.AppId == target.AppId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Los lienzos de las demás features y módulos de la app que siguen vivos (los marcados no cuentan).</summary>
    private async Task<List<(Guid Id, string Kind, string Name, JsonObject? Graph)>> OtherGraphsAsync(FeatureDeletionTarget target, CancellationToken ct)
    {
        var owners = (await features.FeaturesOfAppAsync(target.AppId, ct).ConfigureAwait(false)).Select(f => (f.Id, Kind: "feature", f.Name))
            .Concat((await features.ModulesOfAppAsync(target.AppId, ct).ConfigureAwait(false)).Select(m => (m.Id, Kind: "module", m.Name)))
            .Where(o => o.Id != target.FeatureId)
            .ToDictionary(o => o.Id);
        var ids = owners.Keys.ToList();
        var graphs = await db.Canvases.AsNoTracking().Where(c => ids.Contains(c.FeatureId)).Select(c => new { c.FeatureId, c.Graph })
            .ToListAsync(ct).ConfigureAwait(false);
        return [.. graphs.Select(g => (g.FeatureId, owners[g.FeatureId].Kind, owners[g.FeatureId].Name, JsonNode.Parse(g.Graph)?.AsObject()))];
    }

    private async Task<bool> HasMapPositionAsync(FeatureDeletionTarget target, CancellationToken ct)
    {
        var positions = await db.AppMaps.AsNoTracking().Where(m => m.AppId == target.AppId).Select(m => m.Positions)
            .SingleOrDefaultAsync(ct).ConfigureAwait(false);
        return positions is not null && JsonNode.Parse(positions) is JsonObject map && map.ContainsKey(target.FeatureId.ToString());
    }

    /// <summary>Imágenes del lienzo que ningún otro de la app usa (se borran) y cuántas comparte (se conservan).</summary>
    private static (List<Guid> Exclusive, int Shared) Images(JsonObject? graph, IEnumerable<(Guid Id, string Kind, string Name, JsonObject? Graph)> others)
    {
        var own = AssetIds(graph);
        var elsewhere = others.SelectMany(o => AssetIds(o.Graph)).ToHashSet();
        return ([.. own.Where(a => !elsewhere.Contains(a))], own.Count(elsewhere.Contains));
    }

    private static HashSet<Guid> AssetIds(JsonObject? graph) =>
        [.. Nodes(graph).Select(n => n?["assetId"]?.GetValueKind() == JsonValueKind.String && Guid.TryParse(n["assetId"]!.GetValue<string>(), out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)];

    private static IEnumerable<JsonNode?> Nodes(JsonObject? graph) =>
        graph?["nodes"] is JsonObject nodes ? nodes.Select(n => n.Value) : [];

    private static int Count(JsonObject? graph, string property) => graph?[property] is JsonObject items ? items.Count : 0;

    /// <summary>Tours (pasos de nodo) y recorridos (pasos de conexión): <c>kind</c>, o si falta, si algún paso tiene <c>edgeId</c>.</summary>
    private static (int Tours, int Flows) Tours(JsonObject? graph)
    {
        if (graph?["tours"] is not JsonObject tours)
        {
            return (0, 0);
        }

        var flows = tours.Count(t => t.Value?["kind"]?.GetValue<string>() == "flow"
            || (t.Value?["kind"] is null && t.Value?["steps"] is JsonArray steps && steps.Any(s => s?["edgeId"] is not null)));
        return (tours.Count - flows, flows);
    }

    private static bool SameId(JsonNode? value, Guid id) =>
        value?.GetValueKind() == JsonValueKind.String && Guid.TryParse(value.GetValue<string>(), out var parsed) && parsed == id;
}
