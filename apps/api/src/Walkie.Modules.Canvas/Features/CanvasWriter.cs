using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas.Features;

internal sealed class CanvasWriter(CanvasHandlers handlers, GraphValidator validator, CanvasDbContext db) : ICanvasWriter
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

    public async Task DeleteAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken) =>
        await db.Canvases.Where(c => featureIds.Contains(c.FeatureId)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
}
