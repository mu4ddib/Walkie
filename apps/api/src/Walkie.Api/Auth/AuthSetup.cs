using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;

namespace Walkie.Api.Auth;

internal static class AuthSetup
{
    /// <summary>
    /// Valida access tokens JWT de un proveedor OIDC (Keycloak en desarrollo).
    /// Por defecto todo endpoint exige usuario autenticado; los públicos usan <c>AllowAnonymous()</c>.
    /// </summary>
    public static IServiceCollection AddWalkieAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new AuthOptions();
        if (string.IsNullOrWhiteSpace(options.Authority))
        {
            throw new InvalidOperationException("Falta Auth:Authority (variable de entorno Auth__Authority).");
        }

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                jwt.Authority = options.Authority;
                jwt.Audience = options.Audience;
                jwt.RequireHttpsMetadata = options.RequireHttpsMetadata;
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters.NameClaimType = "preferred_username";
            });

        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

        return services;
    }
}
