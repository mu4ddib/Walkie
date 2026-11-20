using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Domain;
using Walkie.Modules.Canvas.Persistence;
using Walkie.Shared;
using Walkie.Shared.Schemas;
using Walkie.Shared.Time;

namespace Walkie.Modules.Canvas.Features;

internal sealed class CanvasWriter(CanvasHandlers handlers, GraphValidator validator, CanvasDbContext db, TimeProvider clock) : ICanvasWriter
{
    public IReadOnlyDictionary<string, string[]> Validate(JsonElement graph) => validator.Validate(graph);

    public async Task<IReadOnlyDictionary<string, string[]>> CreateAsync(
        Guid featureId, JsonElement graph, string userId, CancellationToken cancellationToken) =>
        await handlers.SaveAsync(featureId, graph, userId, cancellationToken).ConfigureAwait(false) switch
        {
            SaveResult.Saved => new Dictionary<string, string[]>(),
            SaveResult.Invalid invalid => invalid.Errors,
            SaveResult.Conflict => new Dictionary<string, string[]> { ["/version"] = ["La feature ya tiene un lienzo."] },
            _ => new Dictionary<string, string[]> { ["/"] = ["La feature no existe."] },
        };

    public async Task<(InitialCanvas Outcome, IReadOnlyDictionary<string, string[]> Errors)> CreateInitialAsync(
        Guid featureId, JsonElement graph, string userId, CancellationToken cancellationToken)
    {
        if (await db.Canvases.AsNoTracking().AnyAsync(c => c.FeatureId == featureId, cancellationToken).ConfigureAwait(false))
        {
            return (InitialCanvas.AlreadyExists, new Dictionary<string, string[]>());
        }

        try
        {
            return await handlers.SaveAsync(featureId, graph, userId, cancellationToken).ConfigureAwait(false) switch
            {
                SaveResult.Saved => (InitialCanvas.Created, new Dictionary<string, string[]>()),
                SaveResult.Invalid invalid => (InitialCanvas.Invalid, invalid.Errors),
                // Otro pedido lo guardó entre la lectura y el guardado: es el mismo caso que ya existiera.
                SaveResult.Conflict => (InitialCanvas.AlreadyExists, new Dictionary<string, string[]>()),
                _ => (InitialCanvas.Invalid, new Dictionary<string, string[]> { ["/"] = ["La feature no existe."] }),
            };
        }
        catch (DbUpdateException)
        {
            // Dos guardados del primer lienzo a la vez: la clave primaria frena el segundo, que no pisa nada.
            db.ChangeTracker.Clear();
            return (InitialCanvas.AlreadyExists, new Dictionary<string, string[]>());
        }
    }

