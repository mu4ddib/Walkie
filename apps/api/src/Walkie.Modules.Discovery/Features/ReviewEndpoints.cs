using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps;
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
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        discovery.MapPost("/api/snapshots/{snapshotId:guid}/apply", Apply)
            .WithName("ApplyDiscoveryOperations")
            .WithSummary(
                "Decide sobre hallazgos del último análisis de una fuente (walkie-discovery-apply → walkie-discovery-apply-result): "
                + "create (api, service, database o resource en el catálogo, con el id UUID v7 del cliente), link, reject y reset. "
                + "Con dryRun=true es la vista previa, con las mismas validaciones y sin escribir. Idempotente por applyId; si se cortó "
                + "a mitad, repetirlo la termina. bindingVersion distinto del actual: 409. Si falla a mitad, se deshace lo creado "
                + "(status compensated). Nunca modifica un elemento existente ni ningún lienzo.")
            .Accepts<JsonElement>("application/json")
            .Produces<DiscoveryApplyResult>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAppRole(AppRole.Editor);

        discovery.MapGet("/api/snapshots/{snapshotId:guid}/architecture", Architecture)
            .WithName("GetDiscoveryArchitecture")
            .WithSummary(
                "Arquitectura descubierta de un análisis (walkie-discovery-architecture, ADR-0016): grupos por app técnica y "
                + "responsabilidad, relaciones entre grupos con su significado (ejecución, navegación, contención, dependencia) y "
                + "cuántas son observadas o inferidas, cobertura por grupo y propuestas de feature con su evidencia. Calculada, no se guarda.")
            .Produces<DiscoveryArchitecture>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        discovery.MapGet("/api/snapshots/{snapshotId:guid}/architecture/group", ArchitectureGroup)
            .WithName("GetDiscoveryArchitectureGroup")
            .WithSummary(
                "Un grupo de la arquitectura por dentro (walkie-discovery-architecture-group): key en la query (la de la vista "
                + "general), page desde 0 y pageSize de 1 a 500 (200 por defecto). Hallazgos, relaciones y vecinos de otros grupos.")
            .Produces<DiscoveryArchitectureGroup>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        discovery.MapGet("/api/snapshots/{snapshotId:guid}/relation-evidence", RelationEvidenceOf)
            .WithName("GetDiscoveryRelationEvidence")
            .WithSummary(
                "Una relación con su evidencia resuelta (walkie-discovery-relation-evidence): key en la query. Para una relación "
                + "inferida es la cadena entera (pantalla → hook → cliente → API; endpoint → servicio → DbSet), cada salto con su archivo y línea.")
            .Produces<RelationEvidence>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        discovery.MapGet("/api/snapshots/{snapshotId:guid}/evidence", Evidence)
            .WithName("GetDiscoveryEvidence")
            .WithSummary(
                "Evidencia y relaciones de un hallazgo (walkie-discovery-evidence), para el inspector de la revisión: entityKey en la "
                + "query (las claves llevan / y espacios). Si ya no aparece en el análisis, la del anterior. 404 si no está en ninguno.")
            .Produces<EntityEvidence>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        discovery.MapGet("/api/apps/{appId:guid}/bindings", Provenance)
            .WithName("GetDiscoveryProvenance")
            .WithSummary(
                "De qué hallazgos de Walkie Live viene un elemento (walkie-discovery-provenance): target={kind}:{id}, con kind "
                + "catalogItem, module o feature. Los vínculos activos con su fuente, hallazgo, evidencia y si el último análisis lo sigue viendo.")
            .Produces<ProvenanceResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        discovery.MapGet("/api/apps/{appId:guid}/sources", Sources)
            .WithName("ListDiscoverySources")
            .WithSummary("Fuentes locales de la app con su último análisis (walkie-discovery-sources). Solo las de esa app.")
            .Produces<DiscoverySourcesResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .RequireAppRole(AppRole.Viewer);

        return discovery;
    }

    private static async Task<Results<Ok<DiscoveryReviewResponse>, NotFound, ValidationProblem>> Review(
        Guid snapshotId, string? kind, string? status, int? page, int? pageSize, string? change, bool? needsReview, [FromQuery] string[]? key,
        ReviewHandlers handlers, CancellationToken ct)
    {
        if (key is { Length: > ArchitectureHandlers.MaxPageSize })
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["key"] = [$"Como mucho {ArchitectureHandlers.MaxPageSize} claves."] });
        }

        var keys = key is { Length: > 0 } ? new HashSet<string>(key, StringComparer.Ordinal) : null;
        return await handlers.ReviewAsync(snapshotId, kind, status, page, pageSize, ct, change, needsReview, keys).ConfigureAwait(false) switch
        {
            ReviewResult.Done done => TypedResults.Ok(done.Review),
            ReviewResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<Results<Ok<RelationEvidence>, NotFound, ValidationProblem>> RelationEvidenceOf(
        Guid snapshotId, string? key, EvidenceHandlers handlers, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 1100)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["key"] = ["Falta la clave de la relación."] });
        }

        return await handlers.RelationAsync(snapshotId, key, ct).ConfigureAwait(false) is { } found ? TypedResults.Ok(found) : TypedResults.NotFound();
    }

    private static async Task<Results<Ok<DiscoveryArchitecture>, NotFound>> Architecture(Guid snapshotId, ArchitectureHandlers handlers, CancellationToken ct) =>
        await handlers.OverviewAsync(snapshotId, ct).ConfigureAwait(false) is { } architecture ? TypedResults.Ok(architecture) : TypedResults.NotFound();

    private static async Task<Results<Ok<DiscoveryArchitectureGroup>, NotFound, ValidationProblem>> ArchitectureGroup(
        Guid snapshotId, string? key, int? page, int? pageSize, ArchitectureHandlers handlers, CancellationToken ct)
    {
        var size = pageSize ?? 200;
        if (string.IsNullOrWhiteSpace(key) || key.Length > 600 || page is < 0 || size is < 1 or > ArchitectureHandlers.MaxPageSize)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["key"] = ["Falta la clave del grupo (de la vista general), o las páginas están fuera de rango (pageSize de 1 a 500)."],
            });
        }

        return await handlers.GroupAsync(snapshotId, key, page ?? 0, size, ct).ConfigureAwait(false) is { } group ? TypedResults.Ok(group) : TypedResults.NotFound();
    }

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
            ApplyOutcome.Unfinished unfinished => TypedResults.Problem(
                title: "La aplicación quedó pendiente", detail: unfinished.Message, statusCode: StatusCodes.Status500InternalServerError),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<Results<Ok<ProvenanceResponse>, NotFound, ValidationProblem>> Provenance(
        Guid appId, string? target, ProvenanceHandlers handlers, CancellationToken ct) =>
        await handlers.ForTargetAsync(appId, target, ct).ConfigureAwait(false) switch
        {
            ProvenanceResult.Done done => TypedResults.Ok(done.Response),
            ProvenanceResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            _ => TypedResults.NotFound(),
        };

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
