using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.Modules.Export.Features;

/// <summary>Lo que necesita el contexto para IA: la feature (con su propósito), el grafo guardado y sus referencias.</summary>
internal sealed record AiContextInput(
    Guid FeatureId,
    string AppName,
    string FeatureName,
    string? Description,
    JsonElement Graph,
    IReadOnlyDictionary<Guid, CatalogItemResponse> Catalog,
    IReadOnlyDictionary<Guid, string> FeatureNames,
    DateTimeOffset ExportedAt);

/// <summary>
/// Contexto para IA (spec exportar-e-importar, tarea 1): un modelo que se escribe como JSON
/// (<c>packages/schema/walkie-ai-context.schema.json</c>) y como Markdown. Los dos salen del mismo modelo, que se arma
/// con los mismos lectores del grafo que el export Markdown: dicen lo mismo y con el mismo orden estable.
/// </summary>
internal static partial class MarkdownDocument
{
    private static readonly JsonSerializerOptions AiJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        // Acentos y signos tal cual: el JSON se lee (y se le pasa a un modelo de lenguaje) como texto.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Orden de los vacíos en el documento (el del <c>enum</c> del schema).</summary>
    private static readonly string[] GapKinds =
    [
        "api-without-contract",
        "api-without-responses",
        "request-without-response",
        "response-without-status",
        "isolated-node",
        "branch-without-target",
        "broken-flow-step",
        "missing-catalog-item",
        "portal-without-target",
        "database-without-structure",
    ];

    public static string AiContextJson(AiContext context) => JsonSerializer.Serialize(context, AiJson) + "\n";

    public static AiContext BuildAiContext(AiContextInput input)
    {
        var export = new ExportInput(
            input.AppName, input.FeatureName, input.Graph, input.Catalog, input.FeatureNames,
            new Dictionary<Guid, string>(), input.ExportedAt);
        var nodes = ReadNodes(export);
        var byId = nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
        var edges = ReadEdges(input.Graph, byId);
        var groups = ReadGroups(input.Graph, nodes);
        var groupPath = GroupPaths(groups);
        var flows = ReadAiFlows(input.Graph, byId, edges);

        var components = nodes.Select(n => new AiComponent(
            n.Id,
            n.Section,
            AiKind(n),
            n.Title,
            Blank(n.Description),
            Blank(n.String("notes")),
            n.String("groupId") is { } g && groupPath.TryGetValue(g, out var path) ? path : null,
            n.FromCatalog ? n.String("catalogId") : null,
            n.Http,
            n.Database,
            n.Resource,
            n.Section == "service" ? n.Runtime : null,
            n.Section == "rule" ? Blank(n.String("expression")) : null,
            n.Section == "screen" && Inputs(n) is { Count: > 0 } inputs
                ? [.. inputs.Select(i => new AiInput(
                    i.Name, i.Type, i.Required ? true : null, i.Options.Count > 0 ? i.Options : null,
                    i.RuleIds.Count > 0 ? [.. i.RuleIds.Select(r => byId.TryGetValue(r, out var rule) ? rule.Title : r)] : null))]
                : null)
        {
            TargetFeature = n.Section == "portal" ? TargetFeature(n, input.FeatureNames) : null,
            IsPortal = n.Section == "portal",
        }).ToList();

        var glossary = components
            .Select(c => new AiTerm(c.Title, c.Is, c.Description))
            .Concat(groups.Select(g => new AiTerm(g.Title, $"Grupo ({GroupLabel(g)})", null)))
            .Concat(flows.Select(f => new AiTerm(f.Name, f.Kind == "flow" ? "Recorrido" : "Tour", null)))
            .DistinctBy(t => (t.Term, t.Is))
            .OrderBy(t => t.Term, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Term, StringComparer.Ordinal)
            .ThenBy(t => t.Is, StringComparer.Ordinal)
            .ToList();

        var connections = edges.Select(e => new AiConnection(
            e.Id,
            e.From.Id,
            e.To.Id,
            e.Kind,
            EdgeText(e, s => s),
            Blank(e.Label),
            Blank(e.When),
            BranchLabel(e),
            e.Json.TryGetProperty("status", out var status) && status.TryGetInt32(out var code) ? code : null,
            Text(e.Json, "replyTo"),
            Blank(Text(e.Json, "outcome")),
            Blank(Text(e.Json, "notes")))).ToList();

        var rules = nodes
            .Where(n => n.Section == "rule" && n.String("mode") != "decision")
            .Select(rule => new AiRule(
                rule.Id,
                rule.Title,
                Blank(rule.String("expression")),
                [.. nodes.Where(n => n.Section == "screen")
                    .SelectMany(screen => Inputs(screen)
                        .Where(i => i.RuleIds.Contains(rule.Id, StringComparer.Ordinal))
                        .Select(i => new AiValidated(screen.Title, i.Name)))]))
            .ToList();

        var decisions = nodes
            .Where(n => n.Section == "rule" && n.String("mode") == "decision")
            .Select(d => new AiDecision(
                d.Id,
                d.Title,
                Blank(d.String("expression")),
                [.. Branches(d).Select(b => new AiBranch(
                    b.Label,
                    [.. edges.Where(e => e.From.Id == d.Id && Text(e.Json, "branch") == b.Id).Select(e => e.To.Title)]))]))
            .ToList();

        var relations = new AiRelations(
            [.. nodes.Where(n => n.Section == "portal").Select(p => new AiPortal(p.Title, TargetFeature(p, input.FeatureNames)))],
            [.. nodes.Where(n => n.FromCatalog)
                .Select(n => new AiShared(n.String("catalogId")!, n.Title, n.Section))
                .DistinctBy(s => s.CatalogId)]);

        return new AiContext(
            "walkie-ai-context",
            0,
            new AiApp(input.AppName),
            new AiFeature(input.FeatureId, input.FeatureName, Blank(input.Description)),
            input.ExportedAt,
            Version(input.Graph),
            glossary,
            components,
            connections,
            flows,
            rules,
            decisions,
            relations,
            Gaps(nodes, edges, flows, input.FeatureNames));
    }

