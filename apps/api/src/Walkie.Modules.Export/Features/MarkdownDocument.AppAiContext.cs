using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.Modules.Export.Features;

/// <summary>Lo que necesita el contexto de una app: sus features (con el último grafo guardado de cada una) y su catálogo.</summary>
internal sealed record AppAiContextInput(
    Guid AppId,
    string AppName,
    IReadOnlyList<(FeatureSummary Feature, JsonElement Graph)> Features,
    IReadOnlyList<CatalogItemResponse> Catalog,
    DateTimeOffset ExportedAt);

/// <summary>
/// Contexto para IA de una app completa (spec exportar-e-importar, tarea 2): el contexto de cada feature (el mismo de
/// la tarea 1), el catálogo con dónde se usa cada componente, el mapa (qué feature lleva a cuál) y los vacíos de todo.
/// JSON según <c>packages/schema/walkie-app-ai-context.schema.json</c> y Markdown, desde el mismo modelo.
/// </summary>
internal static partial class MarkdownDocument
{
    public static string AppAiContextJson(AppAiContext context) => JsonSerializer.Serialize(context, AiJson) + "\n";

    public static AppAiContext BuildAppAiContext(AppAiContextInput input)
    {
        var catalog = input.Catalog.ToDictionary(i => i.Id);
        var names = input.Features.ToDictionary(f => f.Feature.Id, f => f.Feature.Name);
        var features = input.Features
            .Select(f => BuildAiContext(new AiContextInput(
                f.Feature.Id, input.AppName, f.Feature.Name, f.Feature.Description, f.Graph, catalog, names, input.ExportedAt)))
            .ToList();

        var items = input.Catalog
            .Select(item => new AppAiCatalogItem(
                item.Id.ToString(),
                item.Type,
                item.Type == "resource" && item.Resource is { ValueKind: JsonValueKind.Object } r ? ResourceLabel(r) : SectionLabel(item.Type),
                item.Title,
                Blank(item.Description),
                item.Http,
                item.Database,
                item.Resource,
                item.Runtime,
                [.. features
                    .Where(f => f.Components.Any(c => c.CatalogId == item.Id.ToString()))
                    .Select(f => f.Feature.Name)]))
            .OrderBy(i => Array.FindIndex(Sections, s => s.Type == i.Type))
            .ThenBy(i => i.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(i => i.Title, StringComparer.Ordinal)
            .ThenBy(i => i.Id, StringComparer.Ordinal)
            .ToList();

        var links = features
            .SelectMany(f => f.Components
                .Where(c => c.IsPortal && c.TargetFeature is not null)
                .Select(c => new AppAiLink(f.Feature.Name, c.TargetFeature!, c.Title)))
            .ToList();

        var gaps = features
            .SelectMany(f => f.Gaps.Select(g => new AppAiGap(f.Feature.Name, g.Kind, g.ElementId, g.Message)))
            .Concat(items.Where(i => i.UsedBy.Count == 0).Select(i => new AppAiGap(
                null, "unused-catalog-item", i.Id, $"El componente «{i.Title}» ({i.Is}) del catálogo no lo usa ningún lienzo.")))
            .ToList();

        return new AppAiContext(
            "walkie-app-ai-context",
            0,
            new AppAiApp(input.AppId, input.AppName),
            input.ExportedAt,
            features,
            items,
            new AppAiMap(links),
            gaps);
    }

    /// <summary>
    /// La app como Markdown: índice de features con su propósito, mapa, catálogo compartido y resumen de vacíos; después,
    /// el contexto de cada feature un nivel más abajo.
    /// </summary>
    public static string RenderAppAiContext(AppAiContext c)
    {
        var md = new Md();
        md.Line($"# Contexto para IA: {MarkdownText.Inline(c.App.Name)} (app completa)");
        md.Blank();
        md.Line(string.Create(CultureInfo.InvariantCulture,
            $"> Documento generado por Walkie para dar contexto a un asistente de IA antes de construir. Describe la app tal como está documentada: {c.Features.Count} features, su catálogo compartido y cómo se conectan (exportado el {c.ExportedAt.UtcDateTime:yyyy-MM-dd HH:mm} UTC, con la última versión guardada de cada lienzo). Si algo no está aquí, pregunta en vez de suponer: cada feature tiene su sección «Vacíos detectados»."));
        md.Blank();

        md.Line("## Features");
        md.Blank();
        if (c.Features.Count == 0)
        {
            md.Line("La app aún no tiene features.");
        }

        foreach (var f in c.Features)
        {
            var size = string.Create(CultureInfo.InvariantCulture, $"{f.Components.Count} componentes · {f.Gaps.Count} vacíos");
            md.Line($"- **{MarkdownText.Inline(f.Feature.Name)}** ({size})"
                + (f.Feature.Description is { } d ? $": {MarkdownText.Inline(d)}" : ": sin descripción."));
        }

        md.Blank();
        md.Line("## Mapa de la app");
        md.Blank();
        if (c.Map.Links.Count == 0)
        {
            md.Line("Las features no se conectan entre sí por portales.");
        }

        foreach (var link in c.Map.Links)
        {
            md.Line($"- **{MarkdownText.Inline(link.From)}** → **{MarkdownText.Inline(link.To)}** (por el portal «{MarkdownText.Inline(link.Via)}»)");
        }

        md.Blank();
        md.Line("## Catálogo compartido");
        md.Blank();
        if (c.Catalog.Count == 0)
        {
            md.Line("La app no tiene componentes compartidos.");
            md.Blank();
        }
        else
        {
            md.Line("Componentes con una sola definición para todos los lienzos que los usan: un cambio aquí afecta a todas esas features.");
            md.Blank();
        }

        foreach (var item in c.Catalog)
        {
            md.Line($"### {MarkdownText.Inline(item.Title)} ({MarkdownText.Inline(item.Is)})");
            md.Blank();
            md.Line($"id: {MarkdownText.Code(item.Id)} · "
                + (item.UsedBy.Count == 0 ? "no lo usa ningún lienzo" : "usado en: " + string.Join(", ", item.UsedBy.Select(MarkdownText.Inline)))
                + (item.Runtime is { } runtime ? $" · corre en: {Runtimes.GetValueOrDefault(runtime, runtime)}" : string.Empty));
            md.Blank();
            if (item.Description is { } description)
            {
                md.Line(MarkdownText.Block(description));
                md.Blank();
            }

            foreach (var (title, value) in new[] { ("Contrato", item.Http), ("Estructura", item.Database), ("Recurso", item.Resource) })
            {
                if (value is { ValueKind: JsonValueKind.Object } json)
                {
                    md.Line($"{title}:");
                    md.Blank();
                    md.Line(MarkdownText.CodeBlock(JsonSerializer.Serialize(json, AiJson), "json"));
                    md.Blank();
                }
            }
        }

        md.Line("## Vacíos detectados (resumen)");
        md.Blank();
        if (c.Gaps.Count == 0)
        {
            md.Line("No se detectaron vacíos.");
        }

        foreach (var f in c.Features.Where(f => f.Gaps.Count > 0))
        {
            md.Line(string.Create(CultureInfo.InvariantCulture, $"- **{MarkdownText.Inline(f.Feature.Name)}**: {f.Gaps.Count} (ver su sección)."));
        }

        foreach (var gap in c.Gaps.Where(g => g.Feature is null))
        {
            md.Line($"- {MarkdownText.Inline(gap.Message)}");
        }

        md.Blank();
        foreach (var feature in c.Features)
        {
            RenderAiContext(feature, md, 1);
        }

        return md.ToString();
    }
}

internal sealed record AppAiContext(
    string Format,
    int FormatVersion,
    AppAiApp App,
    DateTimeOffset ExportedAt,
    IReadOnlyList<AiContext> Features,
    IReadOnlyList<AppAiCatalogItem> Catalog,
    AppAiMap Map,
    IReadOnlyList<AppAiGap> Gaps);

internal sealed record AppAiApp(Guid Id, string Name);

internal sealed record AppAiCatalogItem(
    string Id,
    string Type,
    string Is,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Http,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Database,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Resource,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Runtime,
    IReadOnlyList<string> UsedBy);

internal sealed record AppAiMap(IReadOnlyList<AppAiLink> Links);

internal sealed record AppAiLink(string From, string To, string Via);

internal sealed record AppAiGap(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Feature,
    string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ElementId,
    string Message);
