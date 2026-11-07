using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Integridad de assetId y targetFeatureId (spec imagenes-portal, criterios 6, 11 y 12 en la API).</summary>
[Collection(ApiTestGroup.Name)]
public sealed class ScreenAssetsAndPortalsTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task Un_lienzo_con_imagen_y_portal_de_su_app_se_guarda_y_recarga_identico()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var login = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var transferir = await CreateFeatureAsync(client, app, "Transferir");
        var asset = await UploadAsync(client, app);

        var saved = await SaveAsync(client, login, Graph(0, asset.ToString(), transferir.ToString()));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        using var expected = JsonDocument.Parse(Graph(1, asset.ToString(), transferir.ToString()).ToJsonString());
        Assert.True(JsonElement.DeepEquals(
            expected.RootElement, await client.GetFromJsonAsync<JsonElement>(CanvasUri(login))));
    }

    [Fact]
    public async Task Una_imagen_inexistente_de_otra_app_o_invalida_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var foreign = await UploadAsync(client, await CreateAppAsync(client));

        foreach (var assetId in new[] { Guid.CreateVersion7().ToString(), foreign.ToString(), "no-es-un-id" })
        {
            await AssertErrorAsync(await SaveAsync(client, feature, Graph(0, assetId, null)), "/nodes/s1/assetId");
        }
    }

    [Fact]
    public async Task Un_portal_a_una_feature_inexistente_de_otra_app_o_invalida_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var foreign = await CreateFeatureAsync(client, await CreateAppAsync(client), "De otra app");

        foreach (var target in new[] { Guid.CreateVersion7().ToString(), foreign.ToString(), "no-es-un-id" })
        {
            await AssertErrorAsync(await SaveAsync(client, feature, Graph(0, null, target)), "/nodes/p1/targetFeatureId");
        }
    }

    [Theory]
    [InlineData("api", "assetId", "/nodes/x/assetId")]
    [InlineData("screen", "targetFeatureId", "/nodes/x/targetFeatureId")]
    public async Task Imagen_fuera_de_una_pantalla_o_destino_fuera_de_un_portal_responde_400(
        string type, string property, string errorPath)
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var graph = Graph(0, null, null);
        graph["nodes"]!["x"] = new JsonObject
        {
            ["id"] = "x", ["type"] = type, ["title"] = "x", [property] = Guid.CreateVersion7().ToString(),
        };

        await AssertErrorAsync(await SaveAsync(client, feature, graph), errorPath);
    }

    [Fact]
    public async Task Un_portal_sin_destino_es_valido()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Iniciar sesión");

        var saved = await SaveAsync(client, feature, Graph(0, null, null));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    }

    /// <summary>Una pantalla (con imagen si se da) conectada a un portal (con destino si se da). Datos ficticios.</summary>
    private static JsonObject Graph(int version, string? assetId, string? targetFeatureId)
    {
        var screen = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login" };
        if (assetId is not null)
        {
            screen["assetId"] = assetId;
        }

        var portal = new JsonObject { ["id"] = "p1", ["type"] = "portal", ["title"] = "Transferir" };
        if (targetFeatureId is not null)
        {
            portal["targetFeatureId"] = targetFeatureId;
        }

        return new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = version,
            ["nodes"] = new JsonObject { ["s1"] = screen, ["p1"] = portal },
            ["edges"] = new JsonObject
            {
                ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" },
            },
            ["layout"] = new JsonObject(),
        };
    }

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static Task<HttpResponseMessage> SaveAsync(HttpClient client, Guid featureId, JsonObject graph) =>
        client.PutAsJsonAsync(CanvasUri(featureId), graph);

    private static async Task AssertErrorAsync(HttpResponseMessage response, string path)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(path, problem!.Errors.Keys);
    }

    private static async Task<Guid> UploadAsync(HttpClient client, Guid appId)
    {
        using var file = new ByteArrayContent(TestImages.Create("png", 2, 2));
        file.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        using var content = new MultipartFormDataContent { { file, "file", "pantalla.png" } };
        var response = await client.PostAsync(new Uri($"/api/apps/{appId}/assets", UriKind.Relative), content);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AssetResponse>())!.Id;
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Portales"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest(name));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }
}
