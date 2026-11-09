using System.Globalization;
using System.Text;
using System.Text.Json;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.Modules.Export.Features;

/// <summary>Lo que necesita el documento de una feature; todo viene ya leído (el generador no toca la base).</summary>
internal sealed record ExportInput(
    string AppName,
    string FeatureName,
    JsonElement Graph,
    IReadOnlyDictionary<Guid, CatalogItemResponse> Catalog,
    IReadOnlyDictionary<Guid, string> FeatureNames,
    IReadOnlyDictionary<Guid, string> ImagePaths,
    DateTimeOffset ExportedAt);

/// <summary>
/// Documento Markdown de una feature (spec export-markdown, criterios 3 a 8 y 10): encabezado, índice, diagrama
/// Mermaid, una sección por tipo de caja, conexiones y tours. Función pura y con orden estable: el mismo grafo
/// da el mismo texto salvo la fecha de exportación.
/// </summary>
internal static class MarkdownDocument
{
    /// <summary>Secciones por tipo, en el orden de la spec (criterio 5); los <c>ref</c> van en la de su elemento.</summary>
    private static readonly (string Type, string Heading, string Label)[] Sections =
    [
        ("actor", "Actores", "Actor"),
        ("screen", "Pantallas", "Pantalla"),
        ("rule", "Reglas", "Regla"),
        ("api", "APIs", "API"),
        ("service", "Servicios", "Servicio"),
        ("database", "Bases de datos", "Base de datos"),
        ("portal", "Portales", "Portal"),
        ("ref", "Referencias sin elemento", "Referencia"),
    ];

    private static readonly Dictionary<string, string> EdgeKinds = new(StringComparer.Ordinal)
    {
        ["navigation"] = "navega",
        ["request"] = "llama",
        ["response"] = "responde",
        ["uses"] = "usa",
        ["reads"] = "lee",
        ["writes"] = "escribe",
    };

    public static string Render(ExportInput input)
    {
        var nodes = ReadNodes(input);
        var byId = nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
        var edges = ReadEdges(input.Graph, byId);
        var tours = ReadTours(input.Graph, byId);
        var md = new Md();

        md.Line($"# {MarkdownText.Inline(input.FeatureName)}");
        md.Blank();
        md.Line(string.Create(CultureInfo.InvariantCulture,
            $"App: **{MarkdownText.Inline(input.AppName)}** · Versión del lienzo: {Version(input.Graph)} · Exportado el {input.ExportedAt.UtcDateTime:yyyy-MM-dd HH:mm} (UTC) desde Walkie."));
        md.Blank();

        if (nodes.Count == 0)
        {
            md.Line("Este lienzo está vacío.");
            return md.ToString();
        }

        var present = Sections.Where(s => nodes.Any(n => n.Section == s.Type)).ToList();
        md.Line("## Contenido");
        md.Blank();
        md.Line("- [Diagrama](#diagrama)");
        foreach (var section in present)
        {
            md.Line($"- [{section.Heading}](#{Anchor(section.Heading)})");
        }

        if (edges.Count > 0)
        {
            md.Line("- [Conexiones](#conexiones)");
        }

        if (tours.Count > 0)
        {
            md.Line("- [Tours](#tours)");
        }

        md.Blank();
        WriteDiagram(md, nodes, edges);

        foreach (var section in present)
        {
            md.Line($"## {section.Heading}");
            md.Blank();
            foreach (var node in nodes.Where(n => n.Section == section.Type))
            {
                WriteNode(md, node, nodes, input);
            }
        }

        if (edges.Count > 0)
        {
            md.Line("## Conexiones");
            md.Blank();
            foreach (var edge in edges)
            {
                md.Line($"- {EdgeText(edge, MarkdownText.Inline)}");
            }

            md.Blank();
        }

        if (tours.Count > 0)
        {
            md.Line("## Tours");
            md.Blank();
            foreach (var tour in tours)
            {
                md.Line($"### {MarkdownText.Inline(tour.Name)}");
                md.Blank();
                if (tour.Steps.Count == 0)
                {
                    md.Line("Sin pasos.");
                }

                for (var i = 0; i < tour.Steps.Count; i++)
                {
                    var (node, note) = tour.Steps[i];
                    var number = string.Create(CultureInfo.InvariantCulture, $"{i + 1}. ");
                    var text = $"**{MarkdownText.Inline(node.Title)}**";
                    if (!string.IsNullOrWhiteSpace(note))
                    {
                        text += ": " + MarkdownText.Indent(MarkdownText.Block(note), number.Length);
                    }

                    md.Line(number + text);
                }

                md.Blank();
            }
        }

        return md.ToString();
    }

