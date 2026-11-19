using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Shared;

namespace Walkie.Modules.Discovery.Features;

/// <summary>Una decisión activa sobre un hallazgo, lo que el borrador necesita de ella.</summary>
internal sealed record DraftDecision(string Decision, string? TargetKind, Guid? TargetId);

/// <summary>Una interfaz de un módulo existente cuya caja es un <c>ref</c> a un elemento del catálogo.</summary>
internal sealed record ModuleInterface(Guid ModuleId, string ModuleName, string InterfaceId, string InterfaceName);

/// <summary>Una relación del análisis que el borrador puede dibujar.</summary>
internal sealed record DraftRelation(string Key, string Kind, string From, string To);

/// <summary>
/// Lo que hace falta para armar el lienzo inicial, ya leído de la base: hallazgos, relaciones, decisiones de la fuente,
/// lo que esta misma solicitud crea en el catálogo, el catálogo vivo, las APIs ambiguas y las interfaces de los módulos.
/// </summary>
internal sealed record DraftContext(
    IReadOnlyDictionary<string, JsonElement> Entities,
    IReadOnlyList<DraftRelation> Relations,
    IReadOnlyDictionary<string, DraftDecision> Decisions,
    IReadOnlyDictionary<string, (Guid Id, string Title)> PlannedCatalog,
    IReadOnlyDictionary<Guid, string> Catalog,
    IReadOnlyDictionary<string, IReadOnlyList<string>> AmbiguousApis,
    IReadOnlyDictionary<Guid, IReadOnlyList<ModuleInterface>> ModuleInterfaces);

/// <summary>Los ids (UUID v7 del cliente) y las posiciones que manda la persona para cada clave del borrador.</summary>
internal sealed record CanvasInput(
    IReadOnlyDictionary<string, Guid> Nodes,
    IReadOnlyDictionary<string, Guid> Edges,
    IReadOnlyDictionary<string, Guid> Interfaces,
    IReadOnlyDictionary<string, (double X, double Y)> Layout)
{
    public static CanvasInput Read(JsonElement canvas)
    {
        static Dictionary<string, Guid> Ids(JsonElement parent, string name) =>
            parent.TryGetProperty(name, out var map)
                ? map.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetGuid(), StringComparer.Ordinal)
                : new Dictionary<string, Guid>(StringComparer.Ordinal);

        return new CanvasInput(
            Ids(canvas, "nodes"),
            Ids(canvas, "edges"),
            Ids(canvas, "interfaces"),
            canvas.GetProperty("layout").EnumerateObject()
                .ToDictionary(p => p.Name, p => (p.Value.GetProperty("x").GetDouble(), p.Value.GetProperty("y").GetDouble()), StringComparer.Ordinal));
    }
}

/// <summary>El borrador de un lienzo inicial, antes de tener ids y posiciones.</summary>
internal sealed record Draft(
    List<DiscoveryDraftNode> Nodes,
    List<DiscoveryDraftEdge> Edges,
    List<DiscoveryDraftInterface> Interfaces,
    List<DiscoveryDraftOmission> Omitted,
    List<string> Screens,
    List<string> Errors)
{
    public DiscoveryCanvasDraft Contract(JsonElement? graph = null) => new(Nodes, Edges, Interfaces, Omitted, graph);
}

/// <summary>
/// Lienzo inicial de un módulo o una feature que se crea desde un hallazgo (spec walkie-live, tarea 9; ADR-0012).
/// Función pura: solo dibuja lo que el análisis observó y una persona ya decidió, y dice qué deja fuera y por qué.
/// <list type="bullet">
/// <item><b>Feature:</b> sus pantallas (todas de la misma app técnica, <c>app</c>) como cajas <c>screen</c> propias; la
/// navegación observada entre ellas (<c>navigates</c>) como <c>navigation</c>; y cada llamada observada (<c>calls</c>)
/// a una API como solicitud HTTP (<c>request</c>, <c>http.request</c>) hacia el elemento del catálogo de esa API —o
/// hacia la interfaz del único módulo que la ofrece—. Sin respuestas, códigos ni pasos internos: el análisis no los ve.</item>
/// <item><b>Módulo:</b> un <c>ref</c> por cada API suya que ya está en el catálogo y, por cada una, la interfaz que el
/// análisis justificó (un endpoint declarado en el código del módulo es lo que ofrece: <c>provides</c>).</item>
/// </list>
/// Una API entra solo si ya tiene una decisión (vinculada o creada, y el elemento existe) o si esta misma solicitud la
/// crea; una coincidencia sugerida nunca se vuelve una referencia. Una API que publican varios servicios
/// (<c>ambiguous-api</c>) no se conecta desde una pantalla: no se sabe a qué backend llama.
/// </summary>
internal static class CanvasDraft
{
    /// <summary>Tamaño nominal de una caja del lienzo (el de <c>Canvas.tsx</c>), para no aceptar posiciones encimadas.</summary>
    public const double BoxWidth = 184;

