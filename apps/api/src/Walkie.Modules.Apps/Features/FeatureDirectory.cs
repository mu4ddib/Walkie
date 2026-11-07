using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

internal sealed class FeatureDirectory(AppsDbContext db) : IFeatureDirectory
{
    public Task<bool> FeatureExistsAsync(Guid featureId, CancellationToken cancellationToken) =>
        db.Features.AnyAsync(f => f.Id == featureId, cancellationToken);
}
