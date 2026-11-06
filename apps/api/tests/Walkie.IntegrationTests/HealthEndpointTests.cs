using System.Net;
using System.Net.Http.Json;

namespace Walkie.IntegrationTests;

public sealed class HealthEndpointTests(WalkieApiFactory factory)
    : IClassFixture<WalkieApiFactory>
{
    [Fact]
    public async Task Health_responde_ok_con_la_version_del_schema()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/api/health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<HealthBody>();
        Assert.NotNull(body);
        Assert.Equal("ok", body.Status);
        Assert.Equal(0, body.SchemaVersion);
    }

    [Fact]
    public async Task Ruta_inexistente_responde_problem_details()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync(new Uri("/api/no-existe", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    private sealed record HealthBody(string Status, int SchemaVersion);
}
