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
