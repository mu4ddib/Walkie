using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

/// <summary>Lógica de apps y features, separada del mapeo HTTP.</summary>
internal sealed class AppsHandlers(AppsDbContext db, TimeProvider clock)
{
    public async Task<AppResponse> CreateAppAsync(CreateAppRequest request, string userId, CancellationToken ct)
    {
        var app = new App { Name = request.Name.Trim(), CreatedBy = userId, CreatedAt = clock.GetUtcNowForDb() };
        db.Apps.Add(app);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return ToResponse(app);
    }

    public async Task<IReadOnlyList<AppResponse>> ListAppsAsync(CancellationToken ct) =>
        await db.Apps.AsNoTracking()
            .OrderBy(a => a.Name).ThenBy(a => a.Id)
            .Select(a => new AppResponse(a.Id, a.Name, a.CreatedAt, a.Features.Count(f => f.Kind == FeatureKind.Feature)))
            .ToListAsync(ct).ConfigureAwait(false);

    public async Task<AppResponse?> GetAppAsync(Guid appId, CancellationToken ct) =>
        await db.Apps.AsNoTracking()
            .Where(a => a.Id == appId)
            .Select(a => new AppResponse(a.Id, a.Name, a.CreatedAt, a.Features.Count(f => f.Kind == FeatureKind.Feature)))
            .SingleOrDefaultAsync(ct).ConfigureAwait(false);

    /// <summary>Crea la feature; <c>null</c> si la app no existe.</summary>
    public async Task<FeatureResponse?> CreateFeatureAsync(
        Guid appId, CreateFeatureRequest request, string userId, CancellationToken ct)
    {
        if (!await AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var now = clock.GetUtcNowForDb();
        var feature = new Feature
        {
            AppId = appId,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? "",
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Features.Add(feature);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return ToResponse(feature);
    }

    /// <summary>Renombra la feature y cambia su descripción; <c>null</c> si no existe.</summary>
    public async Task<FeatureResponse?> UpdateFeatureAsync(Guid featureId, UpdateFeatureRequest request, CancellationToken ct)
    {
        var feature = await db.Features.SingleOrDefaultAsync(f => f.Id == featureId, ct).ConfigureAwait(false);
        if (feature is null)
        {
            return null;
        }

        feature.Name = request.Name.Trim();
        feature.Description = request.Description?.Trim() ?? "";
        feature.UpdatedAt = clock.GetUtcNowForDb();
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return ToResponse(feature);
    }

    /// <summary>Features de la app; <c>null</c> si la app no existe.</summary>
    public async Task<IReadOnlyList<FeatureResponse>?> ListFeaturesAsync(Guid appId, CancellationToken ct)
    {
        if (!await AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        return await db.Features.AsNoTracking()
            // Los módulos compartidos (ADR-0010) no son features de la galería: tienen su propio listado.
            .Where(f => f.AppId == appId && f.Kind == FeatureKind.Feature)
            .OrderBy(f => f.Name).ThenBy(f => f.Id)
            .Select(f => new FeatureResponse(f.Id, f.AppId, f.Name, f.Description, f.CreatedAt, f.UpdatedAt))
            .ToListAsync(ct).ConfigureAwait(false);
    }

    private Task<bool> AppExistsAsync(Guid appId, CancellationToken ct) =>
        db.Apps.AnyAsync(a => a.Id == appId, ct);

    private static AppResponse ToResponse(App app) =>
        new(app.Id, app.Name, app.CreatedAt, app.Features.Count(f => f.Kind == FeatureKind.Feature));

    private static FeatureResponse ToResponse(Feature f) => new(f.Id, f.AppId, f.Name, f.Description, f.CreatedAt, f.UpdatedAt, f.Kind);
}
