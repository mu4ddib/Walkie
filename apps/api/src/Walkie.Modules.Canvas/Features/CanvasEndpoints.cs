using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Canvas.Contracts;

namespace Walkie.Modules.Canvas.Features;

internal static class CanvasEndpoints
{
    public static IEndpointRouteBuilder MapCanvasEndpoints(this IEndpointRouteBuilder routes)
    {
        var canvas = routes.MapGroup("/api/features/{featureId:guid}/canvas").WithTags("Canvas");

        canvas.MapGet("/", GetCanvas)
            .WithName("GetCanvas")
            .WithSummary("Grafo del lienzo (packages/schema/walkie-graph.schema.json). Feature nueva: grafo vacío con version 0.");

        canvas.MapPut("/", SaveCanvas)
            .WithName("SaveCanvas")
            .WithSummary("Guarda el grafo si su version coincide con la guardada; responde el grafo con version + 1.")
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        routes.MapGet("/api/apps/{appId:guid}/canvas-previews", GetPreviews)
            .WithTags("Canvas")
            .WithName("GetCanvasPreviews")
            .WithSummary("Vista previa del último lienzo guardado de cada feature de la app (miniaturas de la galería).");

        return routes;
    }

    private static async Task<Results<Ok<IReadOnlyList<CanvasPreview>>, NotFound>> GetPreviews(
        Guid appId, CanvasPreviews previews, CancellationToken ct) =>
        await previews.OfAppAsync(appId, ct).ConfigureAwait(false) is { } list
            ? TypedResults.Ok(list)
            : TypedResults.NotFound();

    private static async Task<Results<Ok<JsonElement>, NotFound>> GetCanvas(
        Guid featureId, CanvasHandlers handlers, CancellationToken ct) =>
        await handlers.GetAsync(featureId, ct).ConfigureAwait(false) is { } graph
            ? TypedResults.Ok(graph)
            : TypedResults.NotFound();

    private static async Task<Results<Ok<JsonElement>, NotFound, ValidationProblem, ProblemHttpResult>> SaveCanvas(
        Guid featureId, JsonElement graph, ClaimsPrincipal user, CanvasHandlers handlers, CancellationToken ct)
    {
        var userId = user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");

        return await handlers.SaveAsync(featureId, graph, userId, ct).ConfigureAwait(false) switch
        {
            SaveResult.Saved saved => TypedResults.Ok(saved.Graph),
            SaveResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors, title: "El grafo no es válido."),
            SaveResult.Conflict conflict => TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "El lienzo cambió desde que lo cargaste.",
                detail: "Recarga la versión del servidor antes de guardar.",
                extensions: new Dictionary<string, object?> { ["currentVersion"] = conflict.CurrentVersion }),
            _ => TypedResults.NotFound(),
        };
    }
}
