using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Catálogo de la app (spec catalogo, criterios 2 y 3 en la API). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class CatalogEndpointsTests(WalkieApiFactory factory)
{
    private const string AnyId = "0193a1b2-0000-7000-8000-000000000001";

    [Theory]
    [InlineData("GET", $"/api/apps/{AnyId}/catalog")]
    [InlineData("POST", $"/api/apps/{AnyId}/catalog")]
    [InlineData("GET", $"/api/catalog/{AnyId}")]
    [InlineData("PUT", $"/api/catalog/{AnyId}")]
    public async Task Sin_token_responde_401(string method, string path)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), new Uri(path, UriKind.Relative))
        {
            Content = JsonContent.Create(new { type = "api", title = "x", version = 1 }),
        };

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Crear_un_elemento_responde_201_con_version_1_y_sin_campos_vacios()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var response = await client.PostAsJsonAsync(
            CatalogUri(appId),
            new CreateCatalogItemRequest("api", "  Consultar cliente ", "  ", TestJson.Http("GET", "/clientes/{id}")));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = json.GetProperty("id").GetGuid();
        Assert.Equal($"/api/catalog/{id}", response.Headers.Location?.ToString());
        AssertSameJson(
            $$"""{"id":"{{id}}","appId":"{{appId}}","type":"api","title":"Consultar cliente","http":{"method":"GET","path":"/clientes/{id}"},"version":1}""",
            json);
    }

    [Fact]
    public async Task La_lista_agrupa_por_tipo_y_ordena_por_titulo_y_solo_trae_la_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var otherApp = await CreateAppAsync(client);
        await CreateItemAsync(client, appId, "service", "Notificaciones");
        await CreateItemAsync(client, appId, "api", "Transferir");
        await CreateItemAsync(client, appId, "database", "Clientes");
        await CreateItemAsync(client, appId, "api", "Consultar saldo");
        await CreateItemAsync(client, otherApp, "api", "De otra app");

        var items = await client.GetFromJsonAsync<CatalogItemResponse[]>(CatalogUri(appId));

        Assert.Equal(
            ["api:Consultar saldo", "api:Transferir", "database:Clientes", "service:Notificaciones"],
            items!.Select(i => $"{i.Type}:{i.Title}"));
    }

    [Fact]
    public async Task App_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var missing = Guid.CreateVersion7();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(CatalogUri(missing))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync(CatalogUri(missing), new CreateCatalogItemRequest("api", "x", null, null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(ItemUri(missing))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PutAsJsonAsync(ItemUri(missing), new UpdateCatalogItemRequest("x", null, null, 1))).StatusCode);
    }

    [Theory]
    [InlineData("""{"type":"screen","title":"x"}""", "Type")]
    [InlineData("""{"type":"api","title":"  "}""", "Title")]
    [InlineData("""{"type":"service","title":"x","http":{"method":"GET"}}""", "Http")]
    [InlineData("""{"type":"api","title":"x","http":{"method":"FETCH"}}""", "Http/method")]
    public async Task Crear_con_datos_invalidos_responde_400(string body, string field)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var response = await client.PostAsync(CatalogUri(appId), Json(body));

        await AssertValidationErrorAsync(response, field);
    }

    [Fact]
    public async Task Titulo_de_mas_de_120_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var response = await client.PostAsJsonAsync(
            CatalogUri(appId), new CreateCatalogItemRequest("database", new string('x', 121), null, null));

        await AssertValidationErrorAsync(response, "Title");
    }

    [Fact]
    public async Task Editar_sube_la_version_y_al_leer_trae_lo_guardado()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, appId, "api", "Consultar cliente");

        var response = await client.PutAsJsonAsync(
            ItemUri(item.Id),
            new UpdateCatalogItemRequest("Buscar cliente", "Por documento", TestJson.Http("POST", "/clientes/buscar"), 1));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var expected = $$"""
            {"id":"{{item.Id}}","appId":"{{appId}}","type":"api","title":"Buscar cliente","description":"Por documento",
             "http":{"method":"POST","path":"/clientes/buscar"},"version":2}
            """;
        AssertSameJson(expected, await response.Content.ReadFromJsonAsync<JsonElement>());
        AssertSameJson(expected, await client.GetFromJsonAsync<JsonElement>(ItemUri(item.Id)));
    }

    [Fact]
    public async Task Editar_con_version_vieja_responde_409_con_la_version_actual()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, appId, "service", "Notificaciones");
        await client.PutAsJsonAsync(ItemUri(item.Id), new UpdateCatalogItemRequest("Avisos", null, null, 1));

        var response = await client.PutAsJsonAsync(ItemUri(item.Id), new UpdateCatalogItemRequest("Mensajes", null, null, 1));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, problem.GetProperty("currentVersion").GetInt32());
        Assert.Equal("Avisos", (await client.GetFromJsonAsync<CatalogItemResponse>(ItemUri(item.Id)))!.Title);
    }

    [Fact]
    public async Task Editar_simultaneo_de_la_misma_version_solo_uno_gana()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, appId, "database", "Clientes");

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(i =>
            client.PutAsJsonAsync(ItemUri(item.Id), new UpdateCatalogItemRequest($"Clientes {i}", null, null, 1))));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.OK),
            r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
    }

    [Fact]
    public async Task Poner_metodo_y_ruta_a_un_elemento_que_no_es_api_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var item = await CreateItemAsync(client, appId, "database", "Clientes");

        var response = await client.PutAsJsonAsync(
            ItemUri(item.Id), new UpdateCatalogItemRequest("Clientes", null, TestJson.Http("GET", "/x"), 1));

        await AssertValidationErrorAsync(response, "Http");
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/apps/{appId}/catalog\"", doc, StringComparison.Ordinal);
        Assert.Contains("\"/api/catalog/{itemId}\"", doc, StringComparison.Ordinal);
    }

    private static Uri CatalogUri(Guid appId) => new($"/api/apps/{appId}/catalog", UriKind.Relative);

    private static Uri ItemUri(Guid itemId) => new($"/api/catalog/{itemId}", UriKind.Relative);

    private static StringContent Json(string body) => new(body, System.Text.Encoding.UTF8, "application/json");

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Catálogo"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<CatalogItemResponse> CreateItemAsync(HttpClient client, Guid appId, string type, string title)
    {
        var response = await client.PostAsJsonAsync(CatalogUri(appId), new CreateCatalogItemRequest(type, title, null, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CatalogItemResponse>())!;
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }

    private static void AssertSameJson(string expected, JsonElement actual)
    {
        using var doc = JsonDocument.Parse(expected);
        Assert.True(JsonElement.DeepEquals(doc.RootElement, actual), $"Esperado {expected}\nObtenido {actual}");
    }
}
