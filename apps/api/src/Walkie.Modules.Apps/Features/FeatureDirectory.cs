using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

internal sealed class FeatureDirectory(AppsDbContext db) : IFeatureDirectory
{
    public Task<bool> FeatureExistsAsync(Guid featureId, CancellationToken cancellationToken) =>
        db.Features.AnyAsync(f => f.Id == featureId, cancellationToken);

    public async Task<Guid?> AppOfFeatureAsync(Guid featureId, CancellationToken cancellationToken) =>
        await db.Features.Where(f => f.Id == featureId).Select(f => (Guid?)f.AppId)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);

    public async Task<IReadOnlySet<Guid>> FeatureIdsOfAppAsync(Guid appId, CancellationToken cancellationToken) =>
        (await db.Features.Where(f => f.AppId == appId).Select(f => f.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false)).ToHashSet();

    public async Task<IReadOnlyDictionary<Guid, string>> FeatureNamesOfAppAsync(Guid appId, CancellationToken cancellationToken) =>
        await db.Features.Where(f => f.AppId == appId)
            .ToDictionaryAsync(f => f.Id, f => f.Name, cancellationToken).ConfigureAwait(false);

    public async Task<FeatureSummary?> DescribeAsync(Guid featureId, CancellationToken cancellationToken) =>
        await db.Features.Where(f => f.Id == featureId)
            .Join(db.Apps, f => f.AppId, a => a.Id, (f, a) => new FeatureSummary(f.Id, a.Id, a.Name, f.Name))
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
}
