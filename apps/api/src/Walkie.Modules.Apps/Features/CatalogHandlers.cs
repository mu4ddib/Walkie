using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

/// <summary>Catálogo de una app: lógica separada del mapeo HTTP.</summary>
internal sealed class CatalogHandlers(AppsDbContext db, ICatalogUsage usage, TimeProvider clock)
{
    /// <summary>Elementos ordenados por tipo y título; <c>null</c> si la app no existe.</summary>
    public async Task<IReadOnlyList<CatalogItemResponse>?> ListAsync(Guid appId, CancellationToken ct)
    {
        if (!await db.Apps.AnyAsync(a => a.Id == appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var items = await db.CatalogItems.AsNoTracking()
            .Where(i => i.AppId == appId)
            .OrderBy(i => i.Type).ThenBy(i => i.Title).ThenBy(i => i.Id)
            .ToListAsync(ct).ConfigureAwait(false);
        return items.ConvertAll(ToResponse);
    }

    /// <summary>Crea el elemento con <c>version</c> 1; <c>null</c> si la app no existe.</summary>
    public async Task<CatalogItemResponse?> CreateAsync(
        Guid appId, CreateCatalogItemRequest request, string userId, CancellationToken ct)
    {
        if (!await db.Apps.AnyAsync(a => a.Id == appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var now = clock.GetUtcNowForDb();
        var item = new CatalogItem
        {
            AppId = appId,
            Type = request.Type,
            Title = request.Title.Trim(),
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedBy = userId,
            UpdatedAt = now,
        };
        Apply(item, request.Description, request.Http, request.Database, request.Resource, request.Runtime);
        db.CatalogItems.Add(item);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return ToResponse(item);
    }

    public async Task<CatalogItemResponse?> GetAsync(Guid itemId, CancellationToken ct) =>
        await db.CatalogItems.AsNoTracking().SingleOrDefaultAsync(i => i.Id == itemId, ct).ConfigureAwait(false) is { } item
            ? ToResponse(item)
            : null;

    /// <summary>Guarda si <c>Version</c> coincide con la guardada (concurrencia optimista).</summary>
    public async Task<UpdateResult> UpdateAsync(
        Guid itemId, UpdateCatalogItemRequest request, string userId, CancellationToken ct)
    {
        var item = await db.CatalogItems.SingleOrDefaultAsync(i => i.Id == itemId, ct).ConfigureAwait(false);
        if (item is null)
        {
            return new UpdateResult.NotFound();
        }

        if (!CatalogRules.IsEmpty(request.Http) && item.Type != "api")
        {
            return new UpdateResult.Invalid(new Dictionary<string, string[]> { ["Http"] = [CatalogRules.HttpOnlyOnApi] });
        }

        if (!CatalogRules.IsEmpty(request.Database) && item.Type != "database")
        {
            return new UpdateResult.Invalid(new Dictionary<string, string[]>
            {
                ["Database"] = [CatalogRules.DatabaseOnlyOnDatabase],
            });
        }

        if (OnlyOnErrors(item.Type, request) is { } invalid)
        {
            return new UpdateResult.Invalid(invalid);
        }

        if (request.Version != item.Version)
        {
            return new UpdateResult.Conflict(item.Version);
        }

        item.Title = request.Title.Trim();
        Apply(item, request.Description, request.Http, request.Database, request.Resource, request.Runtime);
        item.Version++;
        item.UpdatedBy = userId;
        item.UpdatedAt = clock.GetUtcNowForDb();

        try
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Otro guardado de la misma versión ganó entre la lectura y la escritura.
            var current = await db.CatalogItems.AsNoTracking()
                .Where(i => i.Id == itemId).Select(i => i.Version).SingleAsync(ct).ConfigureAwait(false);
            return new UpdateResult.Conflict(current);
        }

        return new UpdateResult.Saved(ToResponse(item));
    }

    /// <summary>Features cuyo lienzo usa el elemento, por nombre; <c>null</c> si el elemento no existe.</summary>
    public async Task<IReadOnlyList<FeatureResponse>?> UsagesAsync(Guid itemId, CancellationToken ct)
    {
        if (!await db.CatalogItems.AnyAsync(i => i.Id == itemId, ct).ConfigureAwait(false))
        {
            return null;
        }

        return await FeaturesUsingAsync(itemId, ct).ConfigureAwait(false);
    }

    /// <summary>Borra el elemento si ningún lienzo lo usa (ADR-0002: no dejar <c>ref</c> rotos).</summary>
    public async Task<DeleteResult> DeleteAsync(Guid itemId, CancellationToken ct)
    {
        var item = await db.CatalogItems.SingleOrDefaultAsync(i => i.Id == itemId, ct).ConfigureAwait(false);
        if (item is null)
        {
            return new DeleteResult.NotFound();
        }

        var features = await FeaturesUsingAsync(itemId, ct).ConfigureAwait(false);
        if (features.Count > 0)
        {
            return new DeleteResult.InUse(features);
        }

        db.CatalogItems.Remove(item);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return new DeleteResult.Deleted();
    }

    private async Task<IReadOnlyList<FeatureResponse>> FeaturesUsingAsync(Guid itemId, CancellationToken ct)
    {
        var ids = await usage.FeaturesUsingAsync(itemId, ct).ConfigureAwait(false);
        return await db.Features.AsNoTracking()
            .Where(f => ids.Contains(f.Id))
            .OrderBy(f => f.Name).ThenBy(f => f.Id)
            .Select(f => new FeatureResponse(f.Id, f.AppId, f.Name, f.Description, f.CreatedAt, f.UpdatedAt, f.Kind))
            .ToListAsync(ct).ConfigureAwait(false);
    }

    /// <summary>Recurso y runtime según el tipo guardado (el request de actualización no trae el tipo).</summary>
    private static Dictionary<string, string[]>? OnlyOnErrors(string type, UpdateCatalogItemRequest request)
    {
        if (!CatalogRules.IsEmpty(request.Resource) && type != "resource")
        {
            return new() { ["Resource"] = [CatalogRules.ResourceOnlyOnResource] };
        }

        if (CatalogRules.IsEmpty(request.Resource) && type == "resource")
        {
            return new() { ["Resource"] = [CatalogRules.ResourceRequired] };
        }

        return !string.IsNullOrWhiteSpace(request.Runtime) && type != "service"
            ? new() { ["Runtime"] = [CatalogRules.RuntimeOnlyOnService] }
            : null;
    }

    /// <summary>Textos recortados; vacío = sin valor (así la respuesta no trae campos vacíos). El contrato ya cumple el schema.</summary>
    private static void Apply(
        CatalogItem item, string? description, JsonElement? http, JsonElement? database, JsonElement? resource, string? runtime)
    {
        item.Description = Clean(description);
        item.Http = CatalogRules.IsEmpty(http) ? null : http!.Value.GetRawText();
        item.Database = CatalogRules.IsEmpty(database) ? null : database!.Value.GetRawText();
        item.Resource = CatalogRules.IsEmpty(resource) ? null : resource!.Value.GetRawText();
        item.Runtime = Clean(runtime);
    }

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    internal static CatalogItemResponse ToResponse(CatalogItem item) => new(
        item.Id,
        item.AppId,
        item.Type,
        item.Title,
        item.Description,
        Parse(item.Http),
        item.Version,
        Parse(item.Database),
        Parse(item.Resource),
        item.Runtime);

    private static JsonElement? Parse(string? json)
    {
        if (json is null)
        {
            return null;
        }

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}

internal abstract record DeleteResult
{
    public sealed record Deleted : DeleteResult;
    public sealed record NotFound : DeleteResult;
    public sealed record InUse(IReadOnlyList<FeatureResponse> Features) : DeleteResult;
}

internal abstract record UpdateResult
{
    public sealed record Saved(CatalogItemResponse Item) : UpdateResult;
    public sealed record NotFound : UpdateResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : UpdateResult;
    public sealed record Conflict(int CurrentVersion) : UpdateResult;
}
