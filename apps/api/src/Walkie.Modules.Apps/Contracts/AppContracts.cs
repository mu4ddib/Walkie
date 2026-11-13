namespace Walkie.Modules.Apps.Contracts;

public sealed record CreateAppRequest(string Name);

/// <param name="FeatureCount">Cantidad de features de la app (tarjetas de la galería).</param>
public sealed record AppResponse(Guid Id, string Name, DateTimeOffset CreatedAt, int FeatureCount);

public sealed record CreateFeatureRequest(string Name, string? Description = null);

/// <summary>Renombrar la feature y editar su descripción (<c>null</c> o vacía la borra).</summary>
public sealed record UpdateFeatureRequest(string Name, string? Description);

/// <param name="Kind"><c>feature</c> o <c>module</c> (ADR-0010).</param>
public sealed record FeatureResponse(
    Guid Id, Guid AppId, string Name, string Description, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    string Kind = "feature");
