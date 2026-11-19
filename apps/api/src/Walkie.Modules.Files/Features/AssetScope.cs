using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Persistence;

namespace Walkie.Modules.Files.Features;

/// <summary><c>assetId</c>: la app de una imagen (autorización por app, ADR-0015).</summary>
internal sealed class AssetScope(FilesDbContext db) : IAppScopeResolver
{
    public string RouteKey => "assetId";

    public async Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.Assets.AsNoTracking().Where(a => a.Id == id).Select(a => (Guid?)a.AppId)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
}
