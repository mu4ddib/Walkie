using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Validation;

namespace Walkie.Modules.Apps.Features;

internal static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder routes)
    {
        var byApp = routes.MapGroup("/api/apps/{appId:guid}/catalog").WithTags("Catalog");
        byApp.MapGet("/", ListCatalog).WithName("ListCatalog");
        byApp.MapPost("/", CreateCatalogItem).WithName("CreateCatalogItem").WithValidation<CreateCatalogItemRequest>();

        var items = routes.MapGroup("/api/catalog").WithTags("Catalog");
        items.MapGet("/{itemId:guid}", GetCatalogItem).WithName("GetCatalogItem");
        items.MapPut("/{itemId:guid}", UpdateCatalogItem)
            .WithName("UpdateCatalogItem")
            .WithSummary("Guarda el elemento si su version coincide con la guardada; responde el elemento con version + 1.")
            .WithValidation<UpdateCatalogItemRequest>()
            .ProducesProblem(StatusCodes.Status409Conflict);
        items.MapDelete("/{itemId:guid}", DeleteCatalogItem)
            .WithName("DeleteCatalogItem")
            .WithSummary("Borra el elemento; 409 con las features que lo usan si algún lienzo tiene un ref a él.")
            .ProducesProblem(StatusCodes.Status409Conflict);
        items.MapGet("/{itemId:guid}/usages", ListCatalogItemUsages)
            .WithName("ListCatalogItemUsages")
            .WithSummary("Features cuyo lienzo tiene un nodo ref al elemento.");

        return routes;
    }

    private static async Task<Results<Ok<IReadOnlyList<CatalogItemResponse>>, NotFound>> ListCatalog(
        Guid appId, CatalogHandlers handlers, CancellationToken ct) =>
        await handlers.ListAsync(appId, ct).ConfigureAwait(false) is { } items
            ? TypedResults.Ok(items)
            : TypedResults.NotFound();

    private static async Task<Results<Created<CatalogItemResponse>, NotFound>> CreateCatalogItem(
        Guid appId, CreateCatalogItemRequest request, ClaimsPrincipal user, CatalogHandlers handlers, CancellationToken ct) =>
        await handlers.CreateAsync(appId, request, UserId(user), ct).ConfigureAwait(false) is { } item
            ? TypedResults.Created($"/api/catalog/{item.Id}", item)
            : TypedResults.NotFound();

    private static async Task<Results<Ok<CatalogItemResponse>, NotFound>> GetCatalogItem(
        Guid itemId, CatalogHandlers handlers, CancellationToken ct) =>
        await handlers.GetAsync(itemId, ct).ConfigureAwait(false) is { } item
            ? TypedResults.Ok(item)
            : TypedResults.NotFound();

    private static async Task<Results<Ok<CatalogItemResponse>, NotFound, ValidationProblem, ProblemHttpResult>> UpdateCatalogItem(
        Guid itemId, UpdateCatalogItemRequest request, ClaimsPrincipal user, CatalogHandlers handlers, CancellationToken ct) =>
        await handlers.UpdateAsync(itemId, request, UserId(user), ct).ConfigureAwait(false) switch
        {
            UpdateResult.Saved saved => TypedResults.Ok(saved.Item),
            UpdateResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            UpdateResult.Conflict conflict => TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "El elemento cambió desde que lo cargaste.",
                detail: "Recarga la versión del servidor antes de guardar.",
                extensions: new Dictionary<string, object?> { ["currentVersion"] = conflict.CurrentVersion }),
            _ => TypedResults.NotFound(),
        };

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteCatalogItem(
        Guid itemId, CatalogHandlers handlers, CancellationToken ct) =>
        await handlers.DeleteAsync(itemId, ct).ConfigureAwait(false) switch
        {
            DeleteResult.Deleted => TypedResults.NoContent(),
            DeleteResult.InUse inUse => TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "El elemento se usa en otros lienzos.",
                detail: "Quita sus nodos ref de esas features antes de borrarlo.",
                extensions: new Dictionary<string, object?> { ["features"] = inUse.Features }),
            _ => TypedResults.NotFound(),
        };

    private static async Task<Results<Ok<IReadOnlyList<FeatureResponse>>, NotFound>> ListCatalogItemUsages(
        Guid itemId, CatalogHandlers handlers, CancellationToken ct) =>
        await handlers.UsagesAsync(itemId, ct).ConfigureAwait(false) is { } features
            ? TypedResults.Ok(features)
            : TypedResults.NotFound();

    /// <summary>Claim <c>sub</c> (ADR-0003). La política por defecto garantiza que existe.</summary>
    private static string UserId(ClaimsPrincipal user) =>
        user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
}
