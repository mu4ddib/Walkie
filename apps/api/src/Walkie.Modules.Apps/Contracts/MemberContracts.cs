using System.Text.Json.Serialization;
using FluentValidation;

namespace Walkie.Modules.Apps.Contracts;

/// <summary>Un miembro de una app (<c>walkie-app-member.schema.json</c>, ADR-0015).</summary>
public sealed record AppMemberResponse(
    string UserId,
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Email,
    string Role,
    DateTimeOffset GrantedAt);

/// <summary>Suma a alguien por su correo: tiene que haber entrado a Walkie al menos una vez.</summary>
public sealed record AddMemberRequest(string Email, string Role);

public sealed record UpdateMemberRequest(string Role);

internal sealed class AddMemberRequestValidator : AbstractValidator<AddMemberRequest>
{
    public AddMemberRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty().WithMessage("Escribe el correo de la persona.").MaximumLength(320).EmailAddress().WithMessage("No parece un correo.");
        RuleFor(r => r.Role).Must(r => AppRoles.Parse(r) is not null).WithMessage("El rol es owner, editor o viewer.");
    }
}

internal sealed class UpdateMemberRequestValidator : AbstractValidator<UpdateMemberRequest>
{
    public UpdateMemberRequestValidator() =>
        RuleFor(r => r.Role).Must(r => AppRoles.Parse(r) is not null).WithMessage("El rol es owner, editor o viewer.");
}
