using System.Net;
using System.Net.Http.Json;

namespace Walkie.IntegrationTests;

/// <summary>
/// Otras personas en las pruebas (ADR-0015): un cliente con su propio <c>sub</c> y correo, que entra una vez (así queda
/// anotada) y al que un owner suma a una app por correo, como en la web.
/// </summary>
internal static class Members
{
    public static async Task<HttpClient> PersonAsync(WalkieApiFactory factory, string sub)
    {
        var client = factory.CreateAuthenticatedClient(WalkieApiFactory.CreateToken(sub: sub, name: "Persona " + sub, email: Email(sub)));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri("/api/me", UriKind.Relative))).StatusCode);
        return client;
    }

    public static string Email(string sub) => sub + "@walkie.test";

    public static async Task GrantAsync(HttpClient owner, Guid appId, string sub, string role)
    {
        var response = await owner.PostAsJsonAsync(new Uri($"/api/apps/{appId}/members", UriKind.Relative), new { email = Email(sub), role });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
