using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Discovery.Contracts;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Revisión, decisiones y fuentes (spec walkie-live, tarea 4). Van en el mismo grupo que la subida, detrás de
/// <see cref="DiscoveryOptions.Enabled"/>. Títulos, rutas y metadatos vienen de un paquete subido por una persona: la
/// respuesta los devuelve como texto JSON y quien los muestre los trata como texto no confiable.
/// </summary>
internal static class ReviewEndpoints
{
    public static RouteGroupBuilder MapReviewEndpoints(this RouteGroupBuilder discovery)
    {
        discovery.MapGet("/api/snapshots/{snapshotId:guid}/review", Review)
            .WithName("GetDiscoveryReview")
            .WithSummary(
                "Revisión calculada de un análisis (walkie-discovery-review): hallazgos con su estado (new, matched, linked, created, "
                + "rejected, changed, missing), su coincidencia o sus candidatos y la operación propuesta. Filtros kind y status; "
                + "paginación con page (desde 0) y pageSize (1 a 500, por defecto 50). Los conteos son del análisis completo. No se guarda.")
            .Produces<DiscoveryReviewResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);

        discovery.MapPost("/api/snapshots/{snapshotId:guid}/apply", Apply)
            .WithName("ApplyDiscoveryOperations")
            .WithSummary(
                "Decide sobre hallazgos del último análisis de una fuente (walkie-discovery-apply → walkie-discovery-apply-result): "
                + "reject, link y reset (create llega en la tarea 6). Con dryRun=true es la vista previa. Idempotente por applyId. "
                + "bindingVersion distinto del actual: 409. Nunca modifica el elemento vinculado ni ningún lienzo.")
            .Accepts<JsonElement>("application/json")
            .Produces<DiscoveryApplyResult>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        discovery.MapGet("/api/snapshots/{snapshotId:guid}/evidence", Evidence)
            .WithName("GetDiscoveryEvidence")
            .WithSummary(
                "Evidencia y relaciones de un hallazgo (walkie-discovery-evidence), para el inspector de la revisión: entityKey en la "
                + "query (las claves llevan / y espacios). Si ya no aparece en el análisis, la del anterior. 404 si no está en ninguno.")
            .Produces<EntityEvidence>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);

        discovery.MapGet("/api/apps/{appId:guid}/sources", Sources)
            .WithName("ListDiscoverySources")
            .WithSummary("Fuentes locales de la app con su último análisis (walkie-discovery-sources). Solo las de esa app.")
            .Produces<DiscoverySourcesResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        return discovery;
    }

    private static async Task<Results<Ok<DiscoveryReviewResponse>, NotFound, ValidationProblem>> Review(
        Guid snapshotId, string? kind, string? status, int? page, int? pageSize, ReviewHandlers handlers, CancellationToken ct) =>
        await handlers.ReviewAsync(snapshotId, kind, status, page, pageSize, ct).ConfigureAwait(false) switch
        {
            ReviewResult.Done done => TypedResults.Ok(done.Review),
            ReviewResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            _ => TypedResults.NotFound(),
        };

    private static async Task<Results<Ok<DiscoveryApplyResult>, NotFound, ValidationProblem, ProblemHttpResult>> Apply(
        Guid snapshotId, bool? dryRun, [FromBody] JsonElement body, ClaimsPrincipal user, ApplyHandlers handlers, CancellationToken ct)
    {
        var userId = user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
        return await handlers.ApplyAsync(snapshotId, body, dryRun ?? false, userId, ct).ConfigureAwait(false) switch
        {
            ApplyOutcome.Done done => TypedResults.Ok(done.Result),
            ApplyOutcome.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            ApplyOutcome.Conflict conflict => TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "La decisión choca con el estado actual.",
                extensions: new Dictionary<string, object?> { ["errors"] = conflict.Errors }),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<Results<Ok<EntityEvidence>, NotFound, ValidationProblem>> Evidence(
        Guid snapshotId, string? entityKey, EvidenceHandlers handlers, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(entityKey))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["entityKey"] = ["Falta la clave del hallazgo."] });
        }

        return await handlers.EvidenceAsync(snapshotId, entityKey, ct).ConfigureAwait(false) is { } evidence
            ? TypedResults.Ok(evidence)
            : TypedResults.NotFound();
    }

    private static async Task<Results<Ok<DiscoverySourcesResponse>, NotFound>> Sources(Guid appId, SourceHandlers handlers, CancellationToken ct) =>
        await handlers.SourcesAsync(appId, ct).ConfigureAwait(false) is { } sources ? TypedResults.Ok(sources) : TypedResults.NotFound();
}
