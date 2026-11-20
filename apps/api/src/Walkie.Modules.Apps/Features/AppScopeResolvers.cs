using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

/// <summary><c>appId</c>: la app misma, si existe.</summary>
internal sealed class AppIdScope(AppsDbContext db) : IAppScopeResolver
{
    public string RouteKey => "appId";

    public async Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.Apps.AsNoTracking().AnyAsync(a => a.Id == id && a.DeletingAt == null, cancellationToken).ConfigureAwait(false) ? id : null;
}

/// <summary><c>featureId</c>: la app de la feature (también de un módulo, que es una feature de tipo <c>module</c>).</summary>
internal sealed class FeatureScope(IFeatureDirectory features) : IAppScopeResolver
{
    public string RouteKey => "featureId";

    public Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) => features.AppOfFeatureAsync(id, cancellationToken);
}

/// <summary><c>moduleId</c>: la app del módulo.</summary>
internal sealed class ModuleScope(IFeatureDirectory features) : IAppScopeResolver
{
    public string RouteKey => "moduleId";

    public Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) => features.AppOfFeatureAsync(id, cancellationToken);
}

/// <summary><c>itemId</c>: la app de un elemento del catálogo.</summary>
internal sealed class CatalogItemScope(AppsDbContext db) : IAppScopeResolver
{
    public string RouteKey => "itemId";

    public async Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.CatalogItems.AsNoTracking().Where(i => i.Id == id).Select(i => (Guid?)i.AppId)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
}