    /// <summary>El contexto como Markdown: primero el propósito, el glosario y los componentes; al final, los vacíos.</summary>
    public static string RenderAiContext(AiContext c) => RenderAiContext(c, new Md(), 0).ToString();

    /// <summary>
    /// Escribe el contexto de una feature en <paramref name="md"/>. Con <paramref name="depth"/> 1 va dentro del
    /// contexto de la app: sus títulos bajan un nivel y no lleva la nota de introducción (ya la tiene la app).
    /// </summary>
    private static Md RenderAiContext(AiContext c, Md md, int depth)
    {
        md.Line(depth == 0
            ? $"# Contexto para IA: {MarkdownText.Inline(c.Feature.Name)}"
            : $"{H(1, depth)}Feature: {MarkdownText.Inline(c.Feature.Name)}");
        md.Blank();
        if (depth == 0)
        {
            md.Line(string.Create(CultureInfo.InvariantCulture,
            $"> Documento generado por Walkie para dar contexto a un asistente de IA antes de construir. Describe la feature tal como está documentada (versión {c.CanvasVersion} del lienzo, exportado el {c.ExportedAt.UtcDateTime:yyyy-MM-dd HH:mm} UTC). Si algo no está aquí, pregunta en vez de suponer: la sección «Vacíos detectados» lista lo que falta documentar."));
            md.Blank();
        }

        md.Line($"{H(2, depth)}Propósito");
        md.Blank();
        md.Line($"App: **{MarkdownText.Inline(c.App.Name)}** · Feature: **{MarkdownText.Inline(c.Feature.Name)}**");
        md.Blank();
        md.Line(c.Feature.Description is { } purpose
            ? MarkdownText.Block(purpose)
            : "La feature no tiene descripción en Walkie: pregunta su objetivo antes de construir.");
        md.Blank();

        if (c.Components.Count == 0)
        {
            md.Line("El lienzo está vacío: no hay nada documentado todavía.");
            md.Blank();
            return md;
        }

        md.Line($"{H(2, depth)}Glosario");
        md.Blank();
        foreach (var term in c.Glossary)
        {
            md.Line($"- **{MarkdownText.Inline(term.Term)}**: {MarkdownText.Inline(term.Is)}"
                + (term.Description is { } d ? $" — {MarkdownText.Inline(d)}" : string.Empty));
        }

        md.Blank();
        md.Line($"{H(2, depth)}Componentes");
        md.Blank();
        md.Line("Cada caja del lienzo con su id estable (`id`), que usan las conexiones y los flujos.");
        md.Blank();
        foreach (var component in c.Components)
        {
            WriteAiComponent(md, component, depth);
        }

        if (c.Connections.Count > 0)
        {
            md.Line($"{H(2, depth)}Conexiones");
            md.Blank();
            foreach (var e in c.Connections)
            {
                var extra = new[] { e.Outcome is { } o ? $"después: {o}" : null, e.Notes }.Where(x => x is not null);
                md.Line($"- {MarkdownText.Inline(e.Text)} · {MarkdownText.Code(e.Id)}"
                    + string.Concat(extra.Select(x => $" — {MarkdownText.Inline(x!)}")));
            }

            md.Blank();
        }

        WriteAiFlows(md, "Recorridos (flujos de punta a punta)", [.. c.Flows.Where(f => f.Kind == "flow")], depth);
        WriteAiFlows(md, "Tours (cómo se presenta la feature)", [.. c.Flows.Where(f => f.Kind == "guide")], depth);

        if (c.Rules.Count > 0)
        {
            md.Line($"{H(2, depth)}Reglas de negocio");
            md.Blank();
            foreach (var rule in c.Rules)
            {
                md.Line($"{H(3, depth)}{MarkdownText.Inline(rule.Title)}");
                md.Blank();
                if (rule.Expression is { } expression)
                {
                    md.Line(MarkdownText.CodeBlock(expression));
                    md.Blank();
                }

                md.Line(rule.Validates.Count == 0
                    ? "No valida ningún input."
                    : "Valida: " + string.Join(", ", rule.Validates.Select(v =>
                        $"{MarkdownText.Code(v.Input)} ({MarkdownText.Inline(v.Screen)})")));
                md.Blank();
            }
        }

        if (c.Decisions.Count > 0)
        {
            md.Line($"{H(2, depth)}Decisiones");
            md.Blank();
            foreach (var decision in c.Decisions)
            {
                md.Line($"{H(3, depth)}{MarkdownText.Inline(decision.Question)}");
                md.Blank();
                if (decision.Condition is { } condition)
                {
                    md.Line($"Evalúa: {MarkdownText.Inline(condition)}");
                    md.Blank();
                }

                foreach (var branch in decision.Branches)
                {
                    md.Line($"- **{MarkdownText.Inline(branch.Label)}** → "
                        + (branch.To.Count == 0 ? "(sin destino)" : string.Join(", ", branch.To.Select(MarkdownText.Inline))));
                }

                md.Blank();
            }
        }

        if (c.Relations.Portals.Count > 0 || c.Relations.SharedComponents.Count > 0)
        {
            md.Line($"{H(2, depth)}Relaciones");
            md.Blank();
            foreach (var portal in c.Relations.Portals)
            {
                md.Line($"- Desde **{MarkdownText.Inline(portal.From)}** se pasa a la feature "
                    + (portal.ToFeature is { } to ? $"**{MarkdownText.Inline(to)}**." : "(sin destino)."));
            }

            foreach (var shared in c.Relations.SharedComponents)
            {
                md.Line($"- **{MarkdownText.Inline(shared.Title)}** es un componente compartido del catálogo de la app "
                    + $"({MarkdownText.Code(shared.CatalogId)}): otros lienzos usan la misma definición.");
            }

            md.Blank();
        }

        md.Line($"{H(2, depth)}Vacíos detectados");
        md.Blank();
        if (c.Gaps.Count == 0)
        {
            md.Line("No se detectaron vacíos.");
        }
        else
        {
            md.Line("Lo que falta documentar. Pregunta por esto antes de construir en vez de suponerlo:");
            md.Blank();
            foreach (var gap in c.Gaps)
            {
                md.Line($"- {MarkdownText.Inline(gap.Message)}");
            }
        }

        md.Blank();
        return md;
    }

