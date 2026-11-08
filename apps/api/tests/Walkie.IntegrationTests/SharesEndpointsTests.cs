using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Modules.Sharing.Persistence;

namespace Walkie.IntegrationTests;

/// <summary>Enlaces de solo lectura con sesión (spec enlace-solo-lectura, criterios 1 a 4 y 12 en la API).</summary>
[Collection(ApiTestGroup.Name)]
public sealed class SharesEndpointsTests(WalkieApiFactory factory)
{
    private const string AnyId = "0198f0c0-0000-7000-8000-000000000000";

    [Theory]
    [InlineData("POST", $"/api/features/{AnyId}/shares")]
    [InlineData("GET", $"/api/features/{AnyId}/shares")]
    [InlineData("DELETE", $"/api/shares/{AnyId}")]
    public async Task Sin_token_responde_401(string method, string path)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), new Uri(path, UriKind.Relative))
        {
            Content = JsonContent.Create(new CreateShareRequest(30)),
        };

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(7)]
    [InlineData(30)]
    [InlineData(90)]
    public async Task Crear_un_enlace_responde_201_con_el_token_y_su_caducidad(int days)
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);

        var response = await client.PostAsJsonAsync(SharesUri(feature), new CreateShareRequest(days));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var share = (await response.Content.ReadFromJsonAsync<ShareResponse>())!;
        Assert.Equal($"/api/shares/{share.Id}", response.Headers.Location!.OriginalString);
        Assert.Equal(feature, share.FeatureId);
        Assert.Equal("Ana Prueba", share.CreatedByName);
        Assert.Equal(share.CreatedAt.AddDays(days), share.ExpiresAt);
        Assert.Null(share.LastAccessedAt);
        Assert.Matches("^[A-Za-z0-9_-]{43}$", share.Token);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    [InlineData(365)]
    public async Task Una_duracion_que_no_es_7_30_o_90_responde_400(int days)
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);

        var response = await client.PostAsJsonAsync(SharesUri(feature), new CreateShareRequest(days));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains("ExpiresInDays", problem!.Errors.Keys);
    }

    [Fact]
    public async Task Crear_o_listar_en_una_feature_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var missing = Guid.CreateVersion7();

        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync(SharesUri(missing), new CreateShareRequest(30))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(SharesUri(missing))).StatusCode);
    }

    [Fact]
    public async Task La_lista_trae_los_activos_del_mas_nuevo_al_mas_viejo_y_sin_token()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var first = await CreateShareAsync(client, feature, 7);
        var second = await CreateShareAsync(client, feature, 90);
        await CreateShareAsync(client, await CreateFeatureAsync(client), 30); // de otra feature

        var list = await client.GetFromJsonAsync<JsonElement>(SharesUri(feature));

        Assert.Equal([second.Id, first.Id], list.EnumerateArray().Select(s => s.GetProperty("id").GetGuid()));
        Assert.All(list.EnumerateArray(), s =>
        {
            Assert.False(s.TryGetProperty("token", out _));
            Assert.False(s.TryGetProperty("lastAccessedAt", out _));
        });
    }

    [Fact]
    public async Task Revocar_responde_204_y_el_enlace_sale_de_la_lista()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var share = await CreateShareAsync(client, feature, 30);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(ShareUri(share.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(ShareUri(share.Id))).StatusCode);

        Assert.Empty(await client.GetFromJsonAsync<ShareResponse[]>(SharesUri(feature)) ?? []);
    }

    [Fact]
    public async Task Revocar_un_enlace_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(ShareUri(Guid.CreateVersion7()))).StatusCode);
    }

    [Fact]
    public async Task Un_enlace_caducado_no_aparece_en_la_lista()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var share = await CreateShareAsync(client, feature, 7);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SharingDbContext>();
            await db.Shares.Where(s => s.Id == share.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        }

        Assert.Empty(await client.GetFromJsonAsync<ShareResponse[]>(SharesUri(feature)) ?? []);
    }

    [Fact]
    public async Task La_base_guarda_el_hash_del_token_y_nunca_el_token()
    {
        using var client = factory.CreateAuthenticatedClient();
        var share = await CreateShareAsync(client, await CreateFeatureAsync(client), 30);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SharingDbContext>();
        var row = await db.Database
            .SqlQuery<string>($"""SELECT row_to_json(s)::text AS "Value" FROM sharing.shares s WHERE s.id = {share.Id}""")
            .SingleAsync();
        var stored = await db.Shares.AsNoTracking().SingleAsync(s => s.Id == share.Id);

        Assert.DoesNotContain(share.Token!, row, StringComparison.Ordinal);
        Assert.Equal(SHA256.HashData(Encoding.ASCII.GetBytes(share.Token!)), stored.TokenHash);
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/features/{featureId}/shares\"", doc, StringComparison.Ordinal);
        Assert.Contains("\"/api/shares/{shareId}\"", doc, StringComparison.Ordinal);
    }

    private static Uri SharesUri(Guid featureId) => new($"/api/features/{featureId}/shares", UriKind.Relative);

    private static Uri ShareUri(Guid shareId) => new($"/api/shares/{shareId}", UriKind.Relative);

    private static async Task<ShareResponse> CreateShareAsync(HttpClient client, Guid featureId, int days)
    {
        var response = await client.PostAsJsonAsync(SharesUri(featureId), new CreateShareRequest(days));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ShareResponse>())!;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Compartir"));
        var appId = (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var feature = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión"));
        return (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }
}