    public async Task<CanvasRemoval> DeleteUntouchedAsync(Guid featureId, CancellationToken cancellationToken, bool checkOnly = false)
    {
        var version = await db.Canvases.AsNoTracking().Where(c => c.FeatureId == featureId).Select(c => (int?)c.Version)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (version > 1)
        {
            return CanvasRemoval.Edited;
        }

        var id = featureId.ToString();
        var users = await db.Database
            .SqlQuery<Guid>($"""
                SELECT c.feature_id AS "Value"
                FROM canvas.canvases c
                WHERE c.feature_id <> {featureId} AND EXISTS (
                    SELECT 1 FROM jsonb_each(c.graph -> 'nodes') n
                    WHERE lower(n.value ->> 'moduleId') = {id} OR lower(n.value ->> 'targetFeatureId') = {id})
                """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        if (users.Count > 0)
        {
            return CanvasRemoval.InUse;
        }

        if (version is null || checkOnly)
        {
            return CanvasRemoval.Deleted;
        }

        // La versión va en la condición: si alguien lo guardó entre la lectura y el borrado, no se borra.
        var deleted = await db.Canvases.Where(c => c.FeatureId == featureId && c.Version == 1)
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        return deleted == 1 ? CanvasRemoval.Deleted : CanvasRemoval.Edited;
    }

    public IReadOnlyDictionary<string, string[]> ValidateMapPositions(JsonElement positions, string prefix)
    {
        // El $defs/layout de walkie-app-map pide también la versión: se valida el par con versión 0.
        using var layout = JsonDocument.Parse("{\"version\":0,\"positions\":" + positions.GetRawText() + "}");
        return WalkieSchemas.Errors(WalkieSchemas.MapLayout, layout.RootElement)
            .ToDictionary(e => prefix + e.Key.Replace("/positions", "", StringComparison.Ordinal), e => e.Value);
    }

    public async Task<CanvasAppend> AppendAsync(Guid featureId, int expectedVersion, JsonElement additions, string userId, CancellationToken cancellationToken)
    {
        var canvas = await db.Canvases.AsNoTracking().Where(c => c.FeatureId == featureId).Select(c => new { c.Graph, c.Version })
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        var current = canvas is null ? EmptyGraph() : JsonNode.Parse(canvas.Graph)!.AsObject();
        var version = canvas?.Version ?? 0;
        var nodes = Section(current, "nodes");
        var edges = Section(current, "edges");
        var layout = Section(current, "layout");
        var addNodes = additions.GetProperty("nodes").EnumerateObject().ToList();
        var addEdges = additions.GetProperty("edges").EnumerateObject().ToList();

        // Un reintento: todo lo de este agregado ya está en el lienzo.
        if (addNodes.All(n => nodes.ContainsKey(n.Name)) && addEdges.All(e => edges.ContainsKey(e.Name)))
        {
            return new CanvasAppend(CanvasAppendOutcome.AlreadyApplied, version, new Dictionary<string, string[]>());
        }

        if (version != expectedVersion)
        {
            return new CanvasAppend(CanvasAppendOutcome.VersionChanged, version, new Dictionary<string, string[]>());
        }

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        foreach (var node in addNodes.Where(n => nodes.ContainsKey(n.Name) || layout.ContainsKey(n.Name)))
        {
            errors[$"/nodes/{node.Name}"] = ["Ese id ya está en el lienzo: no se pisa nada."];
        }

        foreach (var edge in addEdges.Where(e => edges.ContainsKey(e.Name)))
        {
            errors[$"/edges/{edge.Name}"] = ["Ese id ya está en el lienzo: no se pisa nada."];
        }

        if (errors.Count > 0)
        {
            return new CanvasAppend(CanvasAppendOutcome.Invalid, version, errors);
        }

        foreach (var node in addNodes)
        {
            nodes[node.Name] = JsonNode.Parse(node.Value.GetRawText());
        }

        foreach (var edge in addEdges)
        {
            edges[edge.Name] = JsonNode.Parse(edge.Value.GetRawText());
        }

        foreach (var position in additions.GetProperty("layout").EnumerateObject())
        {
            layout[position.Name] = JsonNode.Parse(position.Value.GetRawText());
        }

        current["version"] = version;
        return await handlers.SaveAsync(featureId, JsonSerializer.SerializeToElement(current), userId, cancellationToken).ConfigureAwait(false) switch
        {
            SaveResult.Saved => new CanvasAppend(CanvasAppendOutcome.Appended, version + 1, new Dictionary<string, string[]>()),
            SaveResult.Invalid invalid => new CanvasAppend(CanvasAppendOutcome.Invalid, version, invalid.Errors),
            SaveResult.Conflict conflict => new CanvasAppend(CanvasAppendOutcome.VersionChanged, conflict.CurrentVersion, new Dictionary<string, string[]>()),
            _ => new CanvasAppend(CanvasAppendOutcome.Invalid, version, new Dictionary<string, string[]> { ["/"] = ["La feature no existe."] }),
        };
    }

    public async Task<CanvasRemoval> DetachUntouchedAsync(
        Guid featureId, int appendedVersion, IReadOnlyCollection<string> nodeIds, IReadOnlyCollection<string> edgeIds, CancellationToken cancellationToken)
    {
        var canvas = await db.Canvases.AsNoTracking().Where(c => c.FeatureId == featureId).Select(c => new { c.Graph, c.Version })
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (canvas is null)
        {
            return CanvasRemoval.Deleted;
        }

        var current = JsonNode.Parse(canvas.Graph)!.AsObject();
        var nodes = Section(current, "nodes");
        var edges = Section(current, "edges");
        if (!nodeIds.Any(nodes.ContainsKey) && !edgeIds.Any(edges.ContainsKey))
        {
            return CanvasRemoval.Deleted; // nunca se agregó: nada que quitar
        }

        if (canvas.Version != appendedVersion)
        {
            return CanvasRemoval.Edited;
        }

        var layout = Section(current, "layout");
        foreach (var id in nodeIds)
        {
            nodes.Remove(id);
            layout.Remove(id);
        }

        foreach (var id in edgeIds)
        {
            edges.Remove(id);
        }

        current["version"] = canvas.Version;
        return await handlers.SaveAsync(featureId, JsonSerializer.SerializeToElement(current), "walkie-live", cancellationToken).ConfigureAwait(false) switch
        {
            SaveResult.Saved => CanvasRemoval.Deleted,
            _ => CanvasRemoval.Edited,
        };
    }

    private static JsonObject Section(JsonObject graph, string name)
    {
        if (graph[name] is not JsonObject section)
        {
            section = [];
            graph[name] = section;
        }

        return section;
    }

    private static JsonObject EmptyGraph() => new()
    {
        ["schemaVersion"] = WalkieInfo.SchemaVersion,
        ["version"] = 0,
        ["nodes"] = new JsonObject(),
        ["edges"] = new JsonObject(),
        ["layout"] = new JsonObject(),
    };

    public async Task CreateMapAsync(Guid appId, JsonElement positions, string userId, CancellationToken cancellationToken)
    {
        db.AppMaps.Add(new AppMapLayout
        {
            AppId = appId,
            Positions = positions.GetRawText(),
            Version = 1,
            UpdatedAt = clock.GetUtcNowForDb(),
            UpdatedBy = userId,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task DeleteMapAsync(Guid appId, CancellationToken cancellationToken) =>
        await db.AppMaps.Where(m => m.AppId == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);

    public async Task DeleteAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken) =>
        await db.Canvases.Where(c => featureIds.Contains(c.FeatureId)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
}
