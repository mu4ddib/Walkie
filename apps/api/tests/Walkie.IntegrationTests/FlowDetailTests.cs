using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>
/// Decisiones, solicitud/respuesta y notas adhesivas en la API (spec flujos-legibles). Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class FlowDetailTests(WalkieApiFactory factory)
{
    private const string Graph = """
        {
          "schemaVersion": 0, "version": 0,
          "nodes": {
            "d": { "id": "d", "type": "rule", "title": "¿Tiene cuenta?", "mode": "decision",
                   "branches": [ { "id": "si", "label": "Sí" }, { "id": "no", "label": "No" } ] },
            "s": { "id": "s", "type": "screen", "title": "Creación de cuenta" },
            "a": { "id": "a", "type": "api", "title": "API Usuarios", "http": { "method": "POST", "path": "/creacionUsuario" } }
          },
          "edges": {
            "e1": { "id": "e1", "from": "d", "to": "s", "kind": "uses", "branch": "no", "when": "correo sin registrar" },
            "e2": { "id": "e2", "from": "s", "to": "a", "kind": "request",
                    "request": { "params": [ { "name": "X-Canal", "in": "header", "value": "app" } ] } },
            "e3": { "id": "e3", "from": "a", "to": "s", "kind": "response", "replyTo": "e2", "status": 201, "outcome": "Se muestra la confirmación" },
            "e4": { "id": "e4", "from": "a", "to": "s", "kind": "response", "replyTo": "e2", "status": 409 }
          },
          "layout": { "d": { "x": 0, "y": 0 }, "s": { "x": 320, "y": 0 }, "a": { "x": 640, "y": 0 }, "n1": { "x": 0, "y": 320 } },
          "stickyNotes": { "n1": { "id": "n1", "text": "Pendiente: validar con seguridad" } }
        }
        """;

    [Fact]
    public async Task Decision_intercambio_y_notas_se_guardan_y_vuelven_iguales()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);

        var put = await PutAsync(client, featureId, Graph);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var saved = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        var expected = TestJson.Parse(Graph);
        foreach (var part in new[] { "nodes", "edges", "layout", "stickyNotes" })
        {
            Assert.True(JsonElement.DeepEquals(expected.GetProperty(part), saved.GetProperty(part)), part);
        }
    }

    [Theory]
    [InlineData("\"branch\": \"no\"", "\"branch\": \"quizas\"", "/edges/e1/branch")]
    [InlineData("\"replyTo\": \"e2\", \"status\": 409", "\"replyTo\": \"e1\", \"status\": 409", "/edges/e4/replyTo")]
    [InlineData("\"replyTo\": \"e2\", \"status\": 409", "\"replyTo\": \"nada\", \"status\": 409", "/edges/e4/replyTo")]
    [InlineData("\"status\": 201", "\"status\": 99", "/edges/e3/status")]
    [InlineData("\"type\": \"rule\", \"title\": \"¿Tiene cuenta?\", \"mode\": \"decision\"", "\"type\": \"rule\", \"title\": \"¿Tiene cuenta?\"", "/nodes/d/branches")]
    [InlineData("\"type\": \"screen\", \"title\": \"Creación de cuenta\"", "\"type\": \"screen\", \"title\": \"Creación de cuenta\", \"mode\": \"decision\"", "/nodes/s/mode")]
    [InlineData("{ \"id\": \"no\", \"label\": \"No\" }", "{ \"id\": \"si\", \"label\": \"No\" }", "/nodes/d/branches/1/id")]
    [InlineData("\"n1\": { \"id\": \"n1\", \"text\"", "\"n1\": { \"id\": \"otra\", \"text\"", "/stickyNotes/n1/id")]
    [InlineData("\"stickyNotes\": { \"n1\"", "\"stickyNotes\": { \"n2\"", "/layout/n1")]
    public async Task Un_detalle_invalido_responde_400(string from, string to, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client);
        Assert.Contains(from, Graph, StringComparison.Ordinal);

        var put = await PutAsync(client, featureId, Graph.Replace(from, to, StringComparison.Ordinal));

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        var problem = await put.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(problem!.Errors.Keys, key => key.StartsWith(path, StringComparison.Ordinal));
    }

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, Guid featureId, string graph) =>
        client.PutAsync(CanvasUri(featureId), new StringContent(graph, System.Text.Encoding.UTF8, "application/json"));

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static async Task<Guid> CreateFeatureAsync(HttpClient client)
    {
        var app = await (await client.PostAsJsonAsync("/api/apps", new CreateAppRequest("Banca de prueba")))
            .Content.ReadFromJsonAsync<AppResponse>();
        var feature = await (await client.PostAsJsonAsync($"/api/apps/{app!.Id}/features", new CreateFeatureRequest("Registro")))
            .Content.ReadFromJsonAsync<FeatureResponse>();
        return feature!.Id;
    }
}
