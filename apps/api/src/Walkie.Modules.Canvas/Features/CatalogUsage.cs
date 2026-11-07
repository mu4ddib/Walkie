using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas.Features;

/// <summary>Busca en los grafos (<c>jsonb</c>) los nodos <c>ref</c> que apuntan a un elemento del catálogo.</summary>
internal sealed class CatalogUsage(CanvasDbContext db) : ICatalogUsage
{
    public async Task<IReadOnlyList<Guid>> FeaturesUsingAsync(Guid itemId, CancellationToken cancellationToken)
    {
        var catalogId = itemId.ToString();
        return await db.Database
            .SqlQuery<Guid>($"""
                SELECT c.feature_id AS "Value"
                FROM canvas.canvases c
                WHERE EXISTS (
                    SELECT 1 FROM jsonb_each(c.graph -> 'nodes') n
                    WHERE n.value ->> 'type' = 'ref' AND lower(n.value ->> 'catalogId') = {catalogId})
                """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }
}
