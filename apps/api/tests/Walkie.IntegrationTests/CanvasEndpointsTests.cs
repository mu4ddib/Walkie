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
