using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

[Collection(ApiTestGroup.Name)]
public sealed class CanvasEndpointsTests(WalkieApiFactory factory)
{
    private const string Screen = "0193a1b2-0000-7000-8000-00000000000a";
    private const string Api = "0193a1b2-0000-7000-8000-00000000000b";
    private const string Edge = "0193a1b2-0000-7000-8000-00000000000c";
    private const string Rule = "0193a1b2-0000-7000-8000-00000000000d";

    [Fact]
    public async Task Sin_token_responde_401()
    {
        using var client = factory.CreateClient();
        var uri = CanvasUri(Guid.CreateVersion7());

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(uri)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync(uri, Graph(0))).StatusCode);
    }

    [Fact]
    public async Task Feature_nueva_devuelve_grafo_vacio_con_version_0()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var graph = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));

        AssertSameJson("""{"schemaVersion":0,"version":0,"nodes":{},"edges":{},"layout":{}}""", graph);
    }

    [Fact]
    public async Task Feature_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var uri = CanvasUri(Guid.CreateVersion7());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(uri)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync(uri, Graph(0))).StatusCode);
    }

    [Fact]
    public async Task Guardar_sube_la_version_y_al_recargar_el_grafo_es_identico()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var saved = await client.PutAsJsonAsync(CanvasUri(featureId), Graph(0));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var expected = Graph(1);
        AssertSameJson(expected.ToJsonString(), await saved.Content.ReadFromJsonAsync<JsonElement>());
        AssertSameJson(expected.ToJsonString(), await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId)));
    }

    [Fact]
    public async Task Guardados_sucesivos_con_la_version_al_dia_funcionan()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        (await client.PutAsJsonAsync(CanvasUri(featureId), Graph(0))).EnsureSuccessStatusCode();
        var second = await client.PutAsJsonAsync(CanvasUri(featureId), Graph(1, title: "Login v2"));

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var graph = await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, graph.GetProperty("version").GetInt32());
        Assert.Equal("Login v2", graph.GetProperty("nodes").GetProperty(Screen).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Guardar_con_version_vieja_responde_409_con_la_version_actual()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        (await client.PutAsJsonAsync(CanvasUri(featureId), Graph(0))).EnsureSuccessStatusCode();

        // Otra pestaña todavía tiene la versión 0.
        var stale = await client.PutAsJsonAsync(CanvasUri(featureId), Graph(0, title: "Cambio perdido"));

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("application/problem+json", stale.Content.Headers.ContentType?.MediaType);
        var problem = await stale.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, problem.GetProperty("currentVersion").GetInt32());

        var current = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        Assert.Equal("Login", current.GetProperty("nodes").GetProperty(Screen).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Guardados_simultaneos_de_la_misma_version_solo_uno_gana()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var responses = await Task.WhenAll(Enumerable.Range(0, 5)
            .Select(i => client.PutAsJsonAsync(CanvasUri(featureId), Graph(0, title: $"Pestaña {i}"))));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.OK),
            r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
    }

    [Theory]
    [InlineData("""{"schemaVersion":0,"version":0,"edges":{},"layout":{}}""", "/")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"a":{"id":"a","type":"pantalla","title":"x"}},"edges":{},"layout":{}}""", "/nodes/a/type")]
    [InlineData("""{"schemaVersion":1,"version":0,"nodes":{},"edges":{},"layout":{}}""", "/schemaVersion")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{},"edges":{},"layout":{},"extra":true}""", "/")]
    [InlineData("""[]""", "/")]
    public async Task Grafo_que_no_cumple_el_schema_responde_400(string body, string errorPath)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var response = await PutRawAsync(client, featureId, body);

        var problem = await AssertValidationProblemAsync(response);
        Assert.Contains(errorPath, problem.Errors.Keys);
    }

    [Theory]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"a":{"id":"b","type":"screen","title":"x"}},"edges":{},"layout":{}}""", "/nodes/a/id")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"a":{"id":"a","type":"screen","title":"x"}},"edges":{"e":{"id":"e","from":"a","to":"fantasma","kind":"navigation"}},"layout":{}}""", "/edges/e/to")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{},"edges":{},"layout":{"fantasma":{"x":0,"y":0}}}""", "/layout/fantasma")]
    public async Task Grafo_con_referencias_rotas_responde_400(string body, string errorPath)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var response = await PutRawAsync(client, featureId, body);

        var problem = await AssertValidationProblemAsync(response);
        Assert.Contains(errorPath, problem.Errors.Keys);
    }

    [Theory]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"n1":{"id":"n1","type":"screen","title":"x","inputs":[{"name":"cc","type":"string","ruleIds":["fantasma"]}]}},"edges":{},"layout":{}}""", "/nodes/n1/inputs/0/ruleIds/0")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"n1":{"id":"n1","type":"screen","title":"x","inputs":[{"name":"cc","type":"string","ruleIds":["a"]}]},"a":{"id":"a","type":"api","title":"API"}},"edges":{},"layout":{}}""", "/nodes/n1/inputs/0/ruleIds/0")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"n1":{"id":"n1","type":"screen","title":"x","inputs":[{"name":"cc","type":"string"},{"name":"cc","type":"number"}]}},"edges":{},"layout":{}}""", "/nodes/n1/inputs/1/name")]
    [InlineData("""{"schemaVersion":0,"version":0,"nodes":{"n1":{"id":"n1","type":"screen","title":"x","inputs":[{"name":"cc","type":"string","options":["A"]}]}},"edges":{},"layout":{}}""", "/nodes/n1/inputs/0/options")]
    public async Task Inputs_con_reglas_rotas_nombres_repetidos_u_opciones_fuera_de_enum_responden_400(string body, string errorPath)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var response = await PutRawAsync(client, featureId, body);

        var problem = await AssertValidationProblemAsync(response);
        Assert.Contains(errorPath, problem.Errors.Keys);
    }

    [Theory]
    [InlineData("description", 2001)]
    [InlineData("expression", 2001)]
    public async Task Textos_de_nodo_por_encima_del_limite_responden_400(string field, int length)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        var graph = Graph(0);
        graph["nodes"]![Screen]![field] = new string('x', length);

        var response = await client.PutAsJsonAsync(CanvasUri(featureId), graph);

        var problem = await AssertValidationProblemAsync(response);
        Assert.Contains($"/nodes/{Screen}/{field}", problem.Errors.Keys);
    }

    [Theory]
    [InlineData("""{"name":"","type":"string"}""", "/name")]
    [InlineData("""{"name":"cc","type":"enum","options":[""]}""", "/options/0")]
    public async Task Inputs_que_no_cumplen_los_limites_responden_400(string input, string suffix)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        var graph = Graph(0);
        graph["nodes"]![Screen]!["inputs"] = new JsonArray(JsonNode.Parse(input));

        var response = await client.PutAsJsonAsync(CanvasUri(featureId), graph);

        var problem = await AssertValidationProblemAsync(response);
        Assert.Contains($"/nodes/{Screen}/inputs/0{suffix}", problem.Errors.Keys);
    }

    [Theory]
    [InlineData("label")]
    [InlineData("when")]
    public async Task Etiqueta_o_condicion_de_conexion_por_encima_de_60_responden_400(string field)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        var graph = Graph(0);
        graph["edges"]![Edge]![field] = new string('x', 61);

        var response = await client.PutAsJsonAsync(CanvasUri(featureId), graph);

        var problem = await AssertValidationProblemAsync(response);
        Assert.Contains($"/edges/{Edge}/{field}", problem.Errors.Keys);
    }

    [Fact]
    public async Task Grafo_con_inputs_reglas_contrato_y_condiciones_se_guarda_y_recarga_identico()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        var graph = RichGraph(0);

        var saved = await client.PutAsJsonAsync(CanvasUri(featureId), graph);

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        AssertSameJson(RichGraph(1).ToJsonString(), await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId)));
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/features/{featureId}/canvas\"", doc, StringComparison.Ordinal);
    }

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    /// <summary>Lienzo de ejemplo: una pantalla que llama a una API (datos ficticios).</summary>
    private static JsonObject Graph(int version, string title = "Login") => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = version,
        ["nodes"] = new JsonObject
        {
            [Screen] = new JsonObject { ["id"] = Screen, ["type"] = "screen", ["title"] = title },
            [Api] = new JsonObject { ["id"] = Api, ["type"] = "api", ["title"] = "POST /login" },
        },
        ["edges"] = new JsonObject
        {
            [Edge] = new JsonObject { ["id"] = Edge, ["from"] = Screen, ["to"] = Api, ["kind"] = "request" },
        },
        ["layout"] = new JsonObject
        {
            [Screen] = new JsonObject { ["x"] = 0, ["y"] = 0 },
            [Api] = new JsonObject { ["x"] = 240, ["y"] = 0 },
        },
    };

    /// <summary>Lienzo con todo lo de panel-propiedades: inputs, reglas, contrato y condiciones (datos ficticios).</summary>
    private static JsonObject RichGraph(int version)
    {
        var graph = Graph(version);
        var nodes = graph["nodes"]!.AsObject();
        nodes[Rule] = new JsonObject
        {
            ["id"] = Rule, ["type"] = "rule", ["title"] = "Documento válido",
            ["expression"] = "cc: solo dígitos, de 6 a 10",
        };
        nodes[Screen]!["description"] = "Pide documento y tipo de cuenta.";
        nodes[Screen]!["inputs"] = new JsonArray(
            new JsonObject { ["name"] = "documento", ["type"] = "string", ["required"] = true, ["ruleIds"] = new JsonArray(Rule) },
            new JsonObject { ["name"] = "cuenta", ["type"] = "enum", ["options"] = new JsonArray("Ahorros", "Corriente") });
        nodes[Api]!["http"] = new JsonObject { ["method"] = "POST", ["path"] = "/clientes/{id}" };
        graph["edges"]![Edge]!["label"] = "Ingresar";
        graph["edges"]![Edge]!["when"] = "200";
        graph["layout"]![Rule] = new JsonObject { ["x"] = 0, ["y"] = 160 };
        return graph;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Lienzos"));
        var appId = (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var feature = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión"));
        return (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }

    private static Task<HttpResponseMessage> PutRawAsync(HttpClient client, Guid featureId, string body) =>
        client.PutAsync(CanvasUri(featureId), new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

    private static async Task<ValidationProblemDetails> AssertValidationProblemAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.NotNull(problem);
        return problem;
    }

    private static void AssertSameJson(string expected, JsonElement actual)
    {
        using var doc = JsonDocument.Parse(expected);
        Assert.True(JsonElement.DeepEquals(doc.RootElement, actual), $"Esperado {expected}\nObtenido {actual}");
    }
}
