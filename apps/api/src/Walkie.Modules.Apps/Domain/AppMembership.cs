namespace Walkie.Modules.Apps.Domain;

/// <summary>Una persona es miembro de una app con un rol (ADR-0015). Sin membresía, la app no existe para ella.</summary>
internal sealed class AppMembership
{
    public const string Owner = "owner";
    public const string Editor = "editor";
    public const string Viewer = "viewer";

    public Guid AppId { get; init; }

    /// <summary>Claim <c>sub</c> de la persona.</summary>
    public required string UserId { get; init; }

    public required string Role { get; set; }

    /// <summary>Quién le dio el rol (<c>sub</c>); quien crea la app se lo da a sí mismo.</summary>
    public required string GrantedBy { get; set; }

    public DateTimeOffset GrantedAt { get; set; }
}
