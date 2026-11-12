using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;

namespace Walkie.Modules.Export.Features;

internal static class ExportEndpoints
{
    /// <summary>Formatos de <c>?format=</c>; sin él, <c>markdown</c> (el <c>.zip</c> de siempre).</summary>
    private static readonly string[] Formats = ["markdown", "ai", "ai-json", "walkie"];

    public static IEndpointRouteBuilder MapExportEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/features/{featureId:guid}/export", Export)
            .WithTags("Export")
            .WithName("ExportFeature")
            .WithSummary(
                "Exporta la última versión guardada. format=markdown (por defecto): .zip con <slug>.md e img/. "
                + "format=ai: contexto para IA en Markdown (<slug>-contexto-ia.md). "
                + "format=ai-json: el mismo contexto en JSON (<slug>.context.json, packages/schema/walkie-ai-context.schema.json). "
                + "format=walkie: archivo para reconstruir la feature (<slug>.walkie: manifest.json según walkie-package, lienzo, catálogo usado e imágenes).")
            .Produces(StatusCodes.Status200OK, contentType: "application/zip")
            .Produces(StatusCodes.Status200OK, contentType: "text/markdown")
            .Produces(StatusCodes.Status200OK, contentType: "application/json");

        routes.MapPost("/api/features/{featureId:guid}/export/pdf", ExportPdf)
            .WithTags("Export")
            .WithName("ExportFeaturePdf")
            .WithSummary(
                "PDF de la última versión guardada (ADR-0008): portada, lienzo, componentes con sus tablas, conexiones, "
                + "recorridos, tours y pendientes. Multipart con el campo opcional canvas: la imagen del lienzo (PNG, hasta 10 MB) "
                + "que genera el navegador. Sin ella, el PDF va sin la página del lienzo.")
            .Accepts<IFormFile>("multipart/form-data")
            .DisableAntiforgery()
            .Produces(StatusCodes.Status200OK, contentType: "application/pdf");

        routes.MapGet("/api/apps/{appId:guid}/export", ExportApp)
            .WithTags("Export")
            .WithName("ExportApp")
            .WithSummary(
                "Contexto para IA de toda la app (cada feature con su último lienzo guardado, el catálogo y el mapa). "
                + "format=ai (por defecto): Markdown (<slug>-contexto-ia.md). "
                + "format=ai-json: JSON (<slug>.app-context.json, packages/schema/walkie-app-ai-context.schema.json). "
                + "format=walkie: la app completa para reconstruirla (<slug>.walkie con scope app: todas las features, todo el "
                + "catálogo, las imágenes y la distribución del mapa en map.json).")
            .Produces(StatusCodes.Status200OK, contentType: "application/zip")
            .Produces(StatusCodes.Status200OK, contentType: "text/markdown")
            .Produces(StatusCodes.Status200OK, contentType: "application/json");

