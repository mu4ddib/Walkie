using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Walkie.IntegrationTests;

/// <summary>
/// Host de pruebas. Reemplaza el proveedor OIDC por una clave simétrica local para
/// poder emitir tokens sin Keycloak. La validación de emisor, audiencia y expiración sigue activa.
/// </summary>
public sealed class WalkieApiFactory : WebApplicationFactory<Program>
{
    public const string Issuer = "https://walkie-tests.local";
    public const string Audience = "walkie-api";

    private static readonly SymmetricSecurityKey SigningKey =
        new(Encoding.UTF8.GetBytes("clave-de-pruebas-de-integracion-walkie-0123456789"));

    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, jwt =>
            {
                jwt.Authority = null;
                jwt.ConfigurationManager = null;
                jwt.TokenValidationParameters.ValidIssuer = Issuer;
                jwt.TokenValidationParameters.ValidAudience = Audience;
                jwt.TokenValidationParameters.IssuerSigningKey = SigningKey;
            }));
    }

    public static string CreateToken(
        string sub = "user-1",
        string name = "Ana Prueba",
        string email = "ana@walkie.test",
        string audience = Audience,
        DateTime? expires = null)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = audience,
            Expires = expires ?? DateTime.UtcNow.AddMinutes(5),
            NotBefore = (expires ?? DateTime.UtcNow.AddMinutes(5)).AddMinutes(-10),
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", sub),
                new Claim("name", name),
                new Claim("email", email),
                new Claim("preferred_username", "ana"),
            ]),
            SigningCredentials = new SigningCredentials(SigningKey, SecurityAlgorithms.HmacSha256),
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    public HttpClient CreateAuthenticatedClient(string? token = null)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token ?? CreateToken());
        return client;
    }
}
