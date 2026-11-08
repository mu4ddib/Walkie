using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas.Features;

internal sealed class CanvasReader(CanvasDbContext db) : ICanvasReader
{
    public async Task<JsonElement> GraphOfFeatureAsync(Guid featureId, CancellationToken cancellationToken)
    {
        var graph = await db.Canvases.AsNoTracking()
            .Where(c => c.FeatureId == featureId)
            .Select(c => c.Graph)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        return CanvasHandlers.Parse(graph ?? CanvasHandlers.EmptyGraph);
    }
}
