using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Modules.Sharing.Persistence;

namespace Walkie.IntegrationTests;

/// <summary>Endpoints sin sesión de un enlace (spec enlace-solo-lectura, criterios 9 a 11 en la API). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class PublicSharesTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task Sin_sesion_un_enlace_activo_devuelve_la_feature_y_solo_el_catalogo_que_usa()
    {
        using var author = factory.CreateAuthenticatedClient();
        var shared = await ArrangeAsync(author);
        using var anonymous = factory.CreateClient();

        var response = await anonymous.GetAsync(ViewUri(shared.Token));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Banca de prueba", body.GetProperty("appName").GetString());
        Assert.Equal("Iniciar sesión", body.GetProperty("featureName").GetString());
        Assert.Equal(shared.ExpiresAt, body.GetProperty("expiresAt").GetDateTimeOffset());
        Assert.True(JsonElement.DeepEquals(
            await author.GetFromJsonAsync<JsonElement>(CanvasUri(shared.FeatureId)), body.GetProperty("graph")));
        var catalog = body.GetProperty("catalog").EnumerateArray().ToList();
        Assert.Equal(shared.UsedItem, Assert.Single(catalog).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Abrir_el_enlace_registra_el_ultimo_acceso()
    {
        using var author = factory.CreateAuthenticatedClient();
        var shared = await ArrangeAsync(author);
        using var anonymous = factory.CreateClient();

        await anonymous.GetAsync(ViewUri(shared.Token));

        var list = await author.GetFromJsonAsync<ShareResponse[]>(SharesUri(shared.FeatureId));
        Assert.NotNull(Assert.Single(list!).LastAccessedAt);
    }

    [Fact]
    public async Task Despues_de_guardar_el_enlace_muestra_la_ultima_version()
    {
        using var author = factory.CreateAuthenticatedClient();
        var shared = await ArrangeAsync(author);
        var graph = Graph(1, shared.Asset, shared.UsedItem);
        graph["nodes"]!["s1"]!["title"] = "Login nuevo";
        Assert.Equal(HttpStatusCode.OK, (await author.PutAsJsonAsync(CanvasUri(shared.FeatureId), graph)).StatusCode);
        using var anonymous = factory.CreateClient();

        var body = await anonymous.GetFromJsonAsync<JsonElement>(ViewUri(shared.Token));

        Assert.Equal(2, body.GetProperty("graph").GetProperty("version").GetInt32());
        Assert.Equal("Login nuevo", body.GetProperty("graph").GetProperty("nodes").GetProperty("s1").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Una_feature_sin_lienzo_guardado_se_comparte_vacia()
    {
        using var author = factory.CreateAuthenticatedClient();
        var (_, feature) = await CreateFeatureAsync(author);
        var share = await CreateShareAsync(author, feature);
        using var anonymous = factory.CreateClient();

        var body = await anonymous.GetFromJsonAsync<JsonElement>(ViewUri(share.Token!));

        Assert.Equal(0, body.GetProperty("graph").GetProperty("version").GetInt32());
        Assert.Empty(body.GetProperty("catalog").EnumerateArray());
    }

    [Theory]
    [InlineData("revocado")]
    [InlineData("caducado")]
    [InlineData("inexistente")]
    [InlineData("malformado")]
    public async Task Un_enlace_que_no_esta_activo_responde_404_en_la_feature_y_en_las_imagenes(string caso)
    {
        using var author = factory.CreateAuthenticatedClient();
        var shared = await ArrangeAsync(author);
        var token = caso switch
        {
            "inexistente" => new string('A', 43),
            "malformado" => "no-es-un-token",
            _ => shared.Token,
        };
        if (caso == "revocado")
        {
            Assert.Equal(HttpStatusCode.NoContent, (await author.DeleteAsync(new Uri($"/api/shares/{shared.ShareId}", UriKind.Relative))).StatusCode);
        }
        else if (caso == "caducado")
        {
            await using var scope = factory.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<SharingDbContext>().Shares
                .Where(s => s.Id == shared.ShareId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
        }

        using var anonymous = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(ViewUri(token))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(AssetUri(token, shared.Asset))).StatusCode);
    }

    [Fact]
    public async Task Sin_sesion_se_lee_la_imagen_que_usa_una_pantalla_del_lienzo()
    {
        using var author = factory.CreateAuthenticatedClient();
        var shared = await ArrangeAsync(author);
        using var anonymous = factory.CreateClient();

        var response = await anonymous.GetAsync(AssetUri(shared.Token, shared.Asset));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal(TestImages.Create("png", 2, 2), await response.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Una_imagen_que_ninguna_pantalla_usa_o_de_otra_app_responde_404()
    {
        using var author = factory.CreateAuthenticatedClient();
        var shared = await ArrangeAsync(author);
        var unused = await UploadAsync(author, shared.AppId);
        var (otherApp, _) = await CreateFeatureAsync(author);
        var foreign = await UploadAsync(author, otherApp);
        using var anonymous = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(AssetUri(shared.Token, unused))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(AssetUri(shared.Token, foreign))).StatusCode);
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/public/shares/{token}\"", doc, StringComparison.Ordinal);
        Assert.Contains("\"/api/public/shares/{token}/assets/{assetId}\"", doc, StringComparison.Ordinal);
    }

    private sealed record Shared(Guid AppId, Guid FeatureId, Guid ShareId, string Token, DateTimeOffset ExpiresAt, Guid Asset, Guid UsedItem);

    /// <summary>Feature con una pantalla con imagen y un <c>ref</c> a un elemento del catálogo (hay otro sin usar), y un enlace.</summary>
    private static async Task<Shared> ArrangeAsync(HttpClient author)
    {
        var (appId, featureId) = await CreateFeatureAsync(author);
        var used = await CreateItemAsync(author, appId, "Consultar cliente");
        await CreateItemAsync(author, appId, "Otro servicio");
        var asset = await UploadAsync(author, appId);
        Assert.Equal(HttpStatusCode.OK, (await author.PutAsJsonAsync(CanvasUri(featureId), Graph(0, asset, used))).StatusCode);
        var share = await CreateShareAsync(author, featureId);
        return new Shared(appId, featureId, share.Id, share.Token!, share.ExpiresAt, asset, used);
    }

    private static JsonObject Graph(int version, Guid asset, Guid item) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = version,
        ["nodes"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login", ["assetId"] = asset.ToString() },
            ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "Consultar cliente", ["catalogId"] = item.ToString() },
        },
        ["edges"] = new JsonObject(),
        ["layout"] = new JsonObject(),
    };

    private static Uri ViewUri(string token) => new($"/api/public/shares/{token}", UriKind.Relative);

    private static Uri AssetUri(string token, Guid assetId) => new($"/api/public/shares/{token}/assets/{assetId}", UriKind.Relative);

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static Uri SharesUri(Guid featureId) => new($"/api/features/{featureId}/shares", UriKind.Relative);

    private static async Task<ShareResponse> CreateShareAsync(HttpClient client, Guid featureId)
    {
        var response = await client.PostAsJsonAsync(SharesUri(featureId), new CreateShareRequest(30));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ShareResponse>())!;
    }

    private static async Task<Guid> CreateItemAsync(HttpClient client, Guid appId, string title)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), new CreateCatalogItemRequest("service", title, null, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
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

    private static async Task<(Guid AppId, Guid FeatureId)> CreateFeatureAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Banca de prueba"));
        var appId = (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var feature = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión"));
        return (appId, (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id);
    }
}