        routes.MapPost("/api/apps/{appId:guid}/import", Import)
            .WithTags("Export")
            .WithName("ImportPackage")
            .WithSummary(
                "Importa un archivo .walkie (multipart, campo file, hasta 50 MB; ADR-0009): crea sus features con ids nuevos, "
                + "el catálogo que usan (el que ya está en la app se reutiliza) y sus imágenes. Todo o nada. Con dryRun=true "
                + "solo valida y devuelve el resumen. Errores con la ruta dentro del archivo, ej. features/<id>/canvas.json/nodes/<nodo>.")
            .Accepts<IFormFile>("multipart/form-data")
            .DisableAntiforgery()
            // Un poco más que el archivo, por las cabeceras del multipart; el límite del archivo se revisa abajo (413).
            .WithMetadata(new RequestSizeLimitAttribute(ImportHandlers.MaxFileBytes + (1024 * 1024)))
            .Produces<ImportSummary>(StatusCodes.Status200OK)
            .Produces<ImportSummary>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);

        routes.MapPost("/api/apps/import", ImportApp)
            .WithTags("Export")
            .WithName("ImportApp")
            .WithSummary(
                "Importa un archivo .walkie como una app nueva (spec exportar-e-importar, tarea 7; ADR-0009): la app se llama "
                + "como en el archivo (con «(importada)» si ya hay una así) y recibe todas sus features, todo su catálogo, sus "
                + "imágenes y la distribución del mapa, con ids nuevos. Multipart, campo file, hasta 50 MB. Todo o nada. Con "
                + "dryRun=true solo valida y devuelve el resumen.")
            .Accepts<IFormFile>("multipart/form-data")
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(ImportHandlers.MaxFileBytes + (1024 * 1024)))
            .Produces<ImportSummary>(StatusCodes.Status200OK)
            .Produces<ImportSummary>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);

        return routes;
    }

    private static async Task<Results<Created<ImportSummary>, Ok<ImportSummary>, NotFound, ValidationProblem, ProblemHttpResult>> Import(
        Guid appId, bool? dryRun, HttpRequest request, ClaimsPrincipal user, ImportHandlers handlers, CancellationToken ct)
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
        var dry = dryRun ?? false;
        return await handlers.ImportAsync(appId, file, dry, userId, ct).ConfigureAwait(false) switch
        {
            ImportResult.Done { Summary: var summary } when dry => TypedResults.Ok(summary),
            ImportResult.Done { Summary: var summary } => TypedResults.Created($"/api/apps/{appId}/features", summary),
            ImportResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<Results<Created<ImportSummary>, Ok<ImportSummary>, ValidationProblem, ProblemHttpResult>> ImportApp(
        bool? dryRun, HttpRequest request, ClaimsPrincipal user, ImportHandlers handlers, CancellationToken ct)
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
        var dry = dryRun ?? false;
        return await handlers.ImportAppAsync(file, dry, userId, ct).ConfigureAwait(false) switch
        {
            ImportResult.Done { Summary: var summary } when dry => TypedResults.Ok(summary),
            ImportResult.Done { Summary: var summary } => TypedResults.Created($"/api/apps/{summary.App!.Id}", summary),
            ImportResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
            _ => throw new InvalidOperationException("Importar una app no busca una app existente."),
        };
    }

    /// <summary>Los bytes del campo <c>file</c>, o el 400 / 413 que corresponde.</summary>
    private static async Task<(byte[]? File, ValidationProblem? Invalid, ProblemHttpResult? TooLarge)> ReadPackageAsync(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentLength > ImportHandlers.MaxFileBytes + (1024 * 1024))
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
                ["file"] = ["Falta el archivo .walkie (campo file)."],
            }), null);
        }

        if (file.Length > ImportHandlers.MaxFileBytes)
        {
            return (null, null, TooLarge());
        }

        using var bytes = new MemoryStream();
        await file.CopyToAsync(bytes, ct).ConfigureAwait(false);
        return (bytes.ToArray(), null, null);
    }

    private static ProblemHttpResult TooLarge() => TypedResults.Problem(
        statusCode: StatusCodes.Status413PayloadTooLarge,
        title: "El archivo es demasiado grande.",
        detail: "Un archivo .walkie puede pesar hasta 50 MB.");

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

        if (format == "walkie")
        {
            return await handlers.WalkieAsync(featureId, ct).ConfigureAwait(false) is { } package
                ? TypedResults.File(package.Content, "application/zip", package.FileName)
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
        if (format is not ("ai" or "ai-json" or "walkie"))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["format"] = ["El formato debe ser ai, ai-json o walkie."],
            });
        }

        if (format == "walkie")
        {
            return await handlers.AppWalkieAsync(appId, ct).ConfigureAwait(false) is { } package
                ? TypedResults.File(package.Content, "application/zip", package.FileName)
                : TypedResults.NotFound();
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

    /// <summary>Tamaño máximo de la imagen del lienzo (bytes).</summary>
    private const long CanvasImageMaxBytes = 10 * 1024 * 1024;

    private static async Task<Results<FileContentHttpResult, NotFound, ValidationProblem>> ExportPdf(
        Guid featureId, HttpRequest request, ExportHandlers handlers, CancellationToken ct)
    {
        // Sin cuerpo, o con un multipart sin partes (no se pudo generar la imagen), el PDF va sin la página del lienzo.
        IFormFile? canvas = null;
        if (request.HasFormContentType && request.ContentLength is not 0)
        {
            try
            {
                canvas = (await request.ReadFormAsync(ct).ConfigureAwait(false)).Files.GetFile("canvas");
            }
            catch (InvalidDataException)
            {
                canvas = null;
            }
        }

        PdfImage? image = null;
        if (canvas is not null)
        {
            if (canvas.Length > CanvasImageMaxBytes)
            {
                return TypedResults.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["canvas"] = ["La imagen del lienzo no puede pasar de 10 MB."],
                });
            }

            using var bytes = new MemoryStream();
            await canvas.CopyToAsync(bytes, ct).ConfigureAwait(false);
            // Se reconoce por el contenido (la firma de PNG), no por el nombre ni el tipo que dice el navegador.
            if (!bytes.ToArray().AsSpan().StartsWith(PngSignature))
            {
                return TypedResults.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["canvas"] = ["La imagen del lienzo tiene que ser PNG."],
                });
            }

            image = new PdfImage(bytes.ToArray(), "image/png");
        }

        return await handlers.PdfAsync(featureId, image, ct).ConfigureAwait(false) is { } pdf
            ? TypedResults.File(pdf.Content, "application/pdf", pdf.FileName)
            : TypedResults.NotFound();
    }

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
}
