using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

internal sealed class AppWriter(
    AppsDbContext db, TimeProvider clock, IValidator<CreateCatalogItemRequest> itemValidator, ICatalogUsage usage) : IAppWriter
{
    public async Task<Guid> CreateAppAsync(string name, string userId, CancellationToken cancellationToken)
    {
        var app = new App { Name = name.Trim(), CreatedBy = userId, CreatedAt = clock.GetUtcNowForDb() };
        db.Apps.Add(app);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return app.Id;
    }

    public async Task<IReadOnlyList<string>> AppNamesAsync(CancellationToken cancellationToken) =>
        await db.Apps.AsNoTracking().Select(a => a.Name).ToListAsync(cancellationToken).ConfigureAwait(false);

    public async Task DeleteAppAsync(Guid appId, CancellationToken cancellationToken)
    {
        await db.CatalogItems.Where(i => i.AppId == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        await db.Features.Where(f => f.AppId == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        await db.Apps.Where(a => a.Id == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<Guid> CreateFeatureAsync(
        Guid appId, string name, string? description, string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNowForDb();
        var feature = new Feature
        {
            AppId = appId,
            Name = name.Trim(),
            Description = description?.Trim() ?? "",
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Features.Add(feature);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return feature.Id;
    }

    public async Task<bool> CreateModuleAsync(
        Guid appId, Guid moduleId, string name, string? description, string userId, CancellationToken cancellationToken)
    {
        if (await db.Features.AnyAsync(f => f.Id == moduleId, cancellationToken).ConfigureAwait(false))
        {
            return false;
        }

        var now = clock.GetUtcNowForDb();
        db.Features.Add(new Feature
        {
            Id = moduleId,
            AppId = appId,
            Kind = FeatureKind.Module,
            Name = name.Trim(),
            Description = description?.Trim() ?? "",
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // Dos pedidos con el mismo id a la vez: el segundo pierde.
            db.ChangeTracker.Clear();
            return false;
        }

        return true;
    }

    public async Task<Guid> CreateCatalogItemAsync(
        Guid appId, CatalogItemResponse source, string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNowForDb();
        var item = new CatalogItem
        {
            AppId = appId,
            Type = source.Type,
            Title = source.Title.Trim(),
            Description = string.IsNullOrWhiteSpace(source.Description) ? null : source.Description.Trim(),
            Http = source.Http?.GetRawText(),
            Database = source.Database?.GetRawText(),
            Resource = source.Resource?.GetRawText(),
            Runtime = source.Runtime,
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedBy = userId,
            UpdatedAt = now,
        };
        db.CatalogItems.Add(item);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return item.Id;
    }

    public IReadOnlyDictionary<string, string[]> ValidateCatalogItem(CreateCatalogItemRequest item) =>
        itemValidator.Validate(item).Errors
            .GroupBy(e => e.PropertyName, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray(), StringComparer.Ordinal);

    public CatalogItemResponse PreviewCatalogItem(Guid appId, Guid itemId, CreateCatalogItemRequest item) =>
        CatalogHandlers.ToResponse(NewItem(appId, itemId, item, "", default));

    public async Task<CatalogItemCreation> CreateCatalogItemAsync(
        Guid appId, Guid itemId, CreateCatalogItemRequest item, string userId, CancellationToken cancellationToken)
    {
        if (await ExistingAsync(appId, itemId, item.Type, cancellationToken).ConfigureAwait(false) is { } existing)
        {
            return existing;
        }

        db.CatalogItems.Add(NewItem(appId, itemId, item, userId, clock.GetUtcNowForDb()));
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Dos pedidos con el mismo id a la vez: el segundo ve lo que guardó el primero.
            db.ChangeTracker.Clear();
            return await ExistingAsync(appId, itemId, item.Type, cancellationToken).ConfigureAwait(false) ?? CatalogItemCreation.IdTaken;
        }

        return CatalogItemCreation.Created;
    }

    public async Task<CatalogItemRemoval> DeleteUntouchedCatalogItemAsync(Guid appId, Guid itemId, CancellationToken cancellationToken)
    {
        var item = await db.CatalogItems.AsNoTracking()
            .Where(i => i.Id == itemId && i.AppId == appId)
            .Select(i => new { i.Version })
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (item is null)
        {
            return CatalogItemRemoval.NotFound;
        }

        if (item.Version > 1)
        {
            return CatalogItemRemoval.Edited;
        }

        if ((await usage.FeaturesUsingAsync(itemId, cancellationToken).ConfigureAwait(false)).Count > 0)
        {
            return CatalogItemRemoval.InUse;
        }

        // La versión va en la condición: si alguien lo editó entre la lectura y el borrado, no se borra.
        var deleted = await db.CatalogItems
            .Where(i => i.Id == itemId && i.AppId == appId && i.Version == 1)
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        if (deleted == 1)
        {
            return CatalogItemRemoval.Deleted;
        }

        return await db.CatalogItems.AnyAsync(i => i.Id == itemId, cancellationToken).ConfigureAwait(false)
            ? CatalogItemRemoval.Edited
            : CatalogItemRemoval.NotFound;
    }

    /// <summary>El elemento con la misma limpieza que el endpoint (textos recortados, vacío = sin valor), sin guardar.</summary>
    private static CatalogItem NewItem(Guid appId, Guid itemId, CreateCatalogItemRequest item, string userId, DateTimeOffset now)
    {
        var created = new CatalogItem
        {
            Id = itemId,
            AppId = appId,
            Type = item.Type,
            Title = item.Title.Trim(),
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedBy = userId,
            UpdatedAt = now,
        };
        CatalogHandlers.Apply(created, item.Description, item.Http, item.Database, item.Resource, item.Runtime);
        return created;
    }

    /// <summary>Si el id ya existe: un reintento (misma app y tipo) o un id tomado. Null si está libre.</summary>
    private async Task<CatalogItemCreation?> ExistingAsync(Guid appId, Guid itemId, string type, CancellationToken cancellationToken)
    {
        var existing = await db.CatalogItems.AsNoTracking()
            .Where(i => i.Id == itemId)
            .Select(i => new { i.AppId, i.Type })
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return null;
        }

        return existing.AppId == appId && existing.Type == type ? CatalogItemCreation.AlreadyCreated : CatalogItemCreation.IdTaken;
    }

    public async Task DeleteFeaturesAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken) =>
        await db.Features.Where(f => featureIds.Contains(f.Id)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);

    public async Task DeleteCatalogItemsAsync(IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken) =>
        await db.CatalogItems.Where(i => itemIds.Contains(i.Id)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
}
