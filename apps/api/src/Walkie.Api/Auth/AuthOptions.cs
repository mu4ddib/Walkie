namespace Walkie.Api.Auth;

/// <summary>Configuración OIDC (sección <c>Auth</c>). Ver ADR-0003.</summary>
internal sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Emisor de tokens, ej. <c>http://localhost:8080/realms/walkie</c>.</summary>
    public string Authority { get; init; } = "";

    /// <summary>Valor esperado en el claim <c>aud</c> del access token.</summary>
    public string Audience { get; init; } = "walkie-api";

    /// <summary>Solo <c>false</c> en desarrollo (Keycloak local sin TLS).</summary>
    public bool RequireHttpsMetadata { get; init; } = true;
}
