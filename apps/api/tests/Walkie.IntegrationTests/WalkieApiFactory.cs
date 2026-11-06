using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Testcontainers.PostgreSql;

namespace Walkie.IntegrationTests;

/// <summary>
/// Host de pruebas compartido por toda la colección <see cref="ApiTestGroup"/>:
/// Postgres real (Testcontainers) con las migraciones aplicadas, y un emisor de tokens local
/// en lugar de Keycloak. La validación de emisor, audiencia y expiración sigue activa.
/// </summary>
public sealed class WalkieApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string Issuer = "https://walkie-tests.local";
    public const string Audience = "walkie-api";

    private static readonly SymmetricSecurityKey SigningKey =
        new(Encoding.UTF8.GetBytes("clave-de-pruebas-de-integracion-walkie-0123456789"));

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17")
        .WithDatabase("walkie_tests")
        .Build();

    public async Task InitializeAsync() => await _postgres.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await DisposeAsync();
        await _postgres.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Walkie", _postgres.GetConnectionString());
        builder.UseSetting("Database:MigrateOnStartup", "true");

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
        var exp = expires ?? DateTime.UtcNow.AddMinutes(5);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = audience,
            Expires = exp,
            NotBefore = exp.AddMinutes(-10),
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

/// <summary>Un solo host y un solo contenedor de Postgres para todas las pruebas de la API.</summary>
[CollectionDefinition(Name)]
public sealed class ApiTestGroup : ICollectionFixture<WalkieApiFactory>
{
    public const string Name = "api";
}
