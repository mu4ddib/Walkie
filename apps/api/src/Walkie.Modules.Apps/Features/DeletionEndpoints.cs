using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.Modules.Apps.Features;

/// <summary>
/// Eliminar una feature o una app (ADR-0017, spec eliminar-apps-y-features): el impacto antes, la eliminación con un id
/// del cliente (reintentos) y el estado de una eliminación para quien la pidió. Solo el owner (ADR-0015).
/// </summary>
internal static class DeletionEndpoints
{
    public static IEndpointRouteBuilder MapDeletionEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/features/{featureId:guid}/deletion", FeatureImpact).WithTags("Apps").WithName("GetFeatureDeletionImpact")
            .WithSummary("Qué se pierde al eliminar la feature y qué lo impide (portales que la apuntan, operaciones en curso).")
            .RequireAppRole(AppRole.Owner);
        routes.MapDelete("/api/features/{featureId:guid}", DeleteFeature).WithTags("Apps").WithName("DeleteFeature")
            .WithSummary("Elimina la feature para siempre (no un módulo). Exige deletionId (UUID del cliente) y la canvasVersion del impacto.")
            .RequireAppRole(AppRole.Owner);
        routes.MapGet("/api/apps/{appId:guid}/deletion", AppImpact).WithTags("Apps").WithName("GetAppDeletionImpact")
            .WithSummary("Qué se pierde al eliminar la app: features, módulos, catálogo, imágenes, enlaces, miembros y Walkie Live.")
            .RequireAppRole(AppRole.Owner);
        routes.MapDelete("/api/apps/{appId:guid}", DeleteApp).WithTags("Apps").WithName("DeleteApp")
            .WithSummary("Elimina la app y todo su contenido para siempre. Exige deletionId y confirmName (el nombre exacto).")
            .RequireAppRole(AppRole.Owner);
        routes.MapGet("/api/deletions/{deletionId:guid}", Status).WithTags("Apps").WithName("GetDeletion")
            .WithSummary("Estado de una eliminación, para quien la pidió (la app ya puede no existir). Retoma una pendiente.");
        return routes;
    }

    private static async Task<Results<Ok<DeletionImpactResponse>, ProblemHttpResult>> FeatureImpact(Guid featureId, DeletionHandlers handlers, CancellationToken ct) =>
        await handlers.FeatureImpactAsync(featureId, ct).ConfigureAwait(false) is { } impact ? TypedResults.Ok(impact) : NotFound();

    private static async Task<Results<Ok<DeletionImpactResponse>, ProblemHttpResult>> AppImpact(Guid appId, DeletionHandlers handlers, CancellationToken ct) =>
        await handlers.AppImpactAsync(appId, ct).ConfigureAwait(false) is { } impact ? TypedResults.Ok(impact) : NotFound();

    private static async Task<IResult> DeleteFeature(Guid featureId, Guid? deletionId, int? canvasVersion, ClaimsPrincipal user, DeletionHandlers handlers, CancellationToken ct) =>
        deletionId is not { } id || id == Guid.Empty
            ? Invalid("deletionId", "Falta el id de la eliminación (un UUID que genera el cliente y repite en cada reintento).")
            : ToResult(await handlers.DeleteFeatureAsync(featureId, id, canvasVersion, user.FindFirstValue("sub")!, ct).ConfigureAwait(false));

    private static async Task<IResult> DeleteApp(Guid appId, Guid? deletionId, string? confirmName, ClaimsPrincipal user, DeletionHandlers handlers, CancellationToken ct) =>
        deletionId is not { } id || id == Guid.Empty
            ? Invalid("deletionId", "Falta el id de la eliminación (un UUID que genera el cliente y repite en cada reintento).")
            : ToResult(await handlers.DeleteAppAsync(appId, id, confirmName, user.FindFirstValue("sub")!, ct).ConfigureAwait(false));

    private static async Task<Results<Ok<DeletionResponse>, ProblemHttpResult>> Status(Guid deletionId, ClaimsPrincipal user, DeletionHandlers handlers, CancellationToken ct) =>
        await handlers.StatusAsync(deletionId, user.FindFirstValue("sub")!, ct).ConfigureAwait(false) is { } status ? TypedResults.Ok(status) : NotFound();

    private static IResult ToResult(DeletionOutcome outcome) => outcome switch
    {
        DeletionOutcome.Completed => TypedResults.NoContent(),
        DeletionOutcome.Pending p => TypedResults.Accepted($"/api/deletions/{p.Deletion.Id}", p.Deletion),
        DeletionOutcome.Blocked b => TypedResults.Problem(
            title: "No se puede eliminar todavía: hay referencias u operaciones que lo impiden.",
            statusCode: StatusCodes.Status409Conflict,
            extensions: new Dictionary<string, object?> { ["impact"] = b.Impact }),
        DeletionOutcome.Changed c => TypedResults.Problem(title: c.Message, statusCode: StatusCodes.Status409Conflict,
            extensions: new Dictionary<string, object?> { ["impact"] = c.Impact }),
        DeletionOutcome.Conflict c => TypedResults.Problem(title: c.Message, statusCode: StatusCodes.Status409Conflict),
        DeletionOutcome.Invalid i => Invalid(i.Field, i.Message),
        _ => NotFound(),
    };

    private static ProblemHttpResult NotFound() =>
        TypedResults.Problem(title: "No existe o no tienes acceso a esta app.", statusCode: StatusCodes.Status404NotFound);

    private static ValidationProblem Invalid(string field, string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
