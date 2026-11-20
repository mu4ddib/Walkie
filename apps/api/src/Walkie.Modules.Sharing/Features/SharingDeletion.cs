using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Sharing.Persistence;

namespace Walkie.Modules.Sharing.Features;

/// <summary>
/// Enlaces públicos al eliminar una feature o una app (ADR-0017): primero en la fase 2. Desde la fase 1 ya no se sirven
/// (la vista pública pasa por <see cref="IFeatureDirectory.DescribeAsync"/>, que no ve lo marcado); aquí se borran.
/// </summary>
internal sealed class SharingDeletion(SharingDbContext db, TimeProvider clock) : IDeletionParticipant
{
    public string Step => "sharing";

    public int Order => 10;

    public async Task DescribeFeatureAsync(FeatureDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken) =>
        impact.Add("shares", await ActiveCountAsync([target.FeatureId], cancellationToken).ConfigureAwait(false));

    public Task DeleteFeatureAsync(FeatureDeletionTarget target, CancellationToken cancellationToken) =>
        db.Shares.Where(s => s.FeatureId == target.FeatureId).ExecuteDeleteAsync(cancellationToken);

    public async Task DescribeAppAsync(AppDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken) =>
        impact.Add("shares", await ActiveCountAsync(target.FeatureIds, cancellationToken).ConfigureAwait(false));

    public Task DeleteAppAsync(AppDeletionTarget target, CancellationToken cancellationToken) =>
        db.Shares.Where(s => target.FeatureIds.Contains(s.FeatureId)).ExecuteDeleteAsync(cancellationToken);

    /// <summary>Los que hoy funcionan (sin revocar ni vencer): los que dejarían de funcionar.</summary>
    private Task<int> ActiveCountAsync(IReadOnlyList<Guid> featureIds, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return db.Shares.CountAsync(s => featureIds.Contains(s.FeatureId) && s.RevokedAt == null && s.ExpiresAt > now, ct);
    }
}
