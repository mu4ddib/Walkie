using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Validation;

namespace Walkie.Modules.Apps.Features;

internal static class AppsEndpoints
{
    public static IEndpointRouteBuilder MapAppsEndpoints(this IEndpointRouteBuilder routes)
    {
        var apps = routes.MapGroup("/api/apps").WithTags("Apps");

        apps.MapPost("/", CreateApp).WithName("CreateApp").WithValidation<CreateAppRequest>();
        apps.MapGet("/", ListApps).WithName("ListApps");
        apps.MapGet("/{appId:guid}", GetApp).WithName("GetApp");
        apps.MapPost("/{appId:guid}/features", CreateFeature).WithName("CreateFeature").WithValidation<CreateFeatureRequest>();
        apps.MapGet("/{appId:guid}/features", ListFeatures).WithName("ListFeatures");

        routes.MapGroup("/api/features").WithTags("Apps")
            .MapPut("/{featureId:guid}", UpdateFeature)
            .WithName("UpdateFeature")
            .WithSummary("Renombra la feature y cambia su descripción.")
            .WithValidation<UpdateFeatureRequest>();

        return routes;
    }

    private static async Task<Results<Ok<FeatureResponse>, NotFound>> UpdateFeature(
        Guid featureId, UpdateFeatureRequest request, AppsHandlers handlers, CancellationToken ct) =>
        await handlers.UpdateFeatureAsync(featureId, request, ct).ConfigureAwait(false) is { } feature
            ? TypedResults.Ok(feature)
            : TypedResults.NotFound();

    private static async Task<Created<AppResponse>> CreateApp(
        CreateAppRequest request, ClaimsPrincipal user, AppsHandlers handlers, CancellationToken ct)
    {
        var app = await handlers.CreateAppAsync(request, UserId(user), ct).ConfigureAwait(false);
        return TypedResults.Created($"/api/apps/{app.Id}", app);
    }

    private static async Task<Ok<IReadOnlyList<AppResponse>>> ListApps(AppsHandlers handlers, CancellationToken ct) =>
        TypedResults.Ok(await handlers.ListAppsAsync(ct).ConfigureAwait(false));

    private static async Task<Results<Ok<AppResponse>, NotFound>> GetApp(
        Guid appId, AppsHandlers handlers, CancellationToken ct) =>
        await handlers.GetAppAsync(appId, ct).ConfigureAwait(false) is { } app
            ? TypedResults.Ok(app)
            : TypedResults.NotFound();

    private static async Task<Results<Created<FeatureResponse>, NotFound>> CreateFeature(
        Guid appId, CreateFeatureRequest request, ClaimsPrincipal user, AppsHandlers handlers, CancellationToken ct) =>
        await handlers.CreateFeatureAsync(appId, request, UserId(user), ct).ConfigureAwait(false) is { } feature
            ? TypedResults.Created($"/api/apps/{appId}/features/{feature.Id}", feature)
            : TypedResults.NotFound();

    private static async Task<Results<Ok<IReadOnlyList<FeatureResponse>>, NotFound>> ListFeatures(
        Guid appId, AppsHandlers handlers, CancellationToken ct) =>
        await handlers.ListFeaturesAsync(appId, ct).ConfigureAwait(false) is { } features
            ? TypedResults.Ok(features)
            : TypedResults.NotFound();

    /// <summary>Claim <c>sub</c> (ADR-0003). La política por defecto garantiza que existe.</summary>
    private static string UserId(ClaimsPrincipal user) =>
        user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
}
