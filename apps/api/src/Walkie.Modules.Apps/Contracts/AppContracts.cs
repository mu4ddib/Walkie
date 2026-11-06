namespace Walkie.Modules.Apps.Contracts;

public sealed record CreateAppRequest(string Name);

public sealed record AppResponse(Guid Id, string Name, DateTimeOffset CreatedAt);

public sealed record CreateFeatureRequest(string Name);

public sealed record FeatureResponse(Guid Id, Guid AppId, string Name, DateTimeOffset CreatedAt);
