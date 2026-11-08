using System.Text.Json.Serialization;

namespace Walkie.Modules.Sharing.Contracts;

/// <summary>Duración del enlace en días: 7, 30 o 90.</summary>
public sealed record CreateShareRequest(int ExpiresInDays);

/// <summary>
/// Coincide con <c>packages/schema/walkie-share.schema.json</c>. <c>Token</c> solo viaja al crear el enlace;
/// <c>LastAccessedAt</c> falta si nunca se abrió.
/// </summary>
public sealed record ShareResponse(
    Guid Id,
    Guid FeatureId,
    string CreatedByName,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? LastAccessedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Token);
