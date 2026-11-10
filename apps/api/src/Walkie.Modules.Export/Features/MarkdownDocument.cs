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
        ["event"] = "emite",
        ["uses"] = "usa",
        ["reads"] = "lee",
        ["writes"] = "escribe",
    };

    private static readonly Dictionary<string, string> AuthTypes = new(StringComparer.Ordinal)
    {
        ["none"] = "Sin autenticación",
        ["bearer"] = "Bearer (token)",
        ["apiKey"] = "API key",
        ["basic"] = "Básica",
        ["oauth2"] = "OAuth 2",
        ["mtls"] = "mTLS",
        ["other"] = "Otra",
    };

    private static readonly Dictionary<string, string> ParamPlaces = new(StringComparer.Ordinal)
    {
        ["path"] = "ruta",
        ["query"] = "query",
        ["header"] = "header",
    };

    private static readonly Dictionary<string, string> TableKinds = new(StringComparer.Ordinal)
    {
        ["table"] = "Tabla",
        ["collection"] = "Colección",
        ["view"] = "Vista",
    };

    private static readonly Dictionary<string, string> Keys = new(StringComparer.Ordinal)
    {
        ["primary"] = "PK",
        ["foreign"] = "FK",
        ["unique"] = "Única",
    };

    private static readonly Dictionary<string, string> GroupKinds = new(StringComparer.Ordinal)
    {
        ["frontend"] = "Frontend",
        ["backend"] = "Backend",
        ["external"] = "Externos",
        ["data"] = "Datos",
        ["network"] = "Red",
        ["environment"] = "Entorno",
        ["cloud"] = "Cloud",
        ["custom"] = "Libre",
    };

    public static string Render(ExportInput input)
    {
        var nodes = ReadNodes(input);
        var byId = nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
        var edges = ReadEdges(input.Graph, byId);
        var allTours = ReadTours(input.Graph, byId);
        var tours = allTours.Where(t => !t.IsFlow).ToList();
        var flows = allTours.Where(t => t.IsFlow).ToList();
        var groups = ReadGroups(input.Graph, nodes);
        var stickyNotes = ReadStickyNotes(input.Graph);
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

        if (groups.Count > 0)
        {
            md.Line("- [Grupos](#grupos)");
        }

        if (edges.Count > 0)
        {
            md.Line("- [Conexiones](#conexiones)");
        }

        if (stickyNotes.Count > 0)
        {
            md.Line("- [Notas del lienzo](#notas-del-lienzo)");
        }

        if (tours.Count > 0)
        {
            md.Line("- [Tours](#tours)");
        }

        if (flows.Count > 0)
        {
            md.Line("- [Recorridos](#recorridos)");
        }

        md.Blank();
        WriteDiagram(md, nodes, edges, groups);

        foreach (var section in present)
        {
            md.Line($"## {section.Heading}");
            md.Blank();
            foreach (var node in nodes.Where(n => n.Section == section.Type))
            {
                WriteNode(md, node, nodes, input);
            }
        }

        if (groups.Count > 0)
        {
            WriteGroups(md, groups);
        }

        if (edges.Count > 0)
        {
            md.Line("## Conexiones");
            md.Blank();
            foreach (var edge in edges)
            {
                md.Line($"- {EdgeText(edge, MarkdownText.Inline)}");
                WriteEdgeDetail(md, edge);
            }

            md.Blank();
        }

        if (stickyNotes.Count > 0)
        {
            md.Line("## Notas del lienzo");
            md.Blank();
            foreach (var note in stickyNotes)
            {
                md.Line($"- {MarkdownText.Indent(MarkdownText.Block(note), 2)}");
            }

            md.Blank();
        }

        WriteTours(md, "Tours", tours);
        WriteTours(md, "Recorridos", flows);

        return md.ToString();
    }

    /// <summary>
    /// Tours (el guía presenta nodos) o recorridos (conexiones en orden), cada uno en su sección (spec
    /// tours-y-recorridos). Sin ninguno, la sección no sale.
    /// </summary>
    private static void WriteTours(Md md, string heading, List<ExportTour> tours)
    {
        if (tours.Count == 0)
        {
            return;
        }

        md.Line($"## {heading}");
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
                var (title, note) = tour.Steps[i];
                var number = string.Create(CultureInfo.InvariantCulture, $"{i + 1}. ");
                var text = $"**{MarkdownText.Inline(title)}**";
                if (!string.IsNullOrWhiteSpace(note))
                {
                    text += ": " + MarkdownText.Indent(MarkdownText.Block(note), number.Length);
                }

                md.Line(number + text);
            }

            md.Blank();
        }
    }

    private static void WriteDiagram(Md md, List<ExportNode> nodes, List<ExportEdge> edges, List<ExportGroup> groups)
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

        // Cada grupo es un subgraph con sus nodos (Mermaid los mueve adentro).
        foreach (var group in groups)
        {
            md.Line($"  subgraph {group.Key}[\"{MarkdownText.Mermaid($"{GroupLabel(group)}: {group.Title}")}\"]");
            foreach (var member in group.Members)
            {
                md.Line($"    {member.Key}");
            }

            md.Line("  end");
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

        if (node.Http is { ValueKind: JsonValueKind.Object } http)
        {
            WriteContract(md, http);
        }

        if (node.Database is { ValueKind: JsonValueKind.Object } database)
        {
            WriteDatabase(md, database);
        }

        if (node.Section == "portal")
        {
            md.Line(PortalText(node, input));
            md.Blank();
        }

        if (node.String("notes") is { Length: > 0 } notes)
        {
            md.Line($"**{(node.Section is "actor" or "service" ? "Responsabilidades" : "Notas")}:**  ");
            md.Line(MarkdownText.Block(notes));
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

    /// <summary>Contrato de una API: autenticación, parámetros, request y respuestas (spec espacio-de-trabajo, 13).</summary>
    private static void WriteContract(Md md, JsonElement http)
    {
        if (http.TryGetProperty("auth", out var auth))
        {
            var type = Text(auth, "type") ?? "other";
            var line = $"**Autenticación:** {AuthTypes.GetValueOrDefault(type, type)}";
            if (Text(auth, "description") is { Length: > 0 } detail)
            {
                line += $". {MarkdownText.Inline(detail)}";
            }

            md.Line(line);
            md.Blank();
        }

        var parameters = Items(http, "params");
        if (parameters.Count > 0)
        {
            md.Line("**Parámetros**");
            md.Blank();
            md.Line("| Parámetro | Dónde | Tipo | Obligatorio | Descripción | Ejemplo |");
            md.Line("| --- | --- | --- | --- | --- | --- |");
            foreach (var p in parameters)
            {
                var place = Text(p, "in") ?? string.Empty;
                md.Line(
                    $"| {CodeCell(Text(p, "name"))} | {ParamPlaces.GetValueOrDefault(place, place)} | " +
                    $"{Cell(Text(p, "type"))} | {YesNo(p, "required")} | {Cell(Text(p, "description"))} | {CodeCell(Text(p, "example"))} |");
            }

            md.Blank();
        }

        if (http.TryGetProperty("request", out var request))
        {
            WriteBody(md, "**Request**", request);
        }

        foreach (var response in Items(http, "responses"))
        {
            var status = response.TryGetProperty("status", out var s) && s.TryGetInt32(out var code) ? code : 0;
            var title = string.Create(CultureInfo.InvariantCulture, $"**{status}**{(status >= 400 ? " (error)" : string.Empty)}");
            if (Text(response, "description") is { Length: > 0 } meaning)
            {
                title += $" — {MarkdownText.Inline(meaning)}";
            }

            WriteBody(md, title, response);
        }
    }

    /// <summary>Request o respuesta: título, content type, campos y ejemplo.</summary>
    private static void WriteBody(Md md, string title, JsonElement body)
    {
        md.Line(Text(body, "contentType") is { Length: > 0 } contentType
            ? $"{title} · {MarkdownText.Code(contentType)}"
            : title);
        md.Blank();
        var fields = Items(body, "fields");
        if (fields.Count > 0)
        {
            md.Line("| Campo | Tipo | Obligatorio | Descripción | Ejemplo |");
            md.Line("| --- | --- | --- | --- | --- |");
            foreach (var f in fields)
            {
                md.Line(
                    $"| {CodeCell(Text(f, "name"))} | {Cell(Text(f, "type"))} | {YesNo(f, "required")} | " +
                    $"{Cell(Text(f, "description"))} | {CodeCell(Text(f, "example"))} |");
            }

            md.Blank();
        }

        if (Text(body, "example") is { Length: > 0 } example)
        {
            md.Line(MarkdownText.CodeBlock(example));
            md.Blank();
        }
    }

    /// <summary>Estructura de una base: motor, base, schemas y tablas con campos y relaciones (criterio 14).</summary>
    private static void WriteDatabase(Md md, JsonElement database)
    {
        var facts = new List<string>();
        if (Text(database, "engine") is { Length: > 0 } engine)
        {
            facts.Add($"Motor: {MarkdownText.Inline(engine)}");
        }

        if (Text(database, "name") is { Length: > 0 } name)
        {
            facts.Add($"Base: {MarkdownText.Code(name)}");
        }

        var schemas = Strings(database, "schemas");
        if (schemas.Count > 0)
        {
            facts.Add("Schemas: " + string.Join(", ", schemas.Select(MarkdownText.Code)));
        }

        if (facts.Count > 0)
        {
            md.Line(string.Join(" · ", facts));
            md.Blank();
        }

        foreach (var table in Items(database, "tables"))
        {
            var tableName = Text(table, "name") ?? string.Empty;
            var fullName = Text(table, "schema") is { Length: > 0 } schema ? $"{schema}.{tableName}" : tableName;
            var kind = Text(table, "kind") ?? "table";
            var title = $"**{TableKinds.GetValueOrDefault(kind, kind)}** {MarkdownText.Code(fullName)}";
            if (Text(table, "description") is { Length: > 0 } description)
            {
                title += $" — {MarkdownText.Inline(description)}";
            }

            md.Line(title);
            md.Blank();
            var fields = Items(table, "fields");
            if (fields.Count > 0)
            {
                md.Line("| Campo | Tipo | Clave | Nulo | Descripción |");
                md.Line("| --- | --- | --- | --- | --- |");
                foreach (var f in fields)
                {
                    var key = Text(f, "key");
                    md.Line(
                        $"| {CodeCell(Text(f, "name"))} | {Cell(Text(f, "type"))} | " +
                        $"{(key is null ? string.Empty : Keys.GetValueOrDefault(key, key))} | {YesNo(f, "nullable")} | " +
                        $"{Cell(Text(f, "description"))} |");
                }

                md.Blank();
            }

            var relations = Items(table, "relations");
            foreach (var r in relations)
            {
                var line = $"- {MarkdownText.Code(Text(r, "field") ?? string.Empty)} → {MarkdownText.Code(Text(r, "references") ?? string.Empty)}";
                if (Text(r, "description") is { Length: > 0 } relationNote)
                {
                    line += $": {MarkdownText.Inline(relationNote)}";
                }

                md.Line(line);
            }

            if (relations.Count > 0)
            {
                md.Blank();
            }
        }
    }

    /// <summary>Notas, acceso a datos y ejemplo de una conexión, debajo de su línea (criterio 15).</summary>
    private static void WriteEdgeDetail(Md md, ExportEdge edge)
    {
        var json = edge.Json;
        if (json.TryGetProperty("request", out var request) && request.TryGetProperty("params", out var parameters))
        {
            foreach (var parameter in parameters.EnumerateArray())
            {
                var value = Text(parameter, "value") is { Length: > 0 } v ? $" = {MarkdownText.Code(v)}" : string.Empty;
                md.Line($"  - Parámetro ({Text(parameter, "in")}): {MarkdownText.Code(Text(parameter, "name") ?? string.Empty)}{value}");
            }
        }

        if (Text(json, "outcome") is { Length: > 0 } outcome)
        {
            md.Line($"  - Después: {MarkdownText.Indent(MarkdownText.Block(outcome), 4)}");
        }

        if (json.TryGetProperty("data", out var data))
        {
            var operation = Text(data, "operation") switch
            {
                "read" => "lee",
                "write" => "escribe",
                _ => "accede a",
            };
            var entities = Strings(data, "entities");
            md.Line(entities.Count > 0
                ? $"  - Datos: {operation} {string.Join(", ", entities.Select(MarkdownText.Code))}"
                : $"  - Datos: {operation}");
        }

        if (Text(json, "notes") is { Length: > 0 } notes)
        {
            md.Line($"  - Notas: {MarkdownText.Indent(MarkdownText.Block(notes), 4)}");
        }

        if (Text(json, "example") is { Length: > 0 } example)
        {
            md.Line("  - Ejemplo:");
            md.Blank();
            md.Line("    " + MarkdownText.Indent(MarkdownText.CodeBlock(example), 4));
            md.Blank();
        }
    }

    /// <summary>Grupos de infraestructura con sus nodos (criterios 18 a 20).</summary>
    private static void WriteGroups(Md md, List<ExportGroup> groups)
    {
        md.Line("## Grupos");
        md.Blank();
        foreach (var group in groups)
        {
            md.Line($"### {MarkdownText.Inline(group.Title)} ({GroupLabel(group)})");
            md.Blank();
            var parent = group.ParentId is null ? null : groups.Find(g => g.Id == group.ParentId);
            if (parent is not null)
            {
                md.Line($"Dentro de **{MarkdownText.Inline(parent.Title)}**.");
                md.Blank();
            }

            if (group.Members.Count == 0)
            {
                md.Line("Sin nodos.");
            }

            foreach (var member in group.Members)
            {
                md.Line($"- {MarkdownText.Inline(member.Title)} ({SectionLabel(member.Section)})");
            }

            md.Blank();
        }
    }

    private static string GroupLabel(ExportGroup group) => GroupKinds.GetValueOrDefault(group.Kind, group.Kind);

    private static string Cell(string? text) => text is null ? string.Empty : MarkdownText.Inline(text);

    /// <summary>Código dentro de una celda: en GitHub un <c>|</c> corta la tabla aunque esté entre comillas invertidas.</summary>
    private static string CodeCell(string? text) =>
        string.IsNullOrEmpty(text) ? string.Empty : MarkdownText.Code(text).Replace("|", "\\|", StringComparison.Ordinal);

    private static string YesNo(JsonElement json, string property) =>
        json.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.True ? "Sí" : "No";

    private static List<JsonElement> Items(JsonElement json, string property) =>
        json.TryGetProperty(property, out var list) && list.ValueKind == JsonValueKind.Array ? [.. list.EnumerateArray()] : [];

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

    /// <summary>
    /// "navega: Buscar [200]": tipo, etiqueta y condición. Una rama de decisión lleva la etiqueta de su salida en
    /// vez del genérico "usa" ("Sí"), una respuesta su código ("responde 201") y una solicitud sin etiqueta, su
    /// endpoint ("llama: POST /usuarios").
    /// </summary>
    private static string EdgeLabel(ExportEdge edge)
    {
        var kind = EdgeKinds.GetValueOrDefault(edge.Kind, edge.Kind);
        var text = BranchLabel(edge) is { } branch ? (edge.Kind == "uses" ? branch : $"{branch} · {kind}") : kind;
        if (edge.Kind == "response" && edge.Json.TryGetProperty("status", out var status) && status.TryGetInt32(out var code))
        {
            text += string.Create(CultureInfo.InvariantCulture, $" {code}");
        }

        if (!string.IsNullOrWhiteSpace(edge.Label))
        {
            text += $": {edge.Label}";
        }
        else if (edge.Kind == "request" && Endpoint(edge) is { Length: > 0 } endpoint)
        {
            text += $": {endpoint}";
        }

        if (!string.IsNullOrWhiteSpace(edge.When))
        {
            text += $" [{edge.When}]";
        }

        return text;
    }

    /// <summary>Etiqueta de la salida de la decisión de origen a la que corresponde la conexión.</summary>
    private static string? BranchLabel(ExportEdge edge)
    {
        if (Text(edge.Json, "branch") is not { } id || !edge.From.Json.TryGetProperty("branches", out var branches))
        {
            return null;
        }

        return branches.EnumerateArray()
            .Where(b => Text(b, "id") == id)
            .Select(b => Text(b, "label"))
            .FirstOrDefault();
    }

    /// <summary>"POST /ruta" de una solicitud: lo propio del paso o, si falta, el contrato de la API destino.</summary>
    private static string Endpoint(ExportEdge edge)
    {
        var own = edge.Json.TryGetProperty("request", out var r) && r.ValueKind == JsonValueKind.Object ? r : default;
        var method = (own.ValueKind == JsonValueKind.Object ? Text(own, "method") : null) ?? edge.To.Method;
        var path = (own.ValueKind == JsonValueKind.Object ? Text(own, "path") : null) ?? edge.To.Path;
        return string.Join(' ', new[] { method, path }.Where(p => !string.IsNullOrWhiteSpace(p)));
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
            FromCatalog: false, json, Key: string.Empty)
        {
            Http = http.ValueKind == JsonValueKind.Object ? http : null,
            Database = json.TryGetProperty("database", out var d) && d.ValueKind == JsonValueKind.Object ? d : null,
        };

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
                Http = item.Http,
                Database = item.Database,
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
                e.GetProperty("id").GetString()!,
                e))
            .OrderBy(e => e.From.Key.Length).ThenBy(e => e.From.Key, StringComparer.Ordinal)
            .ThenBy(e => e.To.Key.Length).ThenBy(e => e.To.Key, StringComparer.Ordinal)
            .ThenBy(e => e.Id, StringComparer.Ordinal)
            .ToList();

    /// <summary>Textos de las notas adhesivas (anotaciones del lienzo), en orden de id; las vacías no salen.</summary>
    private static List<string> ReadStickyNotes(JsonElement graph) =>
        graph.TryGetProperty("stickyNotes", out var notes)
            ? [.. notes.EnumerateObject()
                .OrderBy(n => n.Name, StringComparer.Ordinal)
                .Select(n => Text(n.Value, "text"))
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t!)]
            : [];

    /// <summary>
    /// Tours y recorridos: un paso de nodo se lee por su título; uno de conexión, como «Origen → Destino (llama)» en su
    /// sentido real; uno cuya conexión se eliminó, marcado como tal. Pasos a nodos que no existen no salen.
    /// </summary>
    private static List<ExportTour> ReadTours(JsonElement graph, Dictionary<string, ExportNode> nodes)
    {
        if (!graph.TryGetProperty("tours", out var tours))
        {
            return [];
        }

        var edges = graph.GetProperty("edges");
        string Title(string? id) => id is not null && nodes.TryGetValue(id, out var node) ? node.Title : "(eliminado)";
        string Route(JsonElement edge)
        {
            var kind = edge.GetProperty("kind").GetString()!;
            var label = Text(edge, "label");
            var verb = EdgeKinds.GetValueOrDefault(kind, kind) + (label is null ? string.Empty : $" · {label}");
            return $"{Title(edge.GetProperty("from").GetString())} → {Title(edge.GetProperty("to").GetString())} ({verb})";
        }

        string? StepTitle(JsonElement step)
        {
            if (step.TryGetProperty("nodeId", out var nodeId))
            {
                return nodes.TryGetValue(nodeId.GetString()!, out var node) ? node.Title : null;
            }

            if (step.TryGetProperty("edgeId", out var edgeId))
            {
                return edges.TryGetProperty(edgeId.GetString()!, out var edge) ? Route(edge) : null;
            }

            return step.TryGetProperty("removedEdge", out var removed) ? "Conexión eliminada: " + Route(removed) : null;
        }

        return tours.EnumerateObject()
            .Select(p => p.Value)
            .Select(t => new ExportTour(
                t.GetProperty("id").GetString()!,
                t.GetProperty("name").GetString()!,
                [.. t.GetProperty("steps").EnumerateArray()
                    .Select(s => (Title: StepTitle(s), Note: Text(s, "note")))
                    .Where(s => s.Title is not null)
                    .Select(s => (s.Title!, s.Note))],
                IsFlow(t)))
            .OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Name, StringComparer.Ordinal)
            .ThenBy(t => t.Id, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Grupos por título e id; sus nodos en el orden del documento.</summary>
    private static List<ExportGroup> ReadGroups(JsonElement graph, List<ExportNode> nodes)
    {
        if (!graph.TryGetProperty("groups", out var groups))
        {
            return [];
        }

        var list = groups.EnumerateObject()
            .Select(p => p.Value)
            .Select(g => new ExportGroup(
                g.GetProperty("id").GetString()!,
                g.GetProperty("title").GetString()!,
                g.GetProperty("kind").GetString()!,
                [.. nodes.Where(n => n.String("groupId") == g.GetProperty("id").GetString())],
                Key: string.Empty,
                ParentId: Text(g, "parentId")))
            .OrderBy(g => g.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(g => g.Title, StringComparer.Ordinal)
            .ThenBy(g => g.Id, StringComparer.Ordinal)
            .ToList();
        return [.. list.Select((g, i) => g with { Key = string.Create(CultureInfo.InvariantCulture, $"g{i + 1}") })];
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
        /// <summary>Contrato (del nodo o de su elemento del catálogo).</summary>
        public JsonElement? Http { get; init; }

        /// <summary>Estructura (del nodo o de su elemento del catálogo).</summary>
        public JsonElement? Database { get; init; }

        public string? String(string property) => Text(Json, property);
    }

    private sealed record ExportEdge(
        ExportNode From, ExportNode To, string Kind, string? Label, string? When, string Id, JsonElement Json);

    private sealed record ExportGroup(
        string Id, string Title, string Kind, List<ExportNode> Members, string Key, string? ParentId = null);

    private sealed record ExportTour(string Id, string Name, List<(string Title, string? Note)> Steps, bool IsFlow);

    /// <summary>Recorrido: <c>kind</c> = <c>flow</c> o, sin <c>kind</c> (lienzos anteriores), algún paso de conexión.</summary>
    private static bool IsFlow(JsonElement tour) =>
        tour.TryGetProperty("kind", out var kind)
            ? kind.GetString() == "flow"
            : tour.GetProperty("steps").EnumerateArray()
                .Any(s => s.TryGetProperty("edgeId", out _) || s.TryGetProperty("removedEdge", out _));

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
