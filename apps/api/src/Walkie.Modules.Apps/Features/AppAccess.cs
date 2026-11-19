using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

/// <summary>Membresías (ADR-0015): una consulta por clave primaria por solicitud.</summary>
internal sealed class AppAccess(AppsDbContext db) : IAppAccess
{
    public async Task<AppRole?> RoleAsync(Guid appId, string userId, CancellationToken cancellationToken) =>
        AppRoles.Parse(await db.Memberships.AsNoTracking()
            .Where(m => m.AppId == appId && m.UserId == userId)
            .Select(m => m.Role)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false));

    public async Task<IReadOnlySet<Guid>> AppsOfAsync(string userId, CancellationToken cancellationToken) =>
        (await db.Memberships.AsNoTracking().Where(m => m.UserId == userId).Select(m => m.AppId)
            .ToListAsync(cancellationToken).ConfigureAwait(false)).ToHashSet();
}
