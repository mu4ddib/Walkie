using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Export.Features;
using Walkie.Shared.Schemas;

namespace Walkie.IntegrationTests;

/// <summary>
/// Interacciones entre sistemas (spec interacciones, ADR-0011): operación, intercambio, retornos de cualquier
/// operación, respuestas asíncronas correlacionadas y pasos simultáneos o con timeout. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class InteractionsTests(WalkieApiFactory factory)
{
    /// <summary>Pantalla → API → Base → API → Pantalla, con resultado vacío, publicación con confirmación y respuesta asíncrona.</summary>
    private const string Graph = """
        {
          "schemaVersion": 0, "version": 0,
          "nodes": {
            "s": { "id": "s", "type": "screen", "title": "Consulta de saldo" },
            "a": { "id": "a", "type": "api", "title": "API Cuentas", "http": { "method": "GET", "path": "/saldos/{cuenta}" } },
            "b": { "id": "b", "type": "database", "title": "Base Cuentas" },
            "t": { "id": "t", "type": "resource", "title": "Auditoría", "resource": { "kind": "topic" } },
            "w": { "id": "w", "type": "service", "title": "Servicio de auditoría" }
          },
          "edges": {
            "e1": { "id": "e1", "from": "s", "to": "a", "kind": "request", "operation": "http.request" },
            "e2": { "id": "e2", "from": "a", "to": "b", "kind": "request", "operation": "db.query", "pattern": "request-response",
                    "technology": "PostgreSQL",
                    "exchange": { "command": { "language": "sql", "text": "SELECT saldo FROM cuentas WHERE id = :cuenta" },
                                  "params": [ { "name": "cuenta", "type": "string", "example": "001-123" } ],
                                  "entities": [ "cuentas" ], "timeoutMs": 3000, "retries": 2, "retry": "con espera exponencial",
                                  "errors": [ { "code": "TIMEOUT", "description": "La base no responde" } ] } },
            "e3": { "id": "e3", "from": "b", "to": "a", "kind": "response", "replyTo": "e2", "result": { "type": "success" } },
            "e4": { "id": "e4", "from": "b", "to": "a", "kind": "response", "replyTo": "e2",
                    "result": { "type": "empty", "description": "La cuenta no existe" } },
            "e5": { "id": "e5", "from": "a", "to": "s", "kind": "response", "replyTo": "e1", "status": 200 },
            "e6": { "id": "e6", "from": "a", "to": "t", "kind": "event", "operation": "message.publish", "pattern": "pub-sub",
                    "exchange": { "channel": "auditoria.consultas", "correlationKey": "consultaId", "acks": [ "broker" ] } },
            "e7": { "id": "e7", "from": "t", "to": "a", "kind": "response", "replyTo": "e6", "result": { "type": "ack" } },
            "e8": { "id": "e8", "from": "w", "to": "a", "kind": "event", "operation": "message.reply", "correlatesWith": "e6" }
          },
          "layout": { "s": { "x": 0, "y": 0 }, "a": { "x": 320, "y": 0 }, "b": { "x": 640, "y": 0 }, "t": { "x": 320, "y": 240 }, "w": { "x": 640, "y": 240 } },
          "tours": {
            "f": { "id": "f", "name": "Consulta", "kind": "flow", "steps": [
              { "id": "p1", "edgeId": "e1" }, { "id": "p2", "edgeId": "e2" }, { "id": "p3", "edgeId": "e6", "parallel": true },
              { "id": "p4", "edgeId": "e4" }, { "id": "p5", "edgeId": "e5", "timeout": true } ] }
          }
        }
        """;

    [Fact]
    public async Task Una_interaccion_completa_se_guarda_y_vuelve_igual()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var put = await PutAsync(client, featureId, Graph);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var saved = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        var expected = TestJson.Parse(Graph);
        foreach (var part in new[] { "nodes", "edges", "tours" })
        {
            Assert.True(JsonElement.DeepEquals(expected.GetProperty(part), saved.GetProperty(part)), part);
        }
    }

    [Theory]
    // Un retorno responde a una operación existente que no sea otro retorno.
    [InlineData("\"replyTo\": \"e2\", \"result\": { \"type\": \"success\" }", "\"replyTo\": \"e5\", \"result\": { \"type\": \"success\" }", "/edges/e3/replyTo")]
    [InlineData("\"replyTo\": \"e2\", \"result\": { \"type\": \"success\" }", "\"replyTo\": \"nada\", \"result\": { \"type\": \"success\" }", "/edges/e3/replyTo")]
    // El tipo de retorno solo va en un retorno; el intercambio, solo en una operación.
    [InlineData("\"operation\": \"http.request\" }", "\"operation\": \"http.request\", \"result\": { \"type\": \"success\" } }", "/edges/e1/result")]
    [InlineData("\"replyTo\": \"e1\", \"status\": 200 }", "\"replyTo\": \"e1\", \"status\": 200, \"exchange\": { \"retry\": \"no\" } }", "/edges/e5/exchange")]
    // Una respuesta asíncrona se correlaciona con otra conexión que existe.
    [InlineData("\"correlatesWith\": \"e6\"", "\"correlatesWith\": \"e8\"", "/edges/e8/correlatesWith")]
    [InlineData("\"correlatesWith\": \"e6\"", "\"correlatesWith\": \"nada\"", "/edges/e8/correlatesWith")]
    // La operación personalizada lleva su nombre.
    [InlineData("\"operation\": \"http.request\" }", "\"operation\": \"custom\" }", "/edges/e1/customOperation")]
    // Operación, patrón o tipo de retorno fuera del catálogo.
    [InlineData("\"operation\": \"db.query\"", "\"operation\": \"db.select\"", "/edges/e2/operation")]
    [InlineData("\"pattern\": \"pub-sub\"", "\"pattern\": \"broadcast\"", "/edges/e6/pattern")]
    [InlineData("{ \"type\": \"ack\" }", "{ \"type\": \"ok\" }", "/edges/e7/result")]
    public async Task Una_interaccion_invalida_responde_400(string from, string to, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        Assert.Contains(from, Graph, StringComparison.Ordinal);

        var put = await PutAsync(client, featureId, Graph.Replace(from, to, StringComparison.Ordinal));

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        var problem = await put.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(problem!.Errors.Keys, key => key.StartsWith(path, StringComparison.Ordinal));
    }

    [Fact]
    public void El_markdown_usa_el_verbo_de_la_operacion_y_describe_el_intercambio()
    {
        var markdown = MarkdownDocument.Render(Input());

        Assert.Contains("API Cuentas → Base Cuentas (consulta)", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Interacción: operación Consultar · solicitud y respuesta · PostgreSQL", markdown, StringComparison.Ordinal);
        Assert.Contains("SELECT saldo FROM cuentas WHERE id = :cuenta", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Entidades: `cuentas`", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Timeout: 3000 ms", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Reintentos: 2 · con espera exponencial", markdown, StringComparison.Ordinal);
        Assert.Contains("Base Cuentas → API Cuentas (devuelve: resultado vacío)", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Retorno: resultado vacío: La cuenta no existe", markdown, StringComparison.Ordinal);
        Assert.Contains("API Cuentas → Consulta de saldo (responde 200)", markdown, StringComparison.Ordinal);
        Assert.Contains("API Cuentas → Auditoría (publica)", markdown, StringComparison.Ordinal);
        Assert.Contains("Auditoría → API Cuentas (confirma: confirmación)", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Mensajería: canal `auditoria.consultas` · correlación `consultaId` · confirmaciones: del broker", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void El_contexto_para_ia_cumple_el_schema_trae_la_operacion_y_no_pide_codigo_http_a_un_resultado()
    {
        var context = MarkdownDocument.BuildAiContext(AiInput(Graph));
        using var doc = JsonDocument.Parse(MarkdownDocument.AiContextJson(context));
        var root = doc.RootElement;

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AiContext, root));
        var connections = root.GetProperty("connections").EnumerateArray().ToDictionary(c => c.GetProperty("id").GetString()!);
        Assert.Equal("db.query", connections["e2"].GetProperty("operation").GetString());
        Assert.Equal("Consultar", connections["e2"].GetProperty("operationName").GetString());
        Assert.Equal("PostgreSQL", connections["e2"].GetProperty("technology").GetString());
        Assert.Equal("cuentas", connections["e2"].GetProperty("exchange").GetProperty("entities")[0].GetString());
        Assert.Equal("empty", connections["e4"].GetProperty("result").GetProperty("type").GetString());
        Assert.Equal("e6", connections["e8"].GetProperty("correlatesWith").GetString());

        var gaps = root.GetProperty("gaps").EnumerateArray().Select(g => (g.GetProperty("kind").GetString(), g.GetProperty("elementId").GetString())).ToList();
        Assert.DoesNotContain(("response-without-status", "e3"), gaps);
        Assert.DoesNotContain(("response-without-status", "e7"), gaps);

        var steps = root.GetProperty("flows")[0].GetProperty("steps");
        Assert.True(steps[2].GetProperty("parallel").GetBoolean());
        Assert.True(steps[4].GetProperty("timeout").GetBoolean());
        Assert.Contains("(a la vez que el anterior)", MarkdownDocument.RenderAiContext(context), StringComparison.Ordinal);
    }

    [Fact]
    public void Un_tipo_lee_con_acceso_escribe_se_senala_sin_deducir()
    {
        var graph = Graph.Replace(
            "\"e2\": { \"id\": \"e2\", \"from\": \"a\", \"to\": \"b\", \"kind\": \"request\", \"operation\": \"db.query\",",
            "\"e2\": { \"id\": \"e2\", \"from\": \"a\", \"to\": \"b\", \"kind\": \"reads\", \"data\": { \"operation\": \"write\" },",
            StringComparison.Ordinal);
        Assert.NotEqual(Graph, graph);

        var context = MarkdownDocument.BuildAiContext(AiInput(graph));
        using var doc = JsonDocument.Parse(MarkdownDocument.AiContextJson(context));

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AiContext, doc.RootElement));
        Assert.Contains(doc.RootElement.GetProperty("gaps").EnumerateArray(),
            g => g.GetProperty("kind").GetString() == "operation-conflict" && g.GetProperty("elementId").GetString() == "e2");
    }

    [Fact]
    public void El_catalogo_de_operaciones_es_uno_cumple_su_schema_y_cubre_el_enum_del_grafo()
    {
        using var catalog = JsonDocument.Parse(WalkieSchemas.OperationsCatalog);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.OperationsCatalogSchema, catalog.RootElement));

        using var graph = JsonDocument.Parse(File.ReadAllText(SchemaPath("walkie-graph.schema.json")));
        var enumIds = graph.RootElement.GetProperty("$defs").GetProperty("edge").GetProperty("properties")
            .GetProperty("operation").GetProperty("enum").EnumerateArray().Select(e => e.GetString()!).Order(StringComparer.Ordinal);
        Assert.Equal(enumIds, EdgeOperations.Ids.Order(StringComparer.Ordinal));
    }

    private static string SchemaPath(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "packages", "schema")))
        {
            dir = dir.Parent;
        }

        return Path.Combine(dir!.FullName, "packages", "schema", name);
    }

    private static ExportInput Input()
    {
        using var doc = JsonDocument.Parse(Graph);
        return new ExportInput(
            "Banca de prueba", "Consulta de saldo", doc.RootElement.Clone(),
            new Dictionary<Guid, CatalogItemResponse>(), new Dictionary<Guid, string>(), new Dictionary<Guid, string>(),
            new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero));
    }

    private static AiContextInput AiInput(string graph)
    {
        using var doc = JsonDocument.Parse(graph);
        return new AiContextInput(
            Guid.Parse("0198f0c0-4444-7000-8000-000000000009"), "Banca de prueba", "Consulta de saldo", null,
            doc.RootElement.Clone(), new Dictionary<Guid, CatalogItemResponse>(), new Dictionary<Guid, string>(),
            new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero));
    }

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, Guid featureId, string graph) =>
        client.PutAsync(CanvasUri(featureId), new StringContent(graph, System.Text.Encoding.UTF8, "application/json"));

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static async Task<Guid> CreateFeatureAsync(HttpClient client)
    {
        var app = await (await client.PostAsJsonAsync("/api/apps", new CreateAppRequest("Banca de prueba")))
            .Content.ReadFromJsonAsync<AppResponse>();
        var feature = await (await client.PostAsJsonAsync($"/api/apps/{app!.Id}/features", new CreateFeatureRequest("Saldos")))
            .Content.ReadFromJsonAsync<FeatureResponse>();
        return feature!.Id;
    }
}
