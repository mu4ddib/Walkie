using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Modules.Sharing.Domain;
using Walkie.Modules.Sharing.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Sharing.Features;

/// <summary>Crear, listar y revocar enlaces de una feature (spec enlace-solo-lectura, criterios 1 a 4 y 12).</summary>
internal sealed class ShareHandlers(SharingDbContext db, IFeatureDirectory features, TimeProvider clock)
{
    /// <summary>El enlace con su token (la única vez que viaja); <c>null</c> si la feature no existe.</summary>
    public async Task<ShareResponse?> CreateAsync(
        Guid featureId, CreateShareRequest request, string userId, string userName, CancellationToken ct)
    {
        if (!await features.FeatureExistsAsync(featureId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var token = ShareTokens.New();
        var now = clock.GetUtcNowForDb();
        var share = new Share
        {
            FeatureId = featureId,
            TokenHash = ShareTokens.Hash(token),
            CreatedBy = userId,
            CreatedByName = userName,
            CreatedAt = now,
            ExpiresAt = now.AddDays(request.ExpiresInDays),
        };
        db.Shares.Add(share);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return ToResponse(share, token);
    }

    /// <summary>Enlaces activos (sin revocar ni caducados), del más nuevo al más viejo; <c>null</c> si la feature no existe.</summary>
    public async Task<IReadOnlyList<ShareResponse>?> ListActiveAsync(Guid featureId, CancellationToken ct)
    {
        if (!await features.FeatureExistsAsync(featureId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var now = clock.GetUtcNow();
        var shares = await db.Shares.AsNoTracking()
            .Where(s => s.FeatureId == featureId && s.RevokedAt == null && s.ExpiresAt > now)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(ct)
            .ConfigureAwait(false);
        return [.. shares.Select(s => ToResponse(s, token: null))];
    }

    /// <summary>Revoca el enlace (idempotente); <c>false</c> si no existe.</summary>
    public async Task<bool> RevokeAsync(Guid shareId, CancellationToken ct)
    {
        if (await db.Shares.FindAsync([shareId], ct).ConfigureAwait(false) is not { } share)
        {
            return false;
        }

        share.RevokedAt ??= clock.GetUtcNowForDb();
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return true;
    }

    private static ShareResponse ToResponse(Share share, string? token) =>
        new(share.Id, share.FeatureId, share.CreatedByName, share.CreatedAt, share.ExpiresAt, share.LastAccessedAt, token);
}
