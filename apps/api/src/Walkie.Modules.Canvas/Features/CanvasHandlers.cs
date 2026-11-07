using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Domain;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Canvas.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Canvas.Features;

/// <summary>Lógica de carga y guardado del lienzo, separada del mapeo HTTP.</summary>
internal sealed class CanvasHandlers(
    CanvasDbContext db,
    IFeatureDirectory features,
    ICatalogDirectory catalog,
    IAssetDirectory assetDirectory,
    GraphValidator validator,
    TimeProvider clock)
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
            errors = await ReferenceErrorsAsync(featureId, graph, ct).ConfigureAwait(false);
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

    /// <summary>
    /// Referencias a otros módulos, todas de la app de la feature (400 si no): <c>catalogId</c> de un <c>ref</c>,
    /// <c>assetId</c> de una pantalla y <c>targetFeatureId</c> de un <c>portal</c>.
    /// </summary>
    private async Task<Dictionary<string, string[]>> ReferenceErrorsAsync(Guid featureId, JsonElement graph, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var refs = References(graph, "catalogId");
        var assets = References(graph, "assetId");
        var portals = References(graph, "targetFeatureId");
        if (refs.Count + assets.Count + portals.Count == 0)
        {
            return errors;
        }

        var appId = await features.AppOfFeatureAsync(featureId, ct).ConfigureAwait(false) ?? Guid.Empty;

        if (refs.Count > 0)
        {
            var items = await catalog.CatalogItemIdsForFeatureAsync(featureId, ct).ConfigureAwait(false);
            Check(refs, "catalogId", items, "El elemento del catálogo no existe en esta app.", errors);
        }

        if (assets.Count > 0)
        {
            var ids = assets.Select(a => a.Id).OfType<Guid>().ToList();
            var existing = await assetDirectory.ExistingInAppAsync(appId, ids, ct).ConfigureAwait(false);
            Check(assets, "assetId", existing, "La imagen no existe en esta app.", errors);
        }

        if (portals.Count > 0)
        {
            var appFeatures = await features.FeatureIdsOfAppAsync(appId, ct).ConfigureAwait(false);
            Check(portals, "targetFeatureId", appFeatures, "La feature destino no existe en esta app.", errors);
        }

        return errors;
    }

    /// <summary>Nodos que tienen la propiedad, con su valor como id (o <c>null</c> si no es un id).</summary>
    private static List<(string Node, Guid? Id)> References(JsonElement graph, string property) =>
        graph.GetProperty("nodes").EnumerateObject()
            .Where(n => n.Value.TryGetProperty(property, out _))
            .Select(n => (n.Name, Guid.TryParse(n.Value.GetProperty(property).GetString(), out var id) ? id : (Guid?)null))
            .ToList();

    private static void Check(
        List<(string Node, Guid? Id)> references, string property, IReadOnlySet<Guid> valid, string message,
        Dictionary<string, string[]> errors)
    {
        foreach (var (node, id) in references.Where(r => r.Id is not { } id || !valid.Contains(id)))
        {
            errors[$"/nodes/{node}/{property}"] = [message];
        }
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