    private static void WriteDiagram(Md md, List<ExportNode> nodes, List<ExportEdge> edges)
    {
        md.Line("## Diagrama");
        md.Blank();
        md.Line("```mermaid");
        md.Line("flowchart LR");
        foreach (var node in nodes)
        {
            var label = MarkdownText.Mermaid($"{SectionLabel(node.Section)}: {node.Title}");
            md.Line($"  {node.Key}{Shape(node.Section, label)}");
        }

        foreach (var edge in edges)
        {
            md.Line($"  {edge.From.Key} -->|\"{MarkdownText.Mermaid(EdgeLabel(edge))}\"| {edge.To.Key}");
        }

        md.Line("```");
        md.Blank();
    }

    private static void WriteNode(Md md, ExportNode node, List<ExportNode> nodes, ExportInput input)
    {
        md.Line($"### {MarkdownText.Inline(node.Title)}{(node.FromCatalog ? " (del catálogo)" : string.Empty)}");
        md.Blank();

        if (node.Section == "ref")
        {
            md.Line("El elemento del catálogo ya no existe.");
            md.Blank();
        }

        if (node.Section == "screen" && Guid.TryParse(node.String("assetId"), out var assetId)
            && input.ImagePaths.TryGetValue(assetId, out var path))
        {
            md.Line($"![{MarkdownText.Inline(node.Title)}]({path})");
            md.Blank();
        }

        if (!string.IsNullOrWhiteSpace(node.Description))
        {
            md.Line(MarkdownText.Block(node.Description));
            md.Blank();
        }

        if (node.Method is not null || node.Path is not null)
        {
            md.Line(MarkdownText.Code($"{node.Method} {node.Path}".Trim()));
            md.Blank();
        }

        if (node.Section == "portal")
        {
            md.Line(PortalText(node, input));
            md.Blank();
        }

        if (node.Section == "screen")
        {
            WriteInputs(md, node, nodes);
        }

        if (node.Section == "rule")
        {
            if (node.String("expression") is { Length: > 0 } expression)
            {
                md.Line(MarkdownText.CodeBlock(expression));
                md.Blank();
            }

            var users = nodes
                .Where(n => n.Section == "screen")
                .SelectMany(screen => Inputs(screen)
                    .Where(i => i.RuleIds.Contains(node.Id, StringComparer.Ordinal))
                    .Select(i => $"{MarkdownText.Code(i.Name)} ({MarkdownText.Inline(screen.Title)})"))
                .ToList();
            if (users.Count > 0)
            {
                md.Line("Valida: " + string.Join(", ", users) + ".");
                md.Blank();
            }
        }
    }

    private static void WriteInputs(Md md, ExportNode screen, List<ExportNode> nodes)
    {
        var inputs = Inputs(screen);
        if (inputs.Count == 0)
        {
            return;
        }

        md.Line("| Input | Tipo | Obligatorio | Opciones | Reglas |");
        md.Line("| --- | --- | --- | --- | --- |");
        foreach (var input in inputs)
        {
            var rules = input.RuleIds
                .Select(id => nodes.FirstOrDefault(n => n.Id == id)?.Title)
                .OfType<string>()
                .Select(MarkdownText.Inline);
            md.Line(
                $"| {MarkdownText.Code(input.Name)} | {input.Type} | {(input.Required ? "Sí" : "No")} | " +
                $"{string.Join(", ", input.Options.Select(MarkdownText.Inline))} | {string.Join(", ", rules)} |");
        }

        md.Blank();
    }

