using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

internal sealed class AppDirectory(AppsDbContext db) : IAppDirectory
{
    public Task<bool> AppExistsAsync(Guid appId, CancellationToken cancellationToken) =>
        db.Apps.AnyAsync(a => a.Id == appId, cancellationToken);
}
