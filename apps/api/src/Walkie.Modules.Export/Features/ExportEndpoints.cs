using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;

namespace Walkie.Modules.Export.Features;

internal static class ExportEndpoints
{
    public static IEndpointRouteBuilder MapExportEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/features/{featureId:guid}/export", Export)
            .WithTags("Export")
            .WithName("ExportFeature")
            .WithSummary("La feature como .zip: <slug>.md (Markdown con diagrama Mermaid) e img/ con las imágenes de sus pantallas. Usa la última versión guardada.")
            .Produces(StatusCodes.Status200OK, contentType: "application/zip");

        return routes;
    }

    private static async Task<Results<FileContentHttpResult, NotFound>> Export(
        Guid featureId, ExportHandlers handlers, CancellationToken ct) =>
        await handlers.ExportAsync(featureId, ct).ConfigureAwait(false) is { } export
            ? TypedResults.File(export.Content, "application/zip", export.FileName)
            : TypedResults.NotFound();
}