    private static string PortalText(ExportNode node, ExportInput input)
    {
        if (node.String("targetFeatureId") is not { } target)
        {
            return "Sin destino.";
        }

        return Guid.TryParse(target, out var id) && input.FeatureNames.TryGetValue(id, out var name)
            ? $"Lleva a **{MarkdownText.Inline(name)}**."
            : $"Lleva a **{MarkdownText.Inline(node.RawTitle)}** (destino no encontrado).";
    }

    private static string EdgeText(ExportEdge edge, Func<string, string> escape) =>
        $"{escape(edge.From.Title)} → {escape(edge.To.Title)} ({escape(EdgeLabel(edge))})";

    /// <summary>"navega: Buscar [200]": tipo, etiqueta y condición.</summary>
    private static string EdgeLabel(ExportEdge edge)
    {
        var text = EdgeKinds.GetValueOrDefault(edge.Kind, edge.Kind);
        if (!string.IsNullOrWhiteSpace(edge.Label))
        {
            text += $": {edge.Label}";
        }

        if (!string.IsNullOrWhiteSpace(edge.When))
        {
            text += $" [{edge.When}]";
        }

        return text;
    }

    private static string Shape(string section, string label) => section switch
    {
        "actor" => $"((\"{label}\"))",
        "rule" => $"{{{{\"{label}\"}}}}",
        "database" => $"[(\"{label}\")]",
        "portal" => $"[/\"{label}\"/]",
        _ => $"[\"{label}\"]",
    };

    private static string SectionLabel(string section) => Sections.First(s => s.Type == section).Label;

    /// <summary>Ancla de GitHub para un título: minúsculas y espacios como guiones.</summary>
    private static string Anchor(string heading) =>
        heading.ToLowerInvariant().Replace(' ', '-');

    private static int Version(JsonElement graph) =>
        graph.TryGetProperty("version", out var v) && v.TryGetInt32(out var n) ? n : 0;

