namespace Walkie.Modules.Apps.Domain;

/// <summary>
/// Una persona que entró a Walkie al menos una vez (ADR-0015): su <c>sub</c>, su nombre y su correo según el último
/// token. Sirve para sumarla a una app por correo y para mostrar quiénes son los miembros. No es un perfil editable.
/// </summary>
internal sealed class AppUser
{
    public const int NameMaxLength = 200;
    public const int EmailMaxLength = 320;

    public required string Id { get; init; }
    public string? Email { get; set; }
    public string Name { get; set; } = "";
    public DateTimeOffset FirstSeenAt { get; init; }
    public DateTimeOffset LastSeenAt { get; set; }
}
