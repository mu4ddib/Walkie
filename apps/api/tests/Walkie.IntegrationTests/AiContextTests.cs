using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Export.Features;
using Walkie.Shared.Schemas;

namespace Walkie.IntegrationTests;

/// <summary>
/// Contexto para IA (spec exportar-e-importar, tarea 1): el modelo, su JSON (contra
/// <c>packages/schema/walkie-ai-context.schema.json</c>) y su Markdown. Función pura: sin base ni HTTP. Datos ficticios.
/// </summary>
public sealed class AiContextTests
{
    private static readonly Guid Feature = Guid.Parse("0198f0c0-4444-7000-8000-000000000004");
    private static readonly Guid Item = Guid.Parse("0198f0c0-2222-7000-8000-000000000002");
    private static readonly Guid Transferir = Guid.Parse("0198f0c0-3333-7000-8000-000000000003");
    private static readonly DateTimeOffset ExportedAt = new(2026, 11, 12, 18, 30, 0, TimeSpan.Zero);

    [Fact]
    public void El_json_cumple_el_schema_y_trae_proposito_componentes_flujos_reglas_y_relaciones()
    {
        var context = MarkdownDocument.BuildAiContext(Input(Graph()));
        var json = MarkdownDocument.AiContextJson(context);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AiContext, root));
        Assert.Equal("walkie-ai-context", root.GetProperty("format").GetString());
        Assert.Equal("Iniciar sesión", root.GetProperty("feature").GetProperty("name").GetString());
        Assert.Equal("El cliente entra con su documento y clave.", root.GetProperty("feature").GetProperty("description").GetString());
        Assert.Equal(3, root.GetProperty("canvasVersion").GetInt32());

        var components = root.GetProperty("components").EnumerateArray().ToDictionary(c => c.GetProperty("id").GetString()!);
        // Un ref es su elemento del catálogo, con su contrato completo y su id.
        Assert.Equal("api", components["c1"].GetProperty("type").GetString());
        Assert.Equal("Consultar cliente", components["c1"].GetProperty("title").GetString());
        Assert.Equal(Item.ToString(), components["c1"].GetProperty("catalogId").GetString());
        Assert.Equal("GET", components["c1"].GetProperty("http").GetProperty("method").GetString());
        Assert.Equal("AWS › Autenticación", components["a1"].GetProperty("group").GetString());
        Assert.Equal("Cola", components["q1"].GetProperty("is").GetString());
        Assert.Equal("Decisión", components["d1"].GetProperty("is").GetString());
        Assert.Equal("Transferir", components["p1"].GetProperty("targetFeature").GetString());
        var input = components["s1"].GetProperty("inputs")[0];
        Assert.Equal("documento", input.GetProperty("name").GetString());
        Assert.Equal("Documento válido", input.GetProperty("rules")[0].GetString());

        var connection = root.GetProperty("connections").EnumerateArray().Single(e => e.GetProperty("id").GetString() == "e1");
        Assert.Equal("Login → API Auth (llama: POST /sesiones)", connection.GetProperty("text").GetString());

        var flow = root.GetProperty("flows").EnumerateArray().Single(f => f.GetProperty("kind").GetString() == "flow");
        Assert.Equal("Entrar", flow.GetProperty("name").GetString());
        Assert.Equal("Login → API Auth (llama: POST /sesiones)", flow.GetProperty("steps")[0].GetProperty("text").GetString());
        Assert.True(flow.GetProperty("steps")[1].GetProperty("broken").GetBoolean());

        var rule = root.GetProperty("rules")[0];
        Assert.Equal("documento", rule.GetProperty("validates")[0].GetProperty("input").GetString());
        var decision = root.GetProperty("decisions")[0];
        Assert.Equal(["Sí", "No"], decision.GetProperty("branches").EnumerateArray().Select(b => b.GetProperty("label").GetString()));
        Assert.Equal("Inicio", decision.GetProperty("branches")[0].GetProperty("to")[0].GetString());

        var shared = root.GetProperty("relations").GetProperty("sharedComponents")[0];
        Assert.Equal("Consultar cliente", shared.GetProperty("title").GetString());
        Assert.Contains(root.GetProperty("glossary").EnumerateArray(),
            t => t.GetProperty("term").GetString() == "AWS" && t.GetProperty("is").GetString() == "Grupo (Cloud)");
    }

    [Fact]
    public void Los_vacios_dicen_lo_que_falta_documentar_en_un_orden_estable()
    {
        var context = MarkdownDocument.BuildAiContext(Input(Graph()));

        Assert.Equal(
            [
                ("api-without-responses", "a1"),
                ("api-without-responses", "c1"),
                ("request-without-response", "e3"),
                ("response-without-status", "e2"),
                ("isolated-node", "x1"),
                ("isolated-node", "b1"),
                ("isolated-node", "q1"),
                ("branch-without-target", "d1"),
                ("broken-flow-step", "gone"),
                ("portal-without-target", "p2"),
                ("database-without-structure", "b1"),
            ],
            context.Gaps.Select(g => (g.Kind, g.ElementId!)));
        Assert.Contains(context.Gaps, g => g.Message == "La salida «No» de la decisión «¿Tiene clave temporal?» no lleva a ningún lado.");
    }

    [Fact]
    public void El_markdown_va_del_proposito_a_los_vacios_y_el_detalle_tecnico_va_como_json()
    {
        var markdown = MarkdownDocument.RenderAiContext(MarkdownDocument.BuildAiContext(Input(Graph())));

        Assert.StartsWith("# Contexto para IA: Iniciar sesión\n\n> Documento generado por Walkie", markdown, StringComparison.Ordinal);
        string[] order = ["## Propósito", "## Glosario", "## Componentes", "## Conexiones", "## Recorridos (flujos de punta a punta)",
            "## Tours (cómo se presenta la feature)", "## Reglas de negocio", "## Decisiones", "## Relaciones", "## Vacíos detectados"];
        var at = order.Select(h => markdown.IndexOf(h, StringComparison.Ordinal)).ToArray();
        Assert.All(at, i => Assert.True(i > 0));
        Assert.Equal(at.Order(), at);
        Assert.Contains("El cliente entra con su documento y clave.", markdown, StringComparison.Ordinal);
        Assert.Contains("### Consultar cliente (API)\n\nid: `c1` · componente compartido del catálogo", markdown, StringComparison.Ordinal);
        Assert.Contains("Contrato:\n\n```json\n{\n  \"method\": \"GET\"", markdown, StringComparison.Ordinal);
        Assert.Contains("- `documento` (string; obligatorio; validado por: Documento válido)", markdown, StringComparison.Ordinal);
        Assert.Contains("1. Login → API Auth (llama: POST /sesiones) — Envía documento y clave", markdown, StringComparison.Ordinal);
        Assert.Contains("- **Sí** → Inicio", markdown, StringComparison.Ordinal);
        Assert.Contains("- **No** → (sin destino)", markdown, StringComparison.Ordinal);
        Assert.Contains("- Desde **Ir a transferir** se pasa a la feature **Transferir**.", markdown, StringComparison.Ordinal);
        Assert.Contains("- La API «API Auth» no documenta sus respuestas (códigos, cuerpo y errores).", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void El_mismo_grafo_con_otro_orden_de_claves_da_el_mismo_contexto()
    {
        var graph = Graph();
        var reversed = new JsonObject();
        foreach (var (key, value) in graph.ToList().AsEnumerable().Reverse())
        {
            reversed[key] = value is JsonObject obj
                ? new JsonObject(obj.ToList().AsEnumerable().Reverse().Select(p => KeyValuePair.Create(p.Key, p.Value?.DeepClone())))
                : value?.DeepClone();
        }

        var a = MarkdownDocument.BuildAiContext(Input(graph));
        var b = MarkdownDocument.BuildAiContext(Input(reversed));

        Assert.Equal(MarkdownDocument.AiContextJson(a), MarkdownDocument.AiContextJson(b));
        Assert.Equal(MarkdownDocument.RenderAiContext(a), MarkdownDocument.RenderAiContext(b));
    }

    [Fact]
    public void Un_lienzo_vacio_y_sin_descripcion_lo_dice()
    {
        var empty = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = new JsonObject(), ["edges"] = new JsonObject(), ["layout"] = new JsonObject(),
        };
        var context = MarkdownDocument.BuildAiContext(Input(empty) with { Description = null });

        var markdown = MarkdownDocument.RenderAiContext(context);
        Assert.Contains("La feature no tiene descripción en Walkie: pregunta su objetivo antes de construir.", markdown, StringComparison.Ordinal);
        Assert.Contains("El lienzo está vacío", markdown, StringComparison.Ordinal);
        using var doc = JsonDocument.Parse(MarkdownDocument.AiContextJson(context));
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AiContext, doc.RootElement));
    }

    private static AiContextInput Input(JsonObject graph)
    {
        using var doc = JsonDocument.Parse(graph.ToJsonString());
        return new AiContextInput(
            Feature,
            "Banca de prueba",
            "Iniciar sesión",
            "El cliente entra con su documento y clave.",
            doc.RootElement.Clone(),
            new Dictionary<Guid, CatalogItemResponse>
            {
                [Item] = new(Item, Guid.Empty, "api", "Consultar cliente", "Busca al cliente por documento.",
                    TestJson.Http("GET", "/clientes/{id}"), 1),
            },
            new Dictionary<Guid, string> { [Transferir] = "Transferir" },
            ExportedAt);
    }

    /// <summary>
    /// Pantalla con input validado por una regla, API con ruta (sin respuestas) en un grupo anidado, solicitud con
    /// respuesta sin código y otra sin respuesta, decisión con una salida sin destino, componente del catálogo, cola,
    /// base sin tablas, actor suelto, dos portales (uno sin destino) y un recorrido con un paso roto.
    /// </summary>
    private static JsonObject Graph()
    {
        JsonObject Node(string id, string type, string title) => new() { ["id"] = id, ["type"] = type, ["title"] = title };
        JsonObject Edge(string id, string from, string to, string kind) =>
            new() { ["id"] = id, ["from"] = from, ["to"] = to, ["kind"] = kind };

        var screen = Node("s1", "screen", "Login");
        screen["inputs"] = JsonNode.Parse("""[{ "name": "documento", "type": "string", "required": true, "ruleIds": ["r1"] }]""");
        var rule = Node("r1", "rule", "Documento válido");
        rule["expression"] = "solo dígitos, de 6 a 10";
        var api = Node("a1", "api", "API Auth");
        api["http"] = JsonNode.Parse("""{ "method": "POST", "path": "/sesiones" }""");
        api["groupId"] = "g2";
        var decision = Node("d1", "rule", "¿Tiene clave temporal?");
        decision["mode"] = "decision";
        decision["branches"] = JsonNode.Parse("""[{ "id": "si", "label": "Sí" }, { "id": "no", "label": "No" }]""");
        var queue = Node("q1", "resource", "Auditoría");
        queue["resource"] = JsonNode.Parse("""{ "kind": "queue" }""");
        var portal = Node("p1", "portal", "Ir a transferir");
        portal["targetFeatureId"] = Transferir.ToString();
        var reply = Edge("e2", "a1", "s1", "response");
        reply["replyTo"] = "e1";
        var yes = Edge("e5", "d1", "h1", "uses");
        yes["branch"] = "si";

        return new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = 3,
            ["nodes"] = new JsonObject
            {
                ["s1"] = screen,
                ["r1"] = rule,
                ["a1"] = api,
                ["d1"] = decision,
                ["h1"] = Node("h1", "screen", "Inicio"),
                ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "Consultar", ["catalogId"] = Item.ToString() },
                ["q1"] = queue,
                ["b1"] = Node("b1", "database", "Sesiones"),
                ["x1"] = Node("x1", "actor", "Cliente"),
                ["p1"] = portal,
                ["p2"] = Node("p2", "portal", "Sin destino"),
            },
            ["edges"] = new JsonObject
            {
                ["e1"] = Edge("e1", "s1", "a1", "request"),
                ["e2"] = reply,
                ["e3"] = Edge("e3", "a1", "c1", "request"),
                ["e4"] = Edge("e4", "s1", "d1", "uses"),
                ["e5"] = yes,
                ["e6"] = Edge("e6", "s1", "p1", "navigation"),
                ["e7"] = Edge("e7", "s1", "p2", "navigation"),
                ["e8"] = Edge("e8", "s1", "r1", "uses"),
            },
            ["layout"] = new JsonObject(),
            ["groups"] = JsonNode.Parse("""
                {
                  "g1": { "id": "g1", "title": "AWS", "kind": "cloud" },
                  "g2": { "id": "g2", "title": "Autenticación", "kind": "backend", "parentId": "g1" }
                }
                """),
            ["tours"] = JsonNode.Parse("""
                {
                  "t1": { "id": "t1", "name": "Entrar", "kind": "flow",
                          "steps": [{ "edgeId": "e1", "note": "Envía documento y clave" }, { "edgeId": "gone" }] },
                  "t2": { "id": "t2", "name": "Presentación", "kind": "guide", "steps": [{ "nodeId": "s1" }] }
                }
                """),
        };
    }
}
