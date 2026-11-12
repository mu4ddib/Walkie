using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

internal sealed class AppDirectory(AppsDbContext db) : IAppDirectory
{
    public Task<bool> AppExistsAsync(Guid appId, CancellationToken cancellationToken) =>
        db.Apps.AnyAsync(a => a.Id == appId, cancellationToken);

    public async Task<string?> AppNameAsync(Guid appId, CancellationToken cancellationToken) =>
        await db.Apps.Where(a => a.Id == appId).Select(a => a.Name)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
}
