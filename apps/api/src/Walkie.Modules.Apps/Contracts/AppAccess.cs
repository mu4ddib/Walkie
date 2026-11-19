namespace Walkie.Modules.Apps.Contracts;

/// <summary>Rol de una persona en una app (ADR-0015). El orden importa: cada uno incluye lo del anterior.</summary>
public enum AppRole
{
    Viewer = 1,
    Editor = 2,
    Owner = 3,
}

/// <summary>Conversión entre <see cref="AppRole"/> y su texto en la API y en la base (<c>owner</c>, <c>editor</c>, <c>viewer</c>).</summary>
public static class AppRoles
{
    public static string ToValue(AppRole role) => role switch
    {
        AppRole.Owner => "owner",
        AppRole.Editor => "editor",
        _ => "viewer",
    };

    public static AppRole? Parse(string? value) => value switch
    {
        "owner" => AppRole.Owner,
        "editor" => AppRole.Editor,
        "viewer" => AppRole.Viewer,
        _ => null,
    };
}

/// <summary>Metadata del endpoint: el rol mínimo que exige (la agrega <c>RequireAppRole</c>; la prueba de cobertura la busca).</summary>
public sealed record AppRoleRequirement(AppRole Minimum);

/// <summary>
/// Resuelve a qué app pertenece el recurso de un valor de ruta (<see cref="RouteKey"/>, ej. <c>featureId</c>). Apps
/// define la interfaz y cada módulo registra la suya para sus ids (como <see cref="ICatalogUsage"/>): así el filtro de
/// autorización vive en un solo lugar sin referencias en ciclo. Null si el recurso no existe.
/// </summary>
public interface IAppScopeResolver
{
    string RouteKey { get; }

    Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken);
}

/// <summary>Membresías: el rol de una persona en una app y las apps de una persona.</summary>
public interface IAppAccess
{
    /// <summary>Null si no es miembro (o la app no existe).</summary>
    Task<AppRole?> RoleAsync(Guid appId, string userId, CancellationToken cancellationToken);

    /// <summary>Las apps de las que es miembro.</summary>
    Task<IReadOnlySet<Guid>> AppsOfAsync(string userId, CancellationToken cancellationToken);
}

/// <summary>Personas que entraron a Walkie: se anotan al autenticarse (para sumarlas a una app por correo).</summary>
public interface IUserDirectory
{
    Task SeenAsync(string userId, string? email, string? name, CancellationToken cancellationToken);
}
