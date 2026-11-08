using FluentValidation;
using Walkie.Modules.Sharing.Domain;

namespace Walkie.Modules.Sharing.Contracts;

internal sealed class CreateShareRequestValidator : AbstractValidator<CreateShareRequest>
{
    public CreateShareRequestValidator() =>
        RuleFor(r => r.ExpiresInDays)
            .Must(Share.AllowedDays.Contains)
            .WithMessage("La duración debe ser de 7, 30 o 90 días.");
}
