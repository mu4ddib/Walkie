using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>
/// Nodos de infraestructura (spec nodos-de-infraestructura, tarea 1; ADR-0007): recursos con subtipo, modelo de una
/// base de datos y dónde corre un servicio, en el lienzo y en el catálogo. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class InfrastructureNodesTests(WalkieApiFactory factory)
{
    private const string Queue = """
        { "kind": "queue", "provider": "aws", "name": "pagos-pendientes",
          "details": [{ "key": "retención", "value": "4 días" }, { "key": "visibilidad", "value": "30 s" }] }
        """;

    [Fact]
    public async Task El_lienzo_guarda_recursos_modelo_de_base_y_runtime_de_servicio()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client, await CreateAppAsync(client));
        var graph = $$"""
            {
              "schemaVersion": 0, "version": 0,
              "nodes": {
                "q1": { "id": "q1", "type": "resource", "title": "Pagos pendientes", "resource": {{Queue}} },
                "c1": { "id": "c1", "type": "resource", "title": "Orquestador",
                        "resource": { "kind": "custom", "label": "Step Functions", "provider": "aws" } },
                "s1": { "id": "s1", "type": "service", "title": "Pagos", "runtime": "container" },
                "d1": { "id": "d1", "type": "database", "title": "Sesiones",
                        "database": { "engine": "Redis", "model": "key-value" } }
              },
              "edges": {
                "e1": { "id": "e1", "from": "s1", "to": "q1", "kind": "event" }
              },
              "layout": {}
            }
            """;

        var put = await PutRawAsync(client, CanvasUri(featureId), graph);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var saved = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        Assert.True(JsonElement.DeepEquals(TestJson.Parse(graph).GetProperty("nodes"), saved.GetProperty("nodes")));
    }

    [Theory]
    [InlineData("""{ "id": "x", "type": "resource", "title": "X" }""", "/nodes/x")]
    [InlineData("""{ "id": "x", "type": "resource", "title": "X", "resource": { "kind": "nube" } }""", "/nodes/x/resource/kind")]
    [InlineData("""{ "id": "x", "type": "resource", "title": "X", "resource": { "kind": "custom" } }""", "/nodes/x/resource")]
    [InlineData("""{ "id": "x", "type": "resource", "title": "X", "resource": { "kind": "queue", "label": "Cola" } }""", "/nodes/x/resource")]
    [InlineData("""{ "id": "x", "type": "resource", "title": "X", "resource": { "kind": "cache", "details": [{ "key": "ttl" }] } }""", "/nodes/x/resource/details/0")]
    [InlineData("""{ "id": "x", "type": "api", "title": "X", "resource": { "kind": "queue" } }""", "/nodes/x/resource")]
    [InlineData("""{ "id": "x", "type": "api", "title": "X", "runtime": "container" }""", "/nodes/x/runtime")]
    [InlineData("""{ "id": "x", "type": "service", "title": "X", "runtime": "mainframe" }""", "/nodes/x/runtime")]
    [InlineData("""{ "id": "x", "type": "database", "title": "X", "database": { "model": "tabular" } }""", "/nodes/x/database/model")]
    public async Task Un_recurso_o_campo_de_infraestructura_invalido_responde_400(string node, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client, await CreateAppAsync(client));
        var graph = $$"""{ "schemaVersion": 0, "version": 0, "nodes": { "x": {{node}} }, "edges": {}, "layout": {} }""";

        var response = await PutRawAsync(client, CanvasUri(featureId), graph);

        await AssertValidationErrorAsync(response, path);
    }

    [Fact]
    public async Task El_catalogo_guarda_recursos_y_el_runtime_de_un_servicio_y_un_ref_los_usa()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var queue = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("resource", "Pagos pendientes", null, null, Resource: TestJson.Parse(Queue)));
        var service = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("service", "Pagos", null, null, Runtime: "serverless"));

        Assert.Equal(HttpStatusCode.Created, queue.StatusCode);
        Assert.Equal(HttpStatusCode.Created, service.StatusCode);
        var queueItem = await queue.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(JsonElement.DeepEquals(TestJson.Parse(Queue), queueItem.GetProperty("resource")));
        Assert.False(queueItem.TryGetProperty("runtime", out _));
        Assert.Equal("serverless", (await service.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("runtime").GetString());

        // Editar: cambia el subtipo y conserva la versión optimista.
        var queueId = queueItem.GetProperty("id").GetGuid();
        var update = await client.PutAsJsonAsync(ItemUri(queueId),
            new UpdateCatalogItemRequest("Pagos", null, null, 1, Resource: TestJson.Parse("""{ "kind": "topic" }""")));
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("topic", updated.GetProperty("resource").GetProperty("kind").GetString());
        Assert.Equal(2, updated.GetProperty("version").GetInt32());

        // Un lienzo lo usa con un ref.
        var featureId = await CreateFeatureAsync(client, appId);
        var graph = $$"""
            { "schemaVersion": 0, "version": 0,
              "nodes": { "r1": { "id": "r1", "type": "ref", "title": "Pagos", "catalogId": "{{queueId}}" } },
              "edges": {}, "layout": {} }
            """;
        Assert.Equal(HttpStatusCode.OK, (await PutRawAsync(client, CanvasUri(featureId), graph)).StatusCode);
    }

    [Fact]
    public async Task Recurso_y_runtime_fuera_de_su_tipo_o_un_recurso_sin_subtipo_responden_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var withoutKind = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("resource", "X", null, null));
        var badKind = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("resource", "X", null, null, Resource: TestJson.Parse("""{ "kind": "nube" }""")));
        var onApi = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("api", "X", null, null, Resource: TestJson.Parse("""{ "kind": "queue" }""")));
        var runtimeOnDb = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("database", "X", null, null, Runtime: "vm"));
        var badRuntime = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("service", "X", null, null, Runtime: "mainframe"));

        await AssertValidationErrorAsync(withoutKind, "Resource");
        await AssertValidationErrorAsync(badKind, "Resource/kind");
        await AssertValidationErrorAsync(onApi, "Resource");
        await AssertValidationErrorAsync(runtimeOnDb, "Runtime");
        await AssertValidationErrorAsync(badRuntime, "Runtime");

        // Al editar: un recurso no puede quedar sin subtipo, y un servicio no lleva recurso.
        var created = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("resource", "Cola", null, null, Resource: TestJson.Parse("""{ "kind": "queue" }""")));
        var id = (await created.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
        await AssertValidationErrorAsync(
            await client.PutAsJsonAsync(ItemUri(id), new UpdateCatalogItemRequest("Cola", null, null, 1)), "Resource");
        await AssertValidationErrorAsync(
            await client.PutAsJsonAsync(ItemUri(id), new UpdateCatalogItemRequest(
                "Cola", null, null, 1, Resource: TestJson.Parse("""{ "kind": "queue" }"""), Runtime: "vm")),
            "Runtime");
    }

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static Uri CatalogUri(Guid appId) => new($"/api/apps/{appId}/catalog", UriKind.Relative);

    private static Uri ItemUri(Guid itemId) => new($"/api/catalog/{itemId}", UriKind.Relative);

    private static Task<HttpResponseMessage> PutRawAsync(HttpClient client, Uri uri, string body) =>
        client.PutAsync(uri, new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Banca"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Pagar"));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }
}
