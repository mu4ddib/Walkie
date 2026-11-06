using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.IntegrationTests;

[Collection(ApiTestGroup.Name)]
public sealed class AppsEndpointsTests(WalkieApiFactory factory)
{
    [Theory]
    [InlineData("GET", "/api/apps")]
    [InlineData("POST", "/api/apps")]
    [InlineData("GET", "/api/apps/0193a1b2-0000-7000-8000-000000000001")]
    [InlineData("GET", "/api/apps/0193a1b2-0000-7000-8000-000000000001/features")]
    [InlineData("POST", "/api/apps/0193a1b2-0000-7000-8000-000000000001/features")]
    public async Task Sin_token_responde_401(string method, string path)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), new Uri(path, UriKind.Relative))
        {
            Content = JsonContent.Create(new { name = "x" }),
        };

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Crear_app_responde_201_con_location_y_guarda_el_autor()
    {
        using var client = factory.CreateAuthenticatedClient(WalkieApiFactory.CreateToken(sub: "autor-apps"));

        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("  Banca móvil  "));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var app = await response.Content.ReadFromJsonAsync<AppResponse>();
        Assert.NotNull(app);
        Assert.Equal("Banca móvil", app.Name);
        Assert.Equal($"/api/apps/{app.Id}", response.Headers.Location?.OriginalString);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
        Assert.Equal("autor-apps", (await db.Apps.SingleAsync(a => a.Id == app.Id)).CreatedBy);
    }

    [Fact]
    public async Task La_app_creada_aparece_en_la_lista_y_por_id()
    {
        using var client = factory.CreateAuthenticatedClient();
        var created = await CreateAppAsync(client, $"Lista {Guid.NewGuid():N}");

        var list = await client.GetFromJsonAsync<List<AppResponse>>(new Uri("/api/apps", UriKind.Relative));
        var byId = await client.GetFromJsonAsync<AppResponse>(new Uri($"/api/apps/{created.Id}", UriKind.Relative));

        Assert.Contains(list!, a => a.Id == created.Id);
        Assert.Equal(created, byId);
    }

    [Fact]
    public async Task App_inexistente_responde_404_problem_details()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync(new Uri($"/api/apps/{Guid.CreateVersion7()}", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Crear_app_sin_nombre_responde_400(string name)
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(name));

        await AssertValidationErrorAsync(response, "Name");
    }

    [Fact]
    public async Task Crear_app_con_nombre_de_mas_de_120_caracteres_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(new string('a', 121)));

        await AssertValidationErrorAsync(response, "Name");
    }

    [Fact]
    public async Task Crear_app_sin_cuerpo_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PostAsync(new Uri("/api/apps", UriKind.Relative), JsonContent.Create<object?>(null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Crear_feature_y_listarla_en_su_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client, "Con features");
        var otherApp = await CreateAppAsync(client, "Otra");

        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{app.Id}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión"));
        await client.PostAsJsonAsync(
            new Uri($"/api/apps/{otherApp.Id}/features", UriKind.Relative), new CreateFeatureRequest("Ajena"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var feature = await response.Content.ReadFromJsonAsync<FeatureResponse>();
        Assert.NotNull(feature);
        Assert.Equal(app.Id, feature.AppId);
        Assert.Equal($"/api/apps/{app.Id}/features/{feature.Id}", response.Headers.Location?.OriginalString);

        var features = await client.GetFromJsonAsync<List<FeatureResponse>>(
            new Uri($"/api/apps/{app.Id}/features", UriKind.Relative));
        Assert.Equal([feature], features);
    }

    [Fact]
    public async Task Features_de_una_app_inexistente_responden_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var missing = Guid.CreateVersion7();

        var create = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{missing}/features", UriKind.Relative), new CreateFeatureRequest("Huérfana"));
        var list = await client.GetAsync(new Uri($"/api/apps/{missing}/features", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, create.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, list.StatusCode);
    }

    [Fact]
    public async Task Crear_feature_sin_nombre_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client, "Validación");

        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{app.Id}/features", UriKind.Relative), new CreateFeatureRequest(""));

        await AssertValidationErrorAsync(response, "Name");
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/apps\"", doc, StringComparison.Ordinal);
        Assert.Contains("\"/api/apps/{appId}\"", doc, StringComparison.Ordinal);
        Assert.Contains("\"/api/apps/{appId}/features\"", doc, StringComparison.Ordinal);
    }

    private static async Task<AppResponse> CreateAppAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(name));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!;
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.NotNull(problem);
        Assert.Contains(field, problem.Errors.Keys);
    }
}
