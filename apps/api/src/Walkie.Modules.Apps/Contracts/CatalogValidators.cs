using FluentValidation;
using Walkie.Modules.Apps.Domain;

namespace Walkie.Modules.Apps.Contracts;

/// <summary>Mismos límites que <c>packages/schema/walkie-catalog-item.schema.json</c>.</summary>
internal sealed class CreateCatalogItemRequestValidator : AbstractValidator<CreateCatalogItemRequest>
{
    public CreateCatalogItemRequestValidator()
    {
        RuleFor(r => r.Type)
            .Must(t => CatalogItem.Types.Contains(t))
            .WithMessage("El tipo debe ser api, service o database.");
        RuleFor(r => r.Title).ValidTitle();
        RuleFor(r => r.Description).ValidText();
        RuleFor(r => r.Http).ValidHttp();
        RuleFor(r => r.Http)
            .Null().When(r => r.Type != "api")
            .WithMessage("Solo los elementos api tienen método y ruta.");
    }
}

internal sealed class UpdateCatalogItemRequestValidator : AbstractValidator<UpdateCatalogItemRequest>
{
    public UpdateCatalogItemRequestValidator()
    {
        RuleFor(r => r.Title).ValidTitle();
        RuleFor(r => r.Description).ValidText();
        RuleFor(r => r.Http).ValidHttp();
        RuleFor(r => r.Version).GreaterThanOrEqualTo(1).WithMessage("La versión debe ser 1 o más.");
    }
}

internal static class CatalogRules
{
    public static IRuleBuilderOptions<T, string> ValidTitle<T>(this IRuleBuilder<T, string> rule) =>
        rule
            .Must(title => !string.IsNullOrWhiteSpace(title)).WithMessage("El título es obligatorio.")
            .Must(title => title is null || title.Trim().Length <= CatalogItem.TitleMaxLength)
            .WithMessage($"El título no puede tener más de {CatalogItem.TitleMaxLength} caracteres.");

    public static IRuleBuilderOptions<T, string?> ValidText<T>(this IRuleBuilder<T, string?> rule) =>
        rule
            .Must(text => text is null || text.Trim().Length <= CatalogItem.TextMaxLength)
            .WithMessage($"El texto no puede tener más de {CatalogItem.TextMaxLength} caracteres.");

    public static void ValidHttp<T>(this IRuleBuilder<T, HttpContract?> rule) =>
        rule.ChildRules(http =>
        {
            http.RuleFor(h => h!.Method)
                .Must(m => m is null || CatalogItem.HttpMethods.Contains(m))
                .WithMessage("El método debe ser GET, POST, PUT, PATCH o DELETE.");
            http.RuleFor(h => h!.Path).ValidText();
        });
}
