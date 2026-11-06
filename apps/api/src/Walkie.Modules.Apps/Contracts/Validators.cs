using FluentValidation;
using Walkie.Modules.Apps.Domain;

namespace Walkie.Modules.Apps.Contracts;

internal sealed class CreateAppRequestValidator : AbstractValidator<CreateAppRequest>
{
    public CreateAppRequestValidator() =>
        RuleFor(r => r.Name).ValidName(App.NameMaxLength);
}

internal sealed class CreateFeatureRequestValidator : AbstractValidator<CreateFeatureRequest>
{
    public CreateFeatureRequestValidator() =>
        RuleFor(r => r.Name).ValidName(Feature.NameMaxLength);
}

internal static class NameRules
{
    /// <summary>Nombre obligatorio (sin contar espacios) y con largo máximo tras recortar.</summary>
    public static IRuleBuilderOptions<T, string> ValidName<T>(this IRuleBuilder<T, string> rule, int maxLength) =>
        rule
            .Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("El nombre es obligatorio.")
            .Must(name => name is null || name.Trim().Length <= maxLength)
            .WithMessage($"El nombre no puede tener más de {maxLength} caracteres.");
}