    /// <summary>Marca de título de nivel <paramref name="level"/>, bajado <paramref name="depth"/> niveles.</summary>
    private static string H(int level, int depth) => new string('#', level + depth) + " ";

    private static void WriteAiComponent(Md md, AiComponent c, int depth)
    {
        md.Line($"{H(3, depth)}{MarkdownText.Inline(c.Title)} ({MarkdownText.Inline(c.Is)})");
        md.Blank();
        var facts = new List<string> { $"id: {MarkdownText.Code(c.Id)}" };
        if (c.Group is { } group)
        {
            facts.Add($"grupo: {MarkdownText.Inline(group)}");
        }

        if (c.CatalogId is { } catalogId)
        {
            facts.Add($"componente compartido del catálogo ({MarkdownText.Code(catalogId)})");
        }

        if (c.Runtime is { } runtime)
        {
            facts.Add($"corre en: {Runtimes.GetValueOrDefault(runtime, runtime)}");
        }

        if (c.IsPortal)
        {
            facts.Add(c.TargetFeature is { } target ? $"lleva a la feature {MarkdownText.Inline(target)}" : "sin feature destino");
        }

        md.Line(string.Join(" · ", facts));
        md.Blank();
        if (c.Description is { } description)
        {
            md.Line(MarkdownText.Block(description));
            md.Blank();
        }

        if (c.Notes is { } notes)
        {
            md.Line($"**{(c.Type is "actor" or "service" ? "Responsabilidades" : "Notas")}:**  ");
            md.Line(MarkdownText.Block(notes));
            md.Blank();
        }

        if (c.Expression is { } expression)
        {
            md.Line(MarkdownText.CodeBlock(expression));
            md.Blank();
        }

        if (c.Inputs is { } inputs)
        {
            md.Line("Inputs:");
            md.Blank();
            foreach (var i in inputs)
            {
                var traits = new List<string> { i.Type };
                if (i.Required == true)
                {
                    traits.Add("obligatorio");
                }

                if (i.Options is { } options)
                {
                    traits.Add("opciones: " + string.Join(", ", options));
                }

                if (i.Rules is { } rules)
                {
                    traits.Add("validado por: " + string.Join(", ", rules));
                }

                md.Line($"- {MarkdownText.Code(i.Name)} ({MarkdownText.Inline(string.Join("; ", traits))})");
            }

            md.Blank();
        }

        // El detalle técnico va como JSON: así se lee completo y sin ambigüedad (contrato, estructura o recurso).
        foreach (var (title, value) in new[] { ("Contrato", c.Http), ("Estructura", c.Database), ("Recurso", c.Resource) })
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

    private static void WriteAiFlows(Md md, string heading, List<AiFlow> flows, int depth)
    {
        if (flows.Count == 0)
        {
            return;
        }

        md.Line($"{H(2, depth)}{heading}");
        md.Blank();
        foreach (var flow in flows)
        {
            md.Line($"{H(3, depth)}{MarkdownText.Inline(flow.Name)}");
            md.Blank();
            if (flow.Steps.Count == 0)
            {
                md.Line("Sin pasos.");
            }

            foreach (var step in flow.Steps)
            {
                md.Line(string.Create(CultureInfo.InvariantCulture, $"{step.N}. {MarkdownText.Inline(step.Text)}")
                    + (step.Note is { } note ? $" — {MarkdownText.Inline(note)}" : string.Empty));
            }

            md.Blank();
        }
    }

    /// <summary>Qué es una caja: su tipo, el subtipo de un recurso o «Decisión».</summary>
    private static string AiKind(ExportNode node) =>
        node.Section == "rule" && node.String("mode") == "decision" ? "Decisión" : KindLabel(node);

    private static string? TargetFeature(ExportNode portal, IReadOnlyDictionary<Guid, string> names) =>
        Guid.TryParse(portal.String("targetFeatureId"), out var id) && names.TryGetValue(id, out var name) ? name : null;

    private static string? Blank(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;

    private static List<(string Id, string Label)> Branches(ExportNode decision) =>
        decision.Json.TryGetProperty("branches", out var branches)
            ? [.. branches.EnumerateArray().Select(b => (Text(b, "id")!, Text(b, "label")!))]
            : [];

    /// <summary>Ruta de cada grupo desde el de más afuera («AWS › Pagos»).</summary>
    private static Dictionary<string, string> GroupPaths(List<ExportGroup> groups)
    {
        var byId = groups.ToDictionary(g => g.Id, StringComparer.Ordinal);
        string PathOf(ExportGroup group, int depth) =>
            depth < 32 && group.ParentId is { } parent && byId.TryGetValue(parent, out var outer)
                ? $"{PathOf(outer, depth + 1)} › {group.Title}"
                : group.Title;
        return groups.ToDictionary(g => g.Id, g => PathOf(g, 0), StringComparer.Ordinal);
    }

    /// <summary>Tours y recorridos con todos sus pasos (también los rotos, marcados), por nombre e id.</summary>
    private static List<AiFlow> ReadAiFlows(JsonElement graph, Dictionary<string, ExportNode> nodes, List<ExportEdge> edges)
    {
        if (!graph.TryGetProperty("tours", out var tours))
        {
            return [];
        }

        var edgeById = edges.ToDictionary(e => e.Id, StringComparer.Ordinal);
        string Title(string? id) => id is not null && nodes.TryGetValue(id, out var node) ? node.Title : "(caja eliminada)";

        AiStep Step(JsonElement step, int n)
        {
            var note = Blank(Text(step, "note"));
            if (Text(step, "nodeId") is { } nodeId)
            {
                return nodes.TryGetValue(nodeId, out var node)
                    ? new AiStep(n, node.Title, nodeId, null, note, null)
                    : new AiStep(n, "(caja eliminada)", nodeId, null, note, true);
            }

            if (Text(step, "edgeId") is { } edgeId)
            {
                return edgeById.TryGetValue(edgeId, out var edge)
                    ? new AiStep(n, EdgeText(edge, s => s), null, edgeId, note, null)
                    : new AiStep(n, "(conexión eliminada)", null, edgeId, note, true);
            }

            var removed = step.GetProperty("removedEdge");
            var kind = removed.GetProperty("kind").GetString()!;
            return new AiStep(
                n,
                $"Conexión eliminada: {Title(Text(removed, "from"))} → {Title(Text(removed, "to"))} ({EdgeKinds.GetValueOrDefault(kind, kind)})",
                null, null, note, true);
        }

        return tours.EnumerateObject()
            .Select(p => p.Value)
            .Select(t => new AiFlow(
                t.GetProperty("id").GetString()!,
                t.GetProperty("name").GetString()!,
                IsFlow(t) ? "flow" : "guide",
                [.. t.GetProperty("steps").EnumerateArray().Select((s, i) => Step(s, i + 1))]))
            .OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Name, StringComparer.Ordinal)
            .ThenBy(t => t.Id, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Lo que falta documentar, en el orden de <see cref="GapKinds"/> y luego el del documento.</summary>
    private static List<AiGap> Gaps(
        List<ExportNode> nodes, List<ExportEdge> edges, List<AiFlow> flows, IReadOnlyDictionary<Guid, string> featureNames)
    {
        var gaps = new List<AiGap>();
        string Q(string text) => $"«{text}»";

        foreach (var api in nodes.Where(n => n.Section == "api"))
        {
            var http = api.Http is { ValueKind: JsonValueKind.Object } h ? h : default;
            if (api.Method is null && api.Path is null)
            {
                gaps.Add(new AiGap("api-without-contract", api.Id, $"La API {Q(api.Title)} no tiene método ni ruta."));
            }

            if (http.ValueKind != JsonValueKind.Object || !http.TryGetProperty("responses", out var responses)
                || responses.GetArrayLength() == 0)
            {
                gaps.Add(new AiGap("api-without-responses", api.Id,
                    $"La API {Q(api.Title)} no documenta sus respuestas (códigos, cuerpo y errores)."));
            }
        }

        foreach (var request in edges.Where(e => e.Kind == "request"))
        {
            if (!edges.Any(e => e.Kind == "response" && Text(e.Json, "replyTo") == request.Id))
            {
                gaps.Add(new AiGap("request-without-response", request.Id,
                    $"La solicitud {Q(EdgeText(request, s => s))} no tiene respuesta documentada."));
            }
        }

        foreach (var response in edges.Where(e => e.Kind == "response" && !e.Json.TryGetProperty("status", out _)))
        {
            gaps.Add(new AiGap("response-without-status", response.Id,
                $"La respuesta {Q(EdgeText(response, s => s))} no tiene código HTTP."));
        }

        foreach (var node in nodes.Where(n => !edges.Any(e => e.From.Id == n.Id || e.To.Id == n.Id)))
        {
            gaps.Add(new AiGap("isolated-node", node.Id, $"{Q(node.Title)} ({AiKind(node)}) no tiene conexiones."));
        }

        foreach (var decision in nodes.Where(n => n.Section == "rule" && n.String("mode") == "decision"))
        {
            foreach (var (id, label) in Branches(decision).Where(b =>
                         !edges.Any(e => e.From.Id == decision.Id && Text(e.Json, "branch") == b.Id)))
            {
                gaps.Add(new AiGap("branch-without-target", decision.Id,
                    $"La salida {Q(label)} de la decisión {Q(decision.Title)} no lleva a ningún lado."));
            }
        }

        foreach (var flow in flows)
        {
            foreach (var step in flow.Steps.Where(s => s.Broken == true))
            {
                gaps.Add(new AiGap("broken-flow-step", step.EdgeId ?? step.NodeId,
                    string.Create(CultureInfo.InvariantCulture,
                        $"El paso {step.N} de {Q(flow.Name)} apunta a algo que ya no existe en el lienzo.")));
            }
        }

        foreach (var missing in nodes.Where(n => n.Section == "ref"))
        {
            gaps.Add(new AiGap("missing-catalog-item", missing.Id,
                $"{Q(missing.Title)} usa un componente del catálogo que ya no existe."));
        }

        foreach (var portal in nodes.Where(n => n.Section == "portal" && TargetFeature(n, featureNames) is null))
        {
            gaps.Add(new AiGap("portal-without-target", portal.Id,
                $"El portal {Q(portal.Title)} no lleva a ninguna feature existente."));
        }

        foreach (var database in nodes.Where(n => n.Section == "database"))
        {
            if (database.Database is not { ValueKind: JsonValueKind.Object } db || !db.TryGetProperty("tables", out var tables)
                || tables.GetArrayLength() == 0)
            {
                gaps.Add(new AiGap("database-without-structure", database.Id,
                    $"La base de datos {Q(database.Title)} no documenta sus tablas o colecciones."));
            }
        }

        // Estable: por tipo de vacío y, dentro de cada tipo, en el orden en que se encontraron.
        return [.. gaps.Select((g, i) => (g, i)).OrderBy(x => Array.IndexOf(GapKinds, x.g.Kind)).ThenBy(x => x.i).Select(x => x.g)];
    }
}

internal sealed record AiContext(
    string Format,
    int FormatVersion,
    AiApp App,
    AiFeature Feature,
    DateTimeOffset ExportedAt,
    int CanvasVersion,
    IReadOnlyList<AiTerm> Glossary,
    IReadOnlyList<AiComponent> Components,
    IReadOnlyList<AiConnection> Connections,
    IReadOnlyList<AiFlow> Flows,
    IReadOnlyList<AiRule> Rules,
    IReadOnlyList<AiDecision> Decisions,
    AiRelations Relations,
    IReadOnlyList<AiGap> Gaps);

internal sealed record AiApp(string Name);

internal sealed record AiFeature(
    Guid Id,
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description);

internal sealed record AiTerm(
    string Term,
    string Is,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description);

internal sealed record AiComponent(
    string Id,
    string Type,
    string Is,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Notes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Group,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? CatalogId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Http,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Database,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Resource,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Runtime,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Expression,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<AiInput>? Inputs)
{
    /// <summary>Portal: nombre actual de la feature destino (sin destino, no va: lo dice «Vacíos detectados»).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TargetFeature { get; init; }

    /// <summary>Es un portal (el Markdown dice «sin feature destino» si no la tiene).</summary>
    [JsonIgnore]
    public bool IsPortal { get; init; }
}

internal sealed record AiInput(
    string Name,
    string Type,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Required,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Options,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Rules);

internal sealed record AiConnection(
    string Id,
    string From,
    string To,
    string Kind,
    string Text,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Label,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? When,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Branch,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReplyTo,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Outcome,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Notes);

internal sealed record AiFlow(string Id, string Name, string Kind, IReadOnlyList<AiStep> Steps);

internal sealed record AiStep(
    int N,
    string Text,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? NodeId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EdgeId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Broken);

internal sealed record AiRule(
    string Id,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Expression,
    IReadOnlyList<AiValidated> Validates);

internal sealed record AiValidated(string Screen, string Input);

internal sealed record AiDecision(
    string Id,
    string Question,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Condition,
    IReadOnlyList<AiBranch> Branches);

internal sealed record AiBranch(string Label, IReadOnlyList<string> To);

internal sealed record AiRelations(IReadOnlyList<AiPortal> Portals, IReadOnlyList<AiShared> SharedComponents);

internal sealed record AiPortal(string From, string? ToFeature);

internal sealed record AiShared(string CatalogId, string Title, string Type);

internal sealed record AiGap(
    string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ElementId,
    string Message);