    public const double BoxHeight = 72;

    private const double Gap = 8;
    private const double MaxCoordinate = 1_000_000;

    /// <summary>Clave del borrador de la caja de un módulo existente (no es un hallazgo).</summary>
    public static string ModuleNodeKey(Guid moduleId) => "walkie-module:" + moduleId.ToString();

    public static Draft Feature(JsonElement feature, DraftContext context)
    {
        var draft = new Draft([], [], [], [], [], []);
        var app = feature.TryGetProperty("app", out var scope) ? scope.GetString() : null;
        var included = new HashSet<string>(StringComparer.Ordinal);
        foreach (var key in Members(feature).Where(m => m.StartsWith("screen:", StringComparison.Ordinal)).Order(StringComparer.Ordinal))
        {
            if (!context.Entities.TryGetValue(key, out var screen))
            {
                continue;
            }

            if (!screen.TryGetProperty("app", out var screenApp) || screenApp.GetString() != app)
            {
                // Una feature nunca mezcla apps técnicas: el analizador no lo propone, y si llegara, no se adivina.
                draft.Errors.Add($"La pantalla {key} es de otra app técnica que la feature ({app}): no se mezclan.");
                continue;
            }

            if (context.Decisions.TryGetValue(key, out var decision))
            {
                draft.Omitted.Add(decision.Decision == "rejected"
                    ? new DiscoveryDraftOmission(key, "screen-rejected", "Esta pantalla se descartó en la revisión: no entra.")
                    : new DiscoveryDraftOmission(key, "screen-decided", "Esta pantalla ya entró en otra feature: no se repite."));
                continue;
            }

            included.Add(key);
            draft.Screens.Add(key);
            draft.Nodes.Add(new DiscoveryDraftNode(key, "screen", Text(screen, "title", 120) ?? key, Route: Text(screen, "route", 500)));
        }

        if (included.Count == 0)
        {
            draft.Errors.Add("No queda ninguna pantalla para su lienzo: todas se descartaron o ya están en otra feature.");
            return draft;
        }

        foreach (var relation in context.Relations.Where(r => r.Kind == "navigates" && included.Contains(r.From) && included.Contains(r.To))
                     .OrderBy(r => r.Key, StringComparer.Ordinal))
        {
            draft.Edges.Add(new DiscoveryDraftEdge(relation.Key, relation.From, relation.To, "navigation", "navigation"));
        }

        var nodes = new HashSet<string>(draft.Nodes.Select(n => n.Key), StringComparer.Ordinal);
        foreach (var relation in context.Relations.Where(r => r.Kind == "calls" && included.Contains(r.From) && r.To.StartsWith("api:", StringComparison.Ordinal))
                     .OrderBy(r => r.Key, StringComparer.Ordinal))
        {
            if (draft.Omitted.Any(o => o.Key == relation.To))
            {
                continue; // la misma API, llamada desde otra pantalla: ya se explicó
            }

            if (context.AmbiguousApis.TryGetValue(relation.To, out var services))
            {
                draft.Omitted.Add(new DiscoveryDraftOmission(relation.To, "ambiguous-api", Truncate(
                    $"{relation.To["api:".Length..]} lo publican {string.Join(", ", services.Select(s => s.StartsWith("service:", StringComparison.Ordinal) ? s["service:".Length..] : s))}: "
                    + "el análisis no sabe a cuál llaman sus pantallas, así que esas conexiones no se dibujan. Si lo sabes, agrégalas a mano en el lienzo.", 500)));
                continue;
            }

            if (ApiTarget(relation.To, context) is not { } target)
            {
                draft.Omitted.Add(Undecided(relation.To, relation.To, context));
                continue;
            }

            string nodeKey;
            DiscoveryInterfaceRef? toInterface = null;
            if (context.ModuleInterfaces.TryGetValue(target.Id, out var offered) && offered is [var only])
            {
                nodeKey = ModuleNodeKey(only.ModuleId);
                toInterface = new DiscoveryInterfaceRef(only.InterfaceId, Truncate(only.InterfaceName, 60));
                if (nodes.Add(nodeKey))
                {
                    draft.Nodes.Add(new DiscoveryDraftNode(nodeKey, "module", Truncate(only.ModuleName, 120), ModuleId: only.ModuleId));
                }
            }
            else
            {
                nodeKey = relation.To;
                if (nodes.Add(nodeKey))
                {
                    draft.Nodes.Add(new DiscoveryDraftNode(nodeKey, "ref", Truncate(target.Title, 120), CatalogId: target.Id));
                }
            }

            draft.Edges.Add(new DiscoveryDraftEdge(relation.Key, relation.From, nodeKey, "request", "http.request", toInterface));
        }

        return draft;
    }

