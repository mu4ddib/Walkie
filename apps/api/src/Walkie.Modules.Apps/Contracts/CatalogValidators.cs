using System.Text.Json;
using FluentValidation;
using Walkie.Modules.Apps.Domain;
using Walkie.Shared.Schemas;

namespace Walkie.Modules.Apps.Contracts;

/// <summary>Mismos límites que <c>packages/schema/walkie-catalog-item.schema.json</c>; el contrato se valida con el schema.</summary>
internal sealed class CreateCatalogItemRequestValidator : AbstractValidator<CreateCatalogItemRequest>
{
    public CreateCatalogItemRequestValidator()
    {
        RuleFor(r => r.Type)
            .Must(t => CatalogItem.Types.Contains(t))
            .WithMessage("El tipo debe ser api, service o database.");
        RuleFor(r => r.Title).ValidTitle();
        RuleFor(r => r.Description).ValidText();
        RuleFor(r => r.Http).MatchesSchema(WalkieSchemas.Http);
        RuleFor(r => r.Database).MatchesSchema(WalkieSchemas.Database);
        RuleFor(r => r.Http)
            .Must(CatalogRules.IsEmpty).When(r => r.Type != "api")
            .WithMessage(CatalogRules.HttpOnlyOnApi);
        RuleFor(r => r.Database)
            .Must(CatalogRules.IsEmpty).When(r => r.Type != "database")
            .WithMessage(CatalogRules.DatabaseOnlyOnDatabase);
    }
}

internal sealed class UpdateCatalogItemRequestValidator : AbstractValidator<UpdateCatalogItemRequest>
{
    public UpdateCatalogItemRequestValidator()
    {
        RuleFor(r => r.Title).ValidTitle();
        RuleFor(r => r.Description).ValidText();
        RuleFor(r => r.Http).MatchesSchema(WalkieSchemas.Http);
        RuleFor(r => r.Database).MatchesSchema(WalkieSchemas.Database);
        RuleFor(r => r.Version).GreaterThanOrEqualTo(1).WithMessage("La versión debe ser 1 o más.");
    }
}

internal static class CatalogRules
{
    public const string HttpOnlyOnApi = "Solo los elementos api tienen contrato.";
    public const string DatabaseOnlyOnDatabase = "Solo los elementos database tienen estructura.";

    /// <summary>Sin valor: ausente, <c>null</c> u objeto vacío.</summary>
    public static bool IsEmpty(JsonElement? value) =>
        value is null
        || value.Value.ValueKind == JsonValueKind.Null
        || (value.Value.ValueKind == JsonValueKind.Object && !value.Value.EnumerateObject().Any());

    public static IRuleBuilderOptions<T, string> ValidTitle<T>(this IRuleBuilder<T, string> rule) =>
        rule
            .Must(title => !string.IsNullOrWhiteSpace(title)).WithMessage("El título es obligatorio.")
            .Must(title => title is null || title.Trim().Length <= CatalogItem.TitleMaxLength)
            .WithMessage($"El título no puede tener más de {CatalogItem.TitleMaxLength} caracteres.");

    public static IRuleBuilderOptions<T, string?> ValidText<T>(this IRuleBuilder<T, string?> rule) =>
        rule
            .Must(text => text is null || text.Trim().Length <= CatalogItem.TextMaxLength)
            .WithMessage($"El texto no puede tener más de {CatalogItem.TextMaxLength} caracteres.");

    /// <summary>Errores del schema con su ruta, ej. <c>Http/responses/0/status</c>.</summary>
    public static void MatchesSchema<T>(this IRuleBuilder<T, JsonElement?> rule, Json.Schema.JsonSchema schema) =>
        rule.Custom((value, context) =>
        {
            if (value is not { ValueKind: not JsonValueKind.Null } element)
            {
                return;
            }

            foreach (var (path, messages) in WalkieSchemas.Errors(schema, element, context.PropertyPath))
            {
                foreach (var message in messages)
                {
                    context.AddFailure(path, message);
                }
            }
        });
}