    /// <summary>Nodos con su tipo efectivo (un <c>ref</c> es su elemento), en orden de sección, título e id.</summary>
    private static List<ExportNode> ReadNodes(ExportInput input)
    {
        var order = Sections.Select((s, i) => (s.Type, i)).ToDictionary(x => x.Type, x => x.i, StringComparer.Ordinal);
        var nodes = input.Graph.GetProperty("nodes").EnumerateObject()
            .Select(p => ToNode(p.Value, input.Catalog))
            .OrderBy(n => order.GetValueOrDefault(n.Section, int.MaxValue))
            .ThenBy(n => n.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(n => n.Title, StringComparer.Ordinal)
            .ThenBy(n => n.Id, StringComparer.Ordinal)
            .ToList();
        for (var i = 0; i < nodes.Count; i++)
        {
            nodes[i] = nodes[i] with { Key = string.Create(CultureInfo.InvariantCulture, $"n{i + 1}") };
        }

        return nodes;
    }

    private static ExportNode ToNode(JsonElement json, IReadOnlyDictionary<Guid, CatalogItemResponse> catalog)
    {
        var type = json.GetProperty("type").GetString()!;
        var title = json.GetProperty("title").GetString()!;
        var http = json.TryGetProperty("http", out var h) ? h : default;
        var node = new ExportNode(
            json.GetProperty("id").GetString()!, type, title, title, Text(json, "description"),
            http.ValueKind == JsonValueKind.Object ? Text(http, "method") : null,
            http.ValueKind == JsonValueKind.Object ? Text(http, "path") : null,
            FromCatalog: false, json, Key: string.Empty);

        if (type != "ref")
        {
            return node;
        }

        return Guid.TryParse(Text(json, "catalogId"), out var id) && catalog.TryGetValue(id, out var item)
            ? node with
            {
                Section = item.Type,
                Title = item.Title,
                Description = item.Description,
                Method = item.HttpMethod,
                Path = item.HttpPath,
                FromCatalog = true,
            }
            : node;
    }

    private static List<ExportEdge> ReadEdges(JsonElement graph, Dictionary<string, ExportNode> nodes) =>
        graph.GetProperty("edges").EnumerateObject()
            .Select(p => p.Value)
            .Where(e => nodes.ContainsKey(e.GetProperty("from").GetString()!) && nodes.ContainsKey(e.GetProperty("to").GetString()!))
            .Select(e => new ExportEdge(
                nodes[e.GetProperty("from").GetString()!],
                nodes[e.GetProperty("to").GetString()!],
                e.GetProperty("kind").GetString()!,
                Text(e, "label"),
                Text(e, "when"),
                e.GetProperty("id").GetString()!))
            .OrderBy(e => e.From.Key.Length).ThenBy(e => e.From.Key, StringComparer.Ordinal)
            .ThenBy(e => e.To.Key.Length).ThenBy(e => e.To.Key, StringComparer.Ordinal)
            .ThenBy(e => e.Id, StringComparer.Ordinal)
            .ToList();

    private static List<ExportTour> ReadTours(JsonElement graph, Dictionary<string, ExportNode> nodes)
    {
        if (!graph.TryGetProperty("tours", out var tours))
        {
            return [];
        }

        return tours.EnumerateObject()
            .Select(p => p.Value)
            .Select(t => new ExportTour(
                t.GetProperty("id").GetString()!,
                t.GetProperty("name").GetString()!,
                [.. t.GetProperty("steps").EnumerateArray()
                    .Where(s => nodes.ContainsKey(s.GetProperty("nodeId").GetString()!))
                    .Select(s => (nodes[s.GetProperty("nodeId").GetString()!], Text(s, "note")))]))
            .OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Name, StringComparer.Ordinal)
            .ThenBy(t => t.Id, StringComparer.Ordinal)
            .ToList();
    }

    private static List<ExportInputField> Inputs(ExportNode screen) =>
        screen.Json.TryGetProperty("inputs", out var inputs)
            ? [.. inputs.EnumerateArray().Select(i => new ExportInputField(
                i.GetProperty("name").GetString()!,
                i.GetProperty("type").GetString()!,
                i.TryGetProperty("required", out var r) && r.ValueKind == JsonValueKind.True,
                Strings(i, "options"),
                Strings(i, "ruleIds")))]
            : [];

    private static List<string> Strings(JsonElement json, string property) =>
        json.TryGetProperty(property, out var list) ? [.. list.EnumerateArray().Select(v => v.GetString()!)] : [];

    private static string? Text(JsonElement json, string property) =>
        json.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private sealed record ExportNode(
        string Id,
        string Section,
        string Title,
        string RawTitle,
        string? Description,
        string? Method,
        string? Path,
        bool FromCatalog,
        JsonElement Json,
        string Key)
    {
        public string? String(string property) => Text(Json, property);
    }

    private sealed record ExportEdge(ExportNode From, ExportNode To, string Kind, string? Label, string? When, string Id);

    private sealed record ExportTour(string Id, string Name, List<(ExportNode Node, string? Note)> Steps);

    private sealed record ExportInputField(string Name, string Type, bool Required, List<string> Options, List<string> RuleIds);

    /// <summary>Texto con saltos de línea <c>\n</c> (igual en cualquier sistema).</summary>
    private sealed class Md
    {
        private readonly StringBuilder _text = new();

        public void Line(string line) => _text.Append(line).Append('\n');

        public void Blank() => _text.Append('\n');

        public override string ToString() => _text.ToString().TrimEnd('\n') + "\n";
    }
}
