namespace Walkie.Modules.Files.Contracts;

/// <summary>Coincide con <c>packages/schema/walkie-asset.schema.json</c>.</summary>
public sealed record AssetResponse(Guid Id, Guid AppId, string ContentType, long Size, int Width, int Height);
