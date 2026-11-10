using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Grupos de infraestructura (spec espacio-de-trabajo, criterios 18 a 20 en la API). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class GroupsTests(WalkieApiFactory factory)
{
    private const string Graph = """
        {
          "schemaVersion": 0, "version": 0,
          "nodes": {
            "a": { "id": "a", "type": "api", "title": "Transferir", "groupId": "g1" },
            "d": { "id": "d", "type": "database", "title": "Core", "groupId": "g2" }
          },
          "edges": { "e1": { "id": "e1", "from": "a", "to": "d", "kind": "writes" } },
          "layout": {
            "a": { "x": 40, "y": 80 }, "d": { "x": 520, "y": 80 },
            "g1": { "x": 0, "y": 0, "w": 400, "h": 240 }, "g2": { "x": 480, "y": 0, "w": 400, "h": 240 }
          },
          "groups": {
            "g1": { "id": "g1", "title": "Backend", "kind": "backend" },
            "g2": { "id": "g2", "title": "Datos", "kind": "data", "collapsed": true }
          }
        }
        """;

    [Fact]
    public async Task Los_grupos_se_guardan_con_el_lienzo_y_vuelven_iguales()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var put = await PutAsync(client, featureId, Graph);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var saved = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        var expected = TestJson.Parse(Graph);
        foreach (var part in new[] { "nodes", "layout", "groups" })
        {
            Assert.True(JsonElement.DeepEquals(expected.GetProperty(part), saved.GetProperty(part)), part);
        }
    }

    [Fact]
    public async Task Grupos_anidados_y_notas_en_grupos_se_guardan_y_vuelven_iguales()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var put = await PutAsync(client, featureId, Nested);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var saved = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        var expected = TestJson.Parse(Nested);
        foreach (var part in new[] { "groups", "stickyNotes", "groupNesting" })
        {
            Assert.True(JsonElement.DeepEquals(expected.GetProperty(part), saved.GetProperty(part)), part);
        }
    }

    [Theory]
    [InlineData("\"parentId\": \"g1\"", "\"parentId\": \"nada\"", "/groups/g2/parentId")]
    [InlineData("\"title\": \"AWS\", \"kind\": \"cloud\"", "\"title\": \"AWS\", \"kind\": \"cloud\", \"parentId\": \"g2\"", "/groups/g1/parentId")]
    [InlineData("\"title\": \"AWS\", \"kind\": \"cloud\"", "\"title\": \"AWS\", \"kind\": \"cloud\", \"parentId\": \"g1\"", "/groups/g1/parentId")]
    [InlineData("\"text\": \"Escala sola\", \"groupId\": \"g2\"", "\"text\": \"Escala sola\", \"groupId\": \"nada\"", "/stickyNotes/k1/groupId")]
    public async Task Una_jerarquia_invalida_o_con_ciclos_responde_400(string from, string to, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var response = await PutAsync(client, featureId, Nested.Replace(from, to, StringComparison.Ordinal));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(path, problem!.Errors.Keys);
    }

    /// <summary>AWS ⊃ microservicio usuarios (plegado) ⊃ una API, con una nota en el grupo interno.</summary>
    private const string Nested = """
        {
          "schemaVersion": 0, "version": 0,
          "nodes": { "a": { "id": "a", "type": "api", "title": "Crear usuario", "groupId": "g2" } },
          "edges": {},
          "layout": {
            "a": { "x": 80, "y": 160 }, "k1": { "x": 400, "y": 160 },
            "g1": { "x": 0, "y": 0, "w": 1000, "h": 800 }, "g2": { "x": 40, "y": 80, "w": 600, "h": 400 }
          },
          "groups": {
            "g1": { "id": "g1", "title": "AWS", "kind": "cloud" },
            "g2": { "id": "g2", "title": "microservicio usuarios", "kind": "backend", "parentId": "g1", "collapsed": true }
          },
          "stickyNotes": { "k1": { "id": "k1", "text": "Escala sola", "groupId": "g2" } },
          "groupNesting": "explicit"
        }
        """;

    [Theory]
    [InlineData("\"groupId\": \"g1\"", "\"groupId\": \"nada\"", "/nodes/a/groupId")]
    [InlineData("\"g1\": { \"x\": 0, \"y\": 0, \"w\": 400, \"h\": 240 }", "\"g1\": { \"x\": 0, \"y\": 0 }", "/layout/g1")]
    [InlineData("\"g1\": { \"id\": \"g1\"", "\"g1\": { \"id\": \"otro\"", "/groups/g1/id")]
    [InlineData("\"kind\": \"backend\"", "\"kind\": \"app\"", "/groups/g1/kind")]
    public async Task Un_grupo_invalido_responde_400(string from, string to, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var response = await PutAsync(client, featureId, Graph.Replace(from, to, StringComparison.Ordinal));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(path, problem!.Errors.Keys);
    }

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, Guid featureId, string body) =>
        client.PutAsync(CanvasUri(featureId), new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

    private static async Task<Guid> CreateFeatureAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Banca"));
        var appId = (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var feature = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Transferir"));
        return (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }
}
