using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;

namespace Walkie.Modules.Export.Features;

internal static class ExportEndpoints
{
    /// <summary>Formatos de <c>?format=</c>; sin él, <c>markdown</c> (el <c>.zip</c> de siempre).</summary>
    private static readonly string[] Formats = ["markdown", "ai", "ai-json"];

    public static IEndpointRouteBuilder MapExportEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/features/{featureId:guid}/export", Export)
            .WithTags("Export")
            .WithName("ExportFeature")
            .WithSummary(
                "Exporta la última versión guardada. format=markdown (por defecto): .zip con <slug>.md e img/. "
                + "format=ai: contexto para IA en Markdown (<slug>-contexto-ia.md). "
                + "format=ai-json: el mismo contexto en JSON (<slug>.context.json, packages/schema/walkie-ai-context.schema.json).")
            .Produces(StatusCodes.Status200OK, contentType: "application/zip")
            .Produces(StatusCodes.Status200OK, contentType: "text/markdown")
            .Produces(StatusCodes.Status200OK, contentType: "application/json");

        routes.MapGet("/api/apps/{appId:guid}/export", ExportApp)
            .WithTags("Export")
            .WithName("ExportApp")
            .WithSummary(
                "Contexto para IA de toda la app (cada feature con su último lienzo guardado, el catálogo y el mapa). "
                + "format=ai (por defecto): Markdown (<slug>-contexto-ia.md). "
                + "format=ai-json: JSON (<slug>.app-context.json, packages/schema/walkie-app-ai-context.schema.json).")
            .Produces(StatusCodes.Status200OK, contentType: "text/markdown")
            .Produces(StatusCodes.Status200OK, contentType: "application/json");

        return routes;
    }

    private static async Task<Results<FileContentHttpResult, NotFound, ValidationProblem>> Export(
        Guid featureId, string? format, ExportHandlers handlers, CancellationToken ct)
    {
        format ??= "markdown";
        if (!Formats.Contains(format))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["format"] = [$"El formato debe ser {string.Join(", ", Formats)}."],
            });
        }

        if (format == "markdown")
        {
            return await handlers.ExportAsync(featureId, ct).ConfigureAwait(false) is { } export
                ? TypedResults.File(export.Content, "application/zip", export.FileName)
                : TypedResults.NotFound();
        }

        if (await handlers.AiContextAsync(featureId, ct).ConfigureAwait(false) is not { } ai)
        {
            return TypedResults.NotFound();
        }

        return format == "ai"
            ? TypedResults.File(
                Utf8.GetBytes(MarkdownDocument.RenderAiContext(ai.Context)), "text/markdown; charset=utf-8", $"{ai.Slug}-contexto-ia.md")
            : TypedResults.File(
                Utf8.GetBytes(MarkdownDocument.AiContextJson(ai.Context)), "application/json; charset=utf-8", $"{ai.Slug}.context.json");
    }

    private static async Task<Results<FileContentHttpResult, NotFound, ValidationProblem>> ExportApp(
        Guid appId, string? format, ExportHandlers handlers, CancellationToken ct)
    {
        format ??= "ai";
        if (format is not ("ai" or "ai-json"))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["format"] = ["El formato debe ser ai o ai-json."],
            });
        }

        if (await handlers.AppAiContextAsync(appId, ct).ConfigureAwait(false) is not { } ai)
        {
            return TypedResults.NotFound();
        }

        return format == "ai"
            ? TypedResults.File(
                Utf8.GetBytes(MarkdownDocument.RenderAppAiContext(ai.Context)), "text/markdown; charset=utf-8", $"{ai.Slug}-contexto-ia.md")
            : TypedResults.File(
                Utf8.GetBytes(MarkdownDocument.AppAiContextJson(ai.Context)), "application/json; charset=utf-8", $"{ai.Slug}.app-context.json");
    }

    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
}
