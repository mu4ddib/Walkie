using System.Net;
using System.Net.Http.Json;

namespace Walkie.IntegrationTests;

public sealed class AuthTests(WalkieApiFactory factory) : IClassFixture<WalkieApiFactory>
{
    private static readonly Uri Me = new("/api/me", UriKind.Relative);

    [Fact]
    public async Task Sin_token_responde_401()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(Me);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Con_token_valido_devuelve_el_usuario()
    {
        using var client = factory.CreateAuthenticatedClient();

        var me = await client.GetFromJsonAsync<MeBody>(Me);

        Assert.NotNull(me);
        Assert.Equal("user-1", me.Id);
        Assert.Equal("Ana Prueba", me.Name);
        Assert.Equal("ana@walkie.test", me.Email);
    }

    [Fact]
    public async Task Token_con_otra_audiencia_responde_401()
    {
        using var client = factory.CreateAuthenticatedClient(WalkieApiFactory.CreateToken(audience: "otra-api"));

        var response = await client.GetAsync(Me);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Token_expirado_responde_401()
    {
        using var client = factory.CreateAuthenticatedClient(
            WalkieApiFactory.CreateToken(expires: DateTime.UtcNow.AddMinutes(-10)));

        var response = await client.GetAsync(Me);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Ruta_inexistente_sin_token_responde_401_sin_revelar_rutas()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/api/no-existe", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Health_no_requiere_token()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/api/health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private sealed record MeBody(string Id, string Name, string? Email);
}
