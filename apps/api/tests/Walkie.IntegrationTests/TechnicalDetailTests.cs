using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>
/// Detalle técnico (spec espacio-de-trabajo, criterios 13 a 15 y 17 en la API): contrato de una API, estructura de una
/// base de datos, notas y detalle de las conexiones, en el lienzo y en el catálogo. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class TechnicalDetailTests(WalkieApiFactory factory)
{
    private const string Contract = """
        {
          "method": "POST",
          "path": "/transferencias",
          "auth": { "type": "bearer", "description": "Token del canal" },
          "params": [{ "name": "X-Canal", "in": "header", "type": "string", "required": true, "example": "app" }],
          "request": {
            "contentType": "application/json",
            "fields": [{ "name": "monto", "type": "number", "required": true, "description": "En pesos", "example": "1000" }],
            "example": "{ \"monto\": 1000 }"
          },
          "responses": [
            { "status": 201, "description": "Creada", "fields": [{ "name": "id", "type": "uuid" }] },
            { "status": 422, "description": "Saldo insuficiente", "example": "{ \"codigo\": \"SALDO\" }" }
          ]
        }
        """;

    private const string Structure = """
        {
          "engine": "PostgreSQL",
          "name": "core",
          "schemas": ["pagos"],
          "tables": [{
            "name": "transferencias",
            "schema": "pagos",
            "kind": "table",
            "fields": [
              { "name": "id", "type": "uuid", "key": "primary" },
              { "name": "cuenta_id", "type": "uuid", "key": "foreign", "nullable": false }
            ],
            "relations": [{ "field": "cuenta_id", "references": "cuentas.id" }]
          }]
        }
        """;

    [Fact]
    public async Task El_lienzo_guarda_contrato_estructura_notas_y_detalle_de_conexiones()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client, await CreateAppAsync(client));
        var graph = $$"""
            {
              "schemaVersion": 0, "version": 0,
              "nodes": {
                "a1": { "id": "a1", "type": "actor", "title": "Cliente", "notes": "Inicia la transferencia" },
                "p1": { "id": "p1", "type": "api", "title": "Transferir", "http": {{Contract}} },
                "d1": { "id": "d1", "type": "database", "title": "Core", "database": {{Structure}} }
              },
              "edges": {
                "e1": { "id": "e1", "from": "p1", "to": "d1", "kind": "writes", "notes": "En una transacción",
                        "data": { "operation": "write", "entities": ["transferencias"] }, "example": "INSERT …" }
              },
              "layout": { "a1": { "x": 0, "y": 0 }, "p1": { "x": 240, "y": 0 }, "d1": { "x": 480, "y": 0 } }
            }
            """;

        var put = await PutRawAsync(client, CanvasUri(featureId), graph);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var saved = await client.GetFromJsonAsync<JsonElement>(CanvasUri(featureId));
        var expected = TestJson.Parse(graph);
        Assert.True(JsonElement.DeepEquals(expected.GetProperty("nodes"), saved.GetProperty("nodes")));
        Assert.True(JsonElement.DeepEquals(expected.GetProperty("edges"), saved.GetProperty("edges")));
    }

    [Theory]
    [InlineData("""{ "id": "p1", "type": "api", "title": "X", "http": { "responses": [{ "status": 700 }] } }""", "/nodes/p1/http/responses/0/status")]
    [InlineData("""{ "id": "p1", "type": "api", "title": "X", "http": { "params": [{ "name": "id", "in": "body" }] } }""", "/nodes/p1/http/params/0/in")]
    [InlineData("""{ "id": "p1", "type": "screen", "title": "X", "http": { "method": "GET" } }""", "/nodes/p1/http")]
    [InlineData("""{ "id": "p1", "type": "api", "title": "X", "database": { "engine": "PostgreSQL" } }""", "/nodes/p1/database")]
    public async Task Detalle_tecnico_invalido_en_el_lienzo_responde_400(string node, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client, await CreateAppAsync(client));
        var graph = $$"""{ "schemaVersion": 0, "version": 0, "nodes": { "p1": {{node}} }, "edges": {}, "layout": {} }""";

        var response = await PutRawAsync(client, CanvasUri(featureId), graph);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(path, problem!.Errors.Keys);
    }

    [Fact]
    public async Task Una_operacion_de_datos_desconocida_en_la_conexion_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var featureId = await CreateFeatureAsync(client, await CreateAppAsync(client));
        const string graph = """
            {
              "schemaVersion": 0, "version": 0,
              "nodes": { "a": { "id": "a", "type": "api", "title": "A" }, "b": { "id": "b", "type": "database", "title": "B" } },
              "edges": { "e1": { "id": "e1", "from": "a", "to": "b", "kind": "writes", "data": { "operation": "delete" } } },
              "layout": {}
            }
            """;

        var response = await PutRawAsync(client, CanvasUri(featureId), graph);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains("/edges/e1/data/operation", problem!.Errors.Keys);
    }

    [Fact]
    public async Task El_catalogo_guarda_el_contrato_y_la_estructura_compartidos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var api = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("api", "Transferir", null, TestJson.Parse(Contract)));
        var db = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("database", "Core", null, null, TestJson.Parse(Structure)));

        Assert.Equal(HttpStatusCode.Created, api.StatusCode);
        Assert.Equal(HttpStatusCode.Created, db.StatusCode);
        var apiItem = await api.Content.ReadFromJsonAsync<JsonElement>();
        var dbItem = await db.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(JsonElement.DeepEquals(TestJson.Parse(Contract), apiItem.GetProperty("http")));
        Assert.True(JsonElement.DeepEquals(TestJson.Parse(Structure), dbItem.GetProperty("database")));

        var update = await client.PutAsJsonAsync(
            ItemUri(dbItem.GetProperty("id").GetGuid()),
            new UpdateCatalogItemRequest("Core", null, null, 1, TestJson.Parse("""{ "engine": "Oracle" }""")));
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Oracle", updated.GetProperty("database").GetProperty("engine").GetString());
        Assert.Equal(2, updated.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Un_contrato_que_no_cumple_el_schema_responde_400_con_su_ruta()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var badStatus = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("api", "X", null, TestJson.Parse("""{ "responses": [{ "status": 99 }] }""")));
        var wrongType = await client.PostAsJsonAsync(CatalogUri(appId),
            new CreateCatalogItemRequest("api", "X", null, null, TestJson.Parse("""{ "engine": "PostgreSQL" }""")));

        await AssertValidationErrorAsync(badStatus, "Http/responses/0/status");
        await AssertValidationErrorAsync(wrongType, "Database");
    }

    [Fact]
    public async Task Editar_la_estructura_de_un_elemento_api_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var created = await client.PostAsJsonAsync(CatalogUri(appId), new CreateCatalogItemRequest("api", "X", null, null));
        var id = (await created.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;

        var response = await client.PutAsJsonAsync(
            ItemUri(id), new UpdateCatalogItemRequest("X", null, null, 1, TestJson.Parse("""{ "engine": "Oracle" }""")));

        await AssertValidationErrorAsync(response, "Database");
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
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Transferir"));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }
}
