using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Nodos ref, "Usado en" y borrado protegido (spec catalogo, criterios 4, 5 y 12 en la API). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class CatalogRefsTests(WalkieApiFactory factory)
{
    private const string AnyId = "0193a1b2-0000-7000-8000-000000000001";

    [Theory]
    [InlineData("DELETE", $"/api/catalog/{AnyId}")]
    [InlineData("GET", $"/api/catalog/{AnyId}/usages")]
    public async Task Sin_token_responde_401(string method, string path)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Un_lienzo_con_ref_a_un_elemento_de_su_app_se_guarda_y_recarga_identico()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Transferir");
        var item = await CreateItemAsync(client, app, "Transferir");

        var response = await SaveAsync(client, feature, RefGraph(0, item.ToString()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var expected = JsonDocument.Parse(RefGraph(1, item.ToString()).ToJsonString());
        Assert.True(JsonElement.DeepEquals(
            expected.RootElement, await client.GetFromJsonAsync<JsonElement>(CanvasUri(feature))));
    }

    [Fact]
    public async Task Un_ref_a_un_elemento_inexistente_de_otra_app_o_invalido_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Transferir");
        var otherApp = await CreateAppAsync(client);
        var foreign = await CreateItemAsync(client, otherApp, "De otra app");

        foreach (var catalogId in new[] { Guid.CreateVersion7().ToString(), foreign.ToString(), "no-es-un-id" })
        {
            var response = await SaveAsync(client, feature, RefGraph(0, catalogId));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
            Assert.Contains("/nodes/r1/catalogId", problem!.Errors.Keys);
        }
    }

    [Fact]
    public async Task Usado_en_lista_las_features_cuyo_lienzo_tiene_un_ref()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, app, "Consultar cliente");
        var transferir = await CreateFeatureAsync(client, app, "Transferir");
        var pagar = await CreateFeatureAsync(client, app, "Pagar");
        await CreateFeatureAsync(client, app, "Sin uso");
        await SaveAsync(client, transferir, RefGraph(0, item.ToString()));
        await SaveAsync(client, pagar, RefGraph(0, item.ToString().ToUpperInvariant()));

        var usages = await client.GetFromJsonAsync<FeatureResponse[]>(UsagesUri(item));

        Assert.Equal(["Pagar", "Transferir"], usages!.Select(f => f.Name));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(UsagesUri(Guid.CreateVersion7()))).StatusCode);
    }

    [Fact]
    public async Task Borrar_un_elemento_en_uso_responde_409_con_las_features_y_no_lo_borra()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, app, "Consultar cliente");
        var feature = await CreateFeatureAsync(client, app, "Transferir");
        await SaveAsync(client, feature, RefGraph(0, item.ToString()));

        var response = await client.DeleteAsync(ItemUri(item));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        var features = problem.GetProperty("features").Deserialize<FeatureResponse[]>(JsonSerializerOptions.Web);
        Assert.Equal([feature], features!.Select(f => f.Id));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(ItemUri(item))).StatusCode);
    }

    [Fact]
    public async Task Borrar_un_elemento_sin_uso_responde_204_y_luego_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, app, "Notificaciones");
        var feature = await CreateFeatureAsync(client, app, "Transferir");
        await SaveAsync(client, feature, RefGraph(0, item.ToString()));
        await SaveAsync(client, feature, EmptyGraph(1));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(ItemUri(item))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(ItemUri(item))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(ItemUri(item))).StatusCode);
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/catalog/{itemId}/usages\"", doc, StringComparison.Ordinal);
        Assert.Contains("DeleteCatalogItem", doc, StringComparison.Ordinal);
    }

    /// <summary>Una pantalla conectada a un ref (datos ficticios).</summary>
    private static JsonObject RefGraph(int version, string catalogId) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = version,
        ["nodes"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Monto" },
            ["r1"] = new JsonObject { ["id"] = "r1", ["type"] = "ref", ["title"] = "Transferir", ["catalogId"] = catalogId },
        },
        ["edges"] = new JsonObject
        {
            ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "r1", ["kind"] = "request" },
        },
        ["layout"] = new JsonObject { ["s1"] = new JsonObject { ["x"] = 0, ["y"] = 0 } },
    };

    private static JsonObject EmptyGraph(int version) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = version,
        ["nodes"] = new JsonObject(),
        ["edges"] = new JsonObject(),
        ["layout"] = new JsonObject(),
    };

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static Uri ItemUri(Guid itemId) => new($"/api/catalog/{itemId}", UriKind.Relative);

    private static Uri UsagesUri(Guid itemId) => new($"/api/catalog/{itemId}/usages", UriKind.Relative);

    private static Task<HttpResponseMessage> SaveAsync(HttpClient client, Guid featureId, JsonObject graph) =>
        client.PutAsJsonAsync(CanvasUri(featureId), graph);

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Banca"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest(name));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }

    private static async Task<Guid> CreateItemAsync(HttpClient client, Guid appId, string title)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), new CreateCatalogItemRequest("api", title, null, null));
        return (await response.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
    }
}
