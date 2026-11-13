using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Sharing.Contracts;

namespace Walkie.Modules.Sharing.Features;

/// <summary>Endpoints sin sesión de un enlace (ADR-0005): la única excepción a ADR-0003 aparte de health.</summary>
internal static class PublicShareEndpoints
{
    public static IEndpointRouteBuilder MapPublicShareEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/public/shares").WithTags("Sharing").AllowAnonymous();

        group.MapGet("/{token}", Get)
            .WithName("GetSharedFeature")
            .WithSummary("La feature de un enlace activo: grafo, catálogo usado y nombres. 404 si está revocado, caducado o no existe.");
        group.MapGet("/{token}/modules/{moduleId:guid}", GetModule)
            .WithName("GetSharedModule")
            .WithSummary("Un módulo que usa la feature del enlace (directa o indirectamente): su lienzo y el catálogo que usa; 404 si no.");
        group.MapGet("/{token}/assets/{assetId:guid}", GetAsset)
            .WithName("GetSharedAsset")
            .WithSummary("Bytes de una imagen que usa una pantalla del lienzo compartido; 404 si no.");

        return routes;
    }

    private static async Task<Results<Ok<SharedFeatureResponse>, NotFound>> Get(
        string token, HttpContext http, PublicShareHandlers handlers, CancellationToken ct)
    {
        // El enlace puede revocarse en cualquier momento: nada de cachés intermedias.
        http.Response.Headers.CacheControl = "no-store";
        return await handlers.GetAsync(token, ct).ConfigureAwait(false) is { } shared
            ? TypedResults.Ok(shared)
            : TypedResults.NotFound();
    }

    private static async Task<Results<Ok<SharedModuleResponse>, NotFound>> GetModule(
        string token, Guid moduleId, HttpContext http, PublicShareHandlers handlers, CancellationToken ct)
    {
        http.Response.Headers.CacheControl = "no-store";
        return await handlers.GetModuleAsync(token, moduleId, ct).ConfigureAwait(false) is { } module
            ? TypedResults.Ok(module)
            : TypedResults.NotFound();
    }

    private static async Task<Results<FileStreamHttpResult, NotFound>> GetAsset(
        string token, Guid assetId, HttpContext http, PublicShareHandlers handlers, CancellationToken ct)
    {
        http.Response.Headers.CacheControl = "no-store";
        return await handlers.OpenAssetAsync(token, assetId, ct).ConfigureAwait(false) is { } asset
            ? TypedResults.Stream(asset.Content, asset.ContentType)
            : TypedResults.NotFound();
    }
}
