using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Shared.Validation;

namespace Walkie.Modules.Sharing.Features;

internal static class ShareEndpoints
{
    public static IEndpointRouteBuilder MapShareEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api").WithTags("Sharing");

        group.MapPost("/features/{featureId:guid}/shares", Create)
            .WithName("CreateShare")
            .WithSummary("Crea un enlace de solo lectura (7, 30 o 90 días). El token solo viaja en esta respuesta.")
            .WithValidation<CreateShareRequest>();
        group.MapGet("/features/{featureId:guid}/shares", List)
            .WithName("ListShares")
            .WithSummary("Enlaces activos de la feature (sin revocar ni caducados), sin token.");
        group.MapDelete("/shares/{shareId:guid}", Revoke)
            .WithName("RevokeShare")
            .WithSummary("Revoca el enlace: deja de funcionar en el acto.");

        return routes;
    }

    private static async Task<Results<Created<ShareResponse>, NotFound>> Create(
        Guid featureId, CreateShareRequest request, ClaimsPrincipal user, ShareHandlers handlers, CancellationToken ct)
    {
        var userId = user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
        var userName = user.FindFirstValue("name") ?? user.FindFirstValue("preferred_username") ?? userId;
        return await handlers.CreateAsync(featureId, request, userId, userName, ct).ConfigureAwait(false) is { } share
            ? TypedResults.Created($"/api/shares/{share.Id}", share)
            : TypedResults.NotFound();
    }

    private static async Task<Results<Ok<IReadOnlyList<ShareResponse>>, NotFound>> List(
        Guid featureId, ShareHandlers handlers, CancellationToken ct) =>
        await handlers.ListActiveAsync(featureId, ct).ConfigureAwait(false) is { } shares
            ? TypedResults.Ok(shares)
            : TypedResults.NotFound();

    private static async Task<Results<NoContent, NotFound>> Revoke(Guid shareId, ShareHandlers handlers, CancellationToken ct) =>
        await handlers.RevokeAsync(shareId, ct).ConfigureAwait(false) ? TypedResults.NoContent() : TypedResults.NotFound();
}