    public static Draft Module(JsonElement module, DraftContext context)
    {
        var draft = new Draft([], [], [], [], [], []);
        foreach (var key in Members(module).Where(m => m.StartsWith("api:", StringComparison.Ordinal)).Order(StringComparer.Ordinal))
        {
            if (ApiTarget(key, context) is not { } target)
            {
                draft.Omitted.Add(Undecided(key, key, context));
                continue;
            }

            draft.Nodes.Add(new DiscoveryDraftNode(key, "ref", Truncate(target.Title, 120), CatalogId: target.Id));
        }

        if (draft.Nodes.Count == 0)
        {
            draft.Errors.Add("Ninguna de sus APIs está en el catálogo: créalas o vincúlalas primero (también en esta misma solicitud).");
            return draft;
        }

        var nodes = new HashSet<string>(draft.Nodes.Select(n => n.Key), StringComparer.Ordinal);
        if (module.TryGetProperty("interfaces", out var interfaces))
        {
            foreach (var item in interfaces.EnumerateArray().OrderBy(i => i.GetProperty("entity").GetString(), StringComparer.Ordinal))
            {
                var entity = item.GetProperty("entity").GetString()!;
                if (nodes.Contains(entity))
                {
                    draft.Interfaces.Add(new DiscoveryDraftInterface(entity, Truncate(item.GetProperty("name").GetString()!, 60), item.GetProperty("kind").GetString()!, entity));
                }
            }
        }

        return draft;
    }

    /// <summary>
    /// El grafo del lienzo inicial con los ids y las posiciones de la persona, o los errores si no cubren exactamente el
    /// borrador, repiten un id, no son UUID v7, se salen de rango o encima dos cajas.
    /// </summary>
    public static (JsonObject? Graph, Dictionary<string, string[]> Errors) Graph(Draft draft, CanvasInput input, string path)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        Same(draft.Nodes.Select(n => n.Key), input.Nodes.Keys, $"{path}/nodes", errors);
        Same(draft.Edges.Select(e => e.Key), input.Edges.Keys, $"{path}/edges", errors);
        Same(draft.Interfaces.Select(i => i.Key), input.Interfaces.Keys, $"{path}/interfaces", errors);
        Same(draft.Nodes.Select(n => n.Key), input.Layout.Keys, $"{path}/layout", errors);
        var all = input.Nodes.Values.Concat(input.Edges.Values).Concat(input.Interfaces.Values).ToList();
        if (all.Any(id => id.Version != 7))
        {
            errors[$"{path}"] = ["Cada id del lienzo tiene que ser un UUID v7 generado por el cliente."];
        }
        else if (all.Distinct().Count() != all.Count)
        {
            errors[$"{path}"] = ["Hay ids repetidos en el lienzo."];
        }

        var boxes = input.Layout.OrderBy(p => p.Key, StringComparer.Ordinal).ToList();
        foreach (var (key, (x, y)) in boxes)
        {
            if (!double.IsFinite(x) || !double.IsFinite(y) || Math.Abs(x) > MaxCoordinate || Math.Abs(y) > MaxCoordinate)
            {
                errors[$"{path}/layout/{key}"] = ["Posición fuera de rango."];
            }
        }

        for (var i = 0; i < boxes.Count && errors.Count == 0; i++)
        {
            for (var j = i + 1; j < boxes.Count; j++)
            {
                var (a, b) = (boxes[i].Value, boxes[j].Value);
                if (a.X < b.X + BoxWidth + Gap && b.X < a.X + BoxWidth + Gap && a.Y < b.Y + BoxHeight + Gap && b.Y < a.Y + BoxHeight + Gap)
                {
                    errors[$"{path}/layout/{boxes[j].Key}"] = [$"Se encima con {boxes[i].Key}: el lienzo inicial no debe tener cajas superpuestas."];
                    break;
                }
            }
        }

        if (errors.Count > 0)
        {
            return (null, errors);
        }

