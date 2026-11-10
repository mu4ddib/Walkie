using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Domain;
using Walkie.Modules.Canvas.Persistence;
using Walkie.Shared.Schemas;
using Walkie.Shared.Time;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Mapa de una app (spec mapa-de-la-app): con el último lienzo guardado de cada feature arma su resumen, las conexiones
/// por portal (con las cajas desde las que se llega), los portales sin destino y el uso del catálogo; y guarda la
/// distribución que se acomoda a mano.
/// </summary>
internal sealed class AppMaps(CanvasDbContext db, IAppDirectory apps, IFeatureDirectory features, ICatalogDirectory catalog, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>El mapa; <c>null</c> si la app no existe.</summary>
    public async Task<AppMap?> OfAppAsync(Guid appId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var featureIds = await features.FeatureIdsOfAppAsync(appId, ct).ConfigureAwait(false);
        var canvases = await db.Canvases.AsNoTracking()
            .Where(c => featureIds.Contains(c.FeatureId))
            .Select(c => new { c.FeatureId, c.Graph })
            .ToListAsync(ct).ConfigureAwait(false);
        var graphs = canvases.ToDictionary(c => c.FeatureId, c => CanvasHandlers.Parse(c.Graph));

        // Elementos del catálogo usados en los lienzos de la app (para sus títulos y tipos).
        var catalogIds = graphs.Values
            .SelectMany(g => g.GetProperty("nodes").EnumerateObject())
            .Select(n => CatalogIdOf(n.Value))
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .ToHashSet();
        var items = catalogIds.Count == 0
            ? new Dictionary<Guid, CatalogItemResponse>()
            : (await catalog.ItemsOfAppAsync(appId, catalogIds, ct).ConfigureAwait(false)).ToDictionary(i => i.Id);

        var summaries = new List<MapFeature>();
        var links = new Dictionary<(Guid From, Guid To), List<MapPortal>>();
        var uses = new Dictionary<Guid, SortedSet<Guid>>();
        foreach (var featureId in featureIds.OrderBy(id => id))
        {
            if (!graphs.TryGetValue(featureId, out var graph))
            {
                summaries.Add(new MapFeature(featureId, 0, 0, 0, 0, 0));
                continue;
            }

            var nodes = graph.GetProperty("nodes");
            int screens = 0, apis = 0, unresolved = 0;
            foreach (var node in nodes.EnumerateObject())
            {
                var type = node.Value.GetProperty("type").GetString();
                var item = CatalogIdOf(node.Value) is { } catalogId && items.TryGetValue(catalogId, out var found) ? found : null;
                if (item is not null)
                {
                    (uses.TryGetValue(item.Id, out var set) ? set : uses[item.Id] = []).Add(featureId);
                }

                if (type == "screen")
                {
                    screens++;
                }
                else if (type == "api" || item?.Type == "api")
                {
                    apis++;
                }
                else if (type == "portal")
                {
                    var target = node.Value.TryGetProperty("targetFeatureId", out var t) && Guid.TryParse(t.GetString(), out var id)
                        ? id
                        : Guid.Empty;
                    if (target == Guid.Empty || !featureIds.Contains(target))
                    {
                        unresolved++;
                    }
                    else if (target != featureId)
                    {
                        var key = (featureId, target);
                        (links.TryGetValue(key, out var list) ? list : links[key] = [])
                            .Add(new MapPortal(node.Name, SourcesOf(graph, node.Name, items)));
                    }
                }
            }

            var (tours, flows) = TourCounts(graph);
            summaries.Add(new MapFeature(featureId, screens, apis, tours, flows, unresolved));
        }

        var layout = await db.AppMaps.AsNoTracking().SingleOrDefaultAsync(m => m.AppId == appId, ct).ConfigureAwait(false);
        return new AppMap(
            appId,
            summaries,
            [.. links.OrderBy(l => l.Key.From).ThenBy(l => l.Key.To)
                .Select(l => new MapLink(l.Key.From, l.Key.To, [.. l.Value.OrderBy(p => p.NodeId, StringComparer.Ordinal)]))],
            [.. uses.OrderBy(u => u.Key)
                .Select(u => new MapCatalogUse(u.Key, items[u.Key].Type, items[u.Key].Title, [.. u.Value]))],
            LayoutOf(layout));
    }

    /// <summary>Guarda la distribución si su versión coincide con la guardada.</summary>
    public async Task<LayoutResult> SaveLayoutAsync(Guid appId, JsonElement body, string userId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return new LayoutResult.NotFound();
        }

        var errors = WalkieSchemas.Errors(WalkieSchemas.MapLayout, body);
        if (errors.Count > 0)
        {
            return new LayoutResult.Invalid(errors);
        }

        var version = body.GetProperty("version").GetInt32();
        var positions = body.GetProperty("positions").GetRawText();
        var current = await db.AppMaps.SingleOrDefaultAsync(m => m.AppId == appId, ct).ConfigureAwait(false);
        if (version != (current?.Version ?? 0))
        {
            return new LayoutResult.Conflict(current?.Version ?? 0);
        }

        var now = clock.GetUtcNowForDb();
        if (current is null)
        {
            current = new AppMapLayout { AppId = appId, Positions = positions, Version = 1, UpdatedAt = now, UpdatedBy = userId };
            db.AppMaps.Add(current);
        }
        else
        {
            current.Positions = positions;
            current.Version = version + 1;
            current.UpdatedAt = now;
            current.UpdatedBy = userId;
        }

        try
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            return new LayoutResult.Conflict(await CurrentVersionAsync(appId, ct).ConfigureAwait(false));
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return new LayoutResult.Conflict(await CurrentVersionAsync(appId, ct).ConfigureAwait(false));
        }

        return new LayoutResult.Saved(LayoutOf(current));
    }

    private async Task<int> CurrentVersionAsync(Guid appId, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var layout = await db.AppMaps.AsNoTracking().SingleOrDefaultAsync(m => m.AppId == appId, ct).ConfigureAwait(false);
        return layout?.Version ?? 0;
    }

    private static MapLayout LayoutOf(AppMapLayout? layout) =>
        layout is null
            ? new MapLayout(0, new Dictionary<string, MapPosition>())
            : new MapLayout(
                layout.Version,
                JsonSerializer.Deserialize<Dictionary<string, MapPosition>>(layout.Positions, Json) ?? []);

    private static Guid? CatalogIdOf(JsonElement node) =>
        node.TryGetProperty("catalogId", out var id) && Guid.TryParse(id.GetString(), out var guid) ? guid : null;

    /// <summary>Títulos de las cajas con una conexión que llega al portal (un <c>ref</c>, con el de su elemento).</summary>
    private static List<string> SourcesOf(JsonElement graph, string portalId, Dictionary<Guid, CatalogItemResponse> items)
    {
        var nodes = graph.GetProperty("nodes");
        return [.. graph.GetProperty("edges").EnumerateObject()
            .Where(e => e.Value.GetProperty("to").GetString() == portalId)
            .Select(e => e.Value.GetProperty("from").GetString()!)
            .Distinct(StringComparer.Ordinal)
            .Where(id => nodes.TryGetProperty(id, out _))
            .Select(id =>
            {
                var node = nodes.GetProperty(id);
                return CatalogIdOf(node) is { } catalogId && items.TryGetValue(catalogId, out var item)
                    ? item.Title
                    : node.GetProperty("title").GetString()!;
            })
            .Order(StringComparer.Ordinal)];
    }

    /// <summary>Tours guiados y recorridos (spec tours-y-recorridos: <c>kind</c>, o deducido de los pasos).</summary>
    private static (int Tours, int Flows) TourCounts(JsonElement graph)
    {
        if (!graph.TryGetProperty("tours", out var tours))
        {
            return (0, 0);
        }

        int guides = 0, flows = 0;
        foreach (var tour in tours.EnumerateObject())
        {
            var flow = tour.Value.TryGetProperty("kind", out var kind)
                ? kind.GetString() == "flow"
                : tour.Value.GetProperty("steps").EnumerateArray()
                    .Any(s => s.TryGetProperty("edgeId", out _) || s.TryGetProperty("removedEdge", out _));
            if (flow)
            {
                flows++;
            }
            else
            {
                guides++;
            }
        }

        return (guides, flows);
    }
}

/// <summary>Resultado de guardar la distribución del mapa.</summary>
internal abstract record LayoutResult
{
    public sealed record Saved(MapLayout Layout) : LayoutResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : LayoutResult;

    public sealed record Conflict(int CurrentVersion) : LayoutResult;

    public sealed record NotFound : LayoutResult;
}
