using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Subir y leer imágenes (spec imagenes-portal, criterio 3 en la API). Imágenes sintéticas, sin datos reales.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class FilesEndpointsTests(WalkieApiFactory factory)
{
    private const string AnyId = "0193a1b2-0000-7000-8000-000000000001";

    [Theory]
    [InlineData("POST", $"/api/apps/{AnyId}/assets")]
    [InlineData("GET", $"/api/assets/{AnyId}")]
    public async Task Sin_token_responde_401(string method, string path)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
    }

    [Theory]
    [InlineData("png", "image/png", 3, 2)]
    [InlineData("jpeg", "image/jpeg", 4, 5)]
    [InlineData("webp", "image/webp", 6, 7)]
    public async Task Subir_una_imagen_responde_201_y_se_descarga_igual(string kind, string contentType, int width, int height)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var bytes = TestImages.Create(kind, width, height);

        var response = await UploadAsync(client, appId, bytes, "pantalla.bin", "application/octet-stream");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var asset = (await response.Content.ReadFromJsonAsync<AssetResponse>())!;
        Assert.Equal(new AssetResponse(asset.Id, appId, contentType, bytes.Length, width, height), asset);
        Assert.Equal($"/api/assets/{asset.Id}", response.Headers.Location?.ToString());

        var download = await client.GetAsync(new Uri($"/api/assets/{asset.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal(contentType, download.Content.Headers.ContentType?.MediaType);
        Assert.Contains("immutable", download.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(bytes, await download.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Un_archivo_que_no_es_imagen_aunque_diga_png_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8.ToArray();

        var response = await UploadAsync(client, appId, svg, "logo.png", "image/png");

        await AssertFileErrorAsync(response, "Solo se aceptan imágenes PNG, JPEG o WebP.");
    }

    [Fact]
    public async Task Una_imagen_de_mas_de_5_MB_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var big = TestImages.Create("png", 1, 1);
        Array.Resize(ref big, (5 * 1024 * 1024) + 1);

        var response = await UploadAsync(client, appId, big, "grande.png", "image/png");

        await AssertFileErrorAsync(response, "La imagen no puede pesar más de 5 MB.");
    }

    [Fact]
    public async Task Sin_archivo_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        using var content = new MultipartFormDataContent { { new StringContent("x"), "otro" } };

        var response = await client.PostAsync(AssetsUri(appId), content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task App_o_asset_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();

        var upload = await UploadAsync(client, Guid.CreateVersion7(), TestImages.Create("png", 1, 1), "a.png", "image/png");
        var download = await client.GetAsync(new Uri($"/api/assets/{Guid.CreateVersion7()}", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, upload.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/apps/{appId}/assets\"", doc, StringComparison.Ordinal);
        Assert.Contains("\"/api/assets/{assetId}\"", doc, StringComparison.Ordinal);
    }

    private static Uri AssetsUri(Guid appId) => new($"/api/apps/{appId}/assets", UriKind.Relative);

    private static async Task<HttpResponseMessage> UploadAsync(
        HttpClient client, Guid appId, byte[] bytes, string fileName, string contentType)
    {
        using var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        using var content = new MultipartFormDataContent { { file, "file", fileName } };
        return await client.PostAsync(AssetsUri(appId), content);
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Imágenes"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task AssertFileErrorAsync(HttpResponseMessage response, string message)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal([message], problem!.Errors["file"]);
    }
}
