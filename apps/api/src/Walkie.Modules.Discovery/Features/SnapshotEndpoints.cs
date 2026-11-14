using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Walkie.Modules.Discovery.Contracts;

namespace Walkie.Modules.Discovery.Features;

/// <summary>Endpoints de Discovery (spec walkie-live). Todos detrás de <see cref="DiscoveryOptions.Enabled"/>.</summary>
internal static class SnapshotEndpoints
{
    public static IEndpointRouteBuilder MapSnapshotEndpoints(this IEndpointRouteBuilder routes)
    {
        var discovery = routes.MapGroup("")
            .WithTags("Discovery")
            // Bloqueo de seguridad (ADR-0012): apagado, Discovery no existe para nadie. La autenticación va antes (401).
            .AddEndpointFilter(async (context, next) =>
                context.HttpContext.RequestServices.GetRequiredService<IOptionsMonitor<DiscoveryOptions>>().CurrentValue.Enabled
                    ? await next(context).ConfigureAwait(false)
                    : TypedResults.NotFound());

        discovery.MapPost("/api/apps/{appId:guid}/sources/snapshots", Upload)
            .WithName("UploadDiscoverySnapshot")
            .WithSummary(
                "Recibe un .walkiepack (multipart, campo file, hasta 50 MB; spec walkie-live, ADR-0014) y guarda el análisis de esa "
                + "fuente en la app. Con dryRun=true solo lo valida y devuelve el resumen. El mismo archivo, o el mismo contenido que el "
                + "último análisis de la fuente, devuelve el existente (200) sin duplicarlo. Errores con la ruta dentro del paquete, ej. "
                + "discovery.json/entities/3/evidence/0. No modifica lienzos, catálogo, módulos ni features.")
            .Accepts<IFormFile>("multipart/form-data")
            .DisableAntiforgery()
            // Un poco más que el archivo, por las cabeceras del multipart; el límite del archivo se revisa abajo (413).
            .WithMetadata(new RequestSizeLimitAttribute(DiscoveryLimits.MaxPackBytes + (1024 * 1024)))
            .Produces<DiscoveryUploadResponse>(StatusCodes.Status200OK)
            .Produces<DiscoveryUploadResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);

        return routes;
    }

    private static async Task<Results<Created<DiscoveryUploadResponse>, Ok<DiscoveryUploadResponse>, NotFound, ValidationProblem, ProblemHttpResult>> Upload(
        Guid appId, bool? dryRun, HttpRequest request, ClaimsPrincipal user, SnapshotHandlers handlers, CancellationToken ct)
    {
        var (file, missing, tooLarge) = await ReadPackageAsync(request, ct).ConfigureAwait(false);
        if (missing is not null)
        {
            return missing;
        }

        if (file is null)
        {
            return tooLarge!;
        }

        var userId = user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
        return await handlers.UploadAsync(appId, file, dryRun ?? false, userId, ct).ConfigureAwait(false) switch
        {
            UploadResult.Done { Response: { Status: "created" } response } => TypedResults.Created((string?)null, response),
            UploadResult.Done { Response: var response } => TypedResults.Ok(response),
            UploadResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            _ => TypedResults.NotFound(),
        };
    }

    /// <summary>
    /// El archivo del multipart, leído a mano (como la importación del <c>.walkie</c>): <c>TestServer</c> no aplica el
    /// <see cref="RequestSizeLimitAttribute"/>, así que el 413 lo da este método por <c>ContentLength</c> y por el tamaño.
    /// </summary>
    private static async Task<(byte[]? File, ValidationProblem? Invalid, ProblemHttpResult? TooLarge)> ReadPackageAsync(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentLength > DiscoveryLimits.MaxPackBytes + (1024 * 1024))
        {
            return (null, null, TooLarge());
        }

        IFormFile? file = null;
        if (request.HasFormContentType && request.ContentLength is not 0)
        {
            try
            {
                file = (await request.ReadFormAsync(ct).ConfigureAwait(false)).Files.GetFile("file");
            }
            catch (InvalidDataException)
            {
                file = null;
            }
        }

        if (file is null || file.Length == 0)
        {
            return (null, TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["file"] = ["Falta el archivo .walkiepack (campo file). Genéralo con «walkie scan <carpeta>»."],
            }), null);
        }

        if (file.Length > DiscoveryLimits.MaxPackBytes)
        {
            return (null, null, TooLarge());
        }

        using var bytes = new MemoryStream();
        await file.CopyToAsync(bytes, ct).ConfigureAwait(false);
        return (bytes.ToArray(), null, null);
    }

    private static ProblemHttpResult TooLarge() => TypedResults.Problem(
        statusCode: StatusCodes.Status413PayloadTooLarge,
        title: "El paquete es demasiado grande.",
        detail: $"El máximo es {DiscoveryLimits.MaxPackBytes / (1024 * 1024)} MB. Analiza una parte del proyecto (walkie scan <carpeta> o --detectors).");
}
