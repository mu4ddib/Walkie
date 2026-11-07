using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Files.Contracts;

namespace Walkie.Modules.Files.Features;

internal static class AssetEndpoints
{
    public static IEndpointRouteBuilder MapAssetEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/api/apps/{appId:guid}/assets", Upload)
            .WithTags("Files")
            .WithName("UploadAsset")
            .WithSummary("Sube una imagen (PNG, JPEG o WebP, hasta 5 MB) a la app; campo multipart file.")
            .DisableAntiforgery() // La API usa tokens bearer, no cookies.
            .ProducesValidationProblem();

        routes.MapGet("/api/assets/{assetId:guid}", Download)
            .WithTags("Files")
            .WithName("GetAsset")
            .WithSummary("Bytes de la imagen. No cambia nunca: se puede guardar en caché.");

        return routes;
    }

    private static async Task<Results<Created<AssetResponse>, NotFound, ValidationProblem>> Upload(
        Guid appId, IFormFile? file, ClaimsPrincipal user, AssetHandlers handlers, CancellationToken ct)
    {
        var userId = user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
        return await handlers.UploadAsync(appId, file, userId, ct).ConfigureAwait(false) switch
        {
            UploadResult.Created created => TypedResults.Created($"/api/assets/{created.Asset.Id}", created.Asset),
            UploadResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors, title: "La imagen no es válida."),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<Results<FileStreamHttpResult, NotFound>> Download(
        Guid assetId, HttpContext http, AssetHandlers handlers, CancellationToken ct)
    {
        if (await handlers.GetAsync(assetId, ct).ConfigureAwait(false) is not { } found)
        {
            return TypedResults.NotFound();
        }

        // Privada: requiere sesión. Inmutable: un asset nunca cambia (reemplazar = subir otro).
        http.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return TypedResults.Stream(found.Content, found.Asset.ContentType);
    }
}