        string Id(string key) => input.Nodes[key].ToString();
        var nodes = new JsonObject();
        var layout = new JsonObject();
        foreach (var node in draft.Nodes)
        {
            var item = new JsonObject { ["id"] = Id(node.Key), ["type"] = node.Type, ["title"] = node.Title };
            if (node.Route is { } route)
            {
                item["description"] = Truncate("Ruta: " + route, 2000);
            }

            if (node.CatalogId is { } catalogId)
            {
                item["catalogId"] = catalogId.ToString();
            }

            if (node.ModuleId is { } moduleId)
            {
                item["moduleId"] = moduleId.ToString();
            }

            nodes[Id(node.Key)] = item;
            var (x, y) = input.Layout[node.Key];
            layout[Id(node.Key)] = new JsonObject { ["x"] = x, ["y"] = y };
        }

        var edges = new JsonObject();
        foreach (var edge in draft.Edges)
        {
            var id = input.Edges[edge.Key].ToString();
            var item = new JsonObject { ["id"] = id, ["from"] = Id(edge.From), ["to"] = Id(edge.To), ["kind"] = edge.Kind, ["operation"] = edge.Operation };
            if (edge.ToInterface is { } target)
            {
                item["toInterface"] = new JsonObject { ["id"] = target.Id, ["name"] = target.Name };
            }

            edges[id] = item;
        }

        var graph = new JsonObject
        {
            ["schemaVersion"] = WalkieInfo.SchemaVersion,
            ["version"] = 0,
            ["nodes"] = nodes,
            ["edges"] = edges,
            ["layout"] = layout,
        };
        if (draft.Interfaces.Count > 0)
        {
            var interfaces = new JsonObject();
            foreach (var item in draft.Interfaces)
            {
                var id = input.Interfaces[item.Key].ToString();
                interfaces[id] = new JsonObject { ["id"] = id, ["name"] = item.Name, ["kind"] = item.Kind, ["nodeId"] = Id(item.Node) };
            }

            graph["interfaces"] = interfaces;
        }

        return (graph, errors);
    }

    /// <summary>El elemento del catálogo de una API: el que crea esta solicitud o el de su decisión (si sigue existiendo).</summary>
    private static (Guid Id, string Title)? ApiTarget(string key, DraftContext context)
    {
        if (context.PlannedCatalog.TryGetValue(key, out var planned))
        {
            return planned;
        }

        return context.Decisions.TryGetValue(key, out var decision)
            && decision is { Decision: "linked" or "created", TargetKind: "catalogItem", TargetId: { } id }
            && context.Catalog.TryGetValue(id, out var title)
                ? (id, title)
                : null;
    }

    private static DiscoveryDraftOmission Undecided(string key, string api, DraftContext context)
    {
        var decision = context.Decisions.GetValueOrDefault(api);
        var (code, why) = decision switch
        {
            { Decision: "rejected" } => ("api-rejected", "se descartó en la revisión"),
            { Decision: "linked" or "created" } => ("api-target-missing", "su elemento del catálogo ya no existe"),
            _ => ("api-undecided", "todavía no está en el catálogo: créala o vincúlala (puede ser en esta misma solicitud)"),
        };
        return new DiscoveryDraftOmission(key, code, Truncate($"{api["api:".Length..]} {why}, así que no entra al lienzo.", 500));
    }

    private static IEnumerable<string> Members(JsonElement entity) =>
        entity.TryGetProperty("members", out var members) ? members.EnumerateArray().Select(m => m.GetString()!) : [];

    private static void Same(IEnumerable<string> expected, IEnumerable<string> given, string path, Dictionary<string, string[]> errors)
    {
        var want = expected.ToHashSet(StringComparer.Ordinal);
        var got = given.ToHashSet(StringComparer.Ordinal);
        var missing = want.Except(got).Order(StringComparer.Ordinal).ToList();
        var extra = got.Except(want).Order(StringComparer.Ordinal).ToList();
        if (missing.Count > 0 || extra.Count > 0)
        {
            errors[path] = [Truncate(string.Create(CultureInfo.InvariantCulture,
                $"Tiene que traer exactamente las claves de la vista previa. Faltan: {(missing.Count == 0 ? "ninguna" : string.Join(", ", missing))}. Sobran: {(extra.Count == 0 ? "ninguna" : string.Join(", ", extra))}."), 1000)];
        }
    }

    private static string? Text(JsonElement entity, string name, int max) =>
        entity.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? Truncate(value.GetString()!, max) : null;

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];
}
