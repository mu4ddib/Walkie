using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Domain;
using Walkie.Modules.Canvas.Persistence;
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

    public async Task<CanvasRemoval> DeleteUntouchedAsync(Guid featureId, CancellationToken cancellationToken)
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

        if (version is null)
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
