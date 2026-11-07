using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Domain;
using Walkie.Modules.Canvas.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Canvas.Features;

/// <summary>Lógica de carga y guardado del lienzo, separada del mapeo HTTP.</summary>
internal sealed class CanvasHandlers(
    CanvasDbContext db, IFeatureDirectory features, ICatalogDirectory catalog, GraphValidator validator, TimeProvider clock)
{
    /// <summary>Lienzo de una feature que aún no se ha guardado.</summary>
    internal const string EmptyGraph = """{"schemaVersion":0,"version":0,"nodes":{},"edges":{},"layout":{}}""";

    /// <summary>El grafo guardado (o vacío con versión 0); <c>null</c> si la feature no existe.</summary>
    public async Task<JsonElement?> GetAsync(Guid featureId, CancellationToken ct)
    {
        if (!await features.FeatureExistsAsync(featureId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var graph = await db.Canvases.AsNoTracking()
            .Where(c => c.FeatureId == featureId)
            .Select(c => c.Graph)
            .SingleOrDefaultAsync(ct).ConfigureAwait(false);

        return Parse(graph ?? EmptyGraph);
    }

    /// <summary>
    /// Guarda el grafo si su <c>version</c> coincide con la guardada (concurrencia optimista).
    /// El grafo guardado y devuelto lleva <c>version</c> + 1.
    /// </summary>
    public async Task<SaveResult> SaveAsync(Guid featureId, JsonElement graph, string userId, CancellationToken ct)
    {
        if (!await features.FeatureExistsAsync(featureId, ct).ConfigureAwait(false))
        {
            return new SaveResult.NotFound();
        }

        var errors = validator.Validate(graph);
        if (errors.Count == 0)
        {
            errors = await RefErrorsAsync(featureId, graph, ct).ConfigureAwait(false);
        }

        if (errors.Count > 0)
        {
            return new SaveResult.Invalid(errors);
        }

        var canvas = await db.Canvases.SingleOrDefaultAsync(c => c.FeatureId == featureId, ct).ConfigureAwait(false);
        var currentVersion = canvas?.Version ?? 0;
        if (graph.GetProperty("version").GetInt32() != currentVersion)
        {
            return new SaveResult.Conflict(currentVersion);
        }

        var newVersion = currentVersion + 1;
        var node = JsonNode.Parse(graph.GetRawText())!;
        node["version"] = newVersion;
        var json = node.ToJsonString();
        var now = clock.GetUtcNowForDb();

        if (canvas is null)
        {
            db.Canvases.Add(new CanvasDocument
            {
                FeatureId = featureId, Graph = json, Version = newVersion, UpdatedAt = now, UpdatedBy = userId,
            });
        }
        else
        {
            canvas.Graph = json;
            canvas.Version = newVersion;
            canvas.UpdatedAt = now;
            canvas.UpdatedBy = userId;
        }

        try
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Otro guardado ganó entre la lectura y la escritura.
            return new SaveResult.Conflict(await CurrentVersionAsync(featureId, ct).ConfigureAwait(false));
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Dos primeros guardados simultáneos de la misma feature.
            return new SaveResult.Conflict(await CurrentVersionAsync(featureId, ct).ConfigureAwait(false));
        }

        return new SaveResult.Saved(Parse(json));
    }

    /// <summary>Cada <c>ref</c> apunta a un elemento del catálogo de la app de la feature (400 si no).</summary>
    private async Task<Dictionary<string, string[]>> RefErrorsAsync(Guid featureId, JsonElement graph, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var refs = graph.GetProperty("nodes").EnumerateObject()
            .Where(n => n.Value.GetProperty("type").GetString() == "ref")
            .ToList();
        if (refs.Count == 0)
        {
            return errors;
        }

        var items = await catalog.CatalogItemIdsForFeatureAsync(featureId, ct).ConfigureAwait(false);
        foreach (var node in refs)
        {
            var catalogId = node.Value.GetProperty("catalogId").GetString();
            if (!Guid.TryParse(catalogId, out var id) || !items.Contains(id))
            {
                errors[$"/nodes/{node.Name}/catalogId"] = ["El elemento del catálogo no existe en esta app."];
            }
        }

        return errors;
    }

    private Task<int> CurrentVersionAsync(Guid featureId, CancellationToken ct) =>
        db.Canvases.AsNoTracking().Where(c => c.FeatureId == featureId).Select(c => c.Version).SingleAsync(ct);

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}

internal abstract record SaveResult
{
    public sealed record Saved(JsonElement Graph) : SaveResult;
    public sealed record NotFound : SaveResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : SaveResult;
    public sealed record Conflict(int CurrentVersion) : SaveResult;
}
