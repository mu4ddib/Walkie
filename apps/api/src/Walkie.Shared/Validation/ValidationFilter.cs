using FluentValidation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Walkie.Shared.Validation;

/// <summary>
/// Valida el cuerpo <typeparamref name="T"/> con su <see cref="IValidator{T}"/> antes del handler.
/// Si falla responde 400 con <c>ValidationProblemDetails</c> (RFC 9457).
/// </summary>
public sealed class ValidationFilter<T> : IEndpointFilter
    where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var validator = context.HttpContext.RequestServices.GetRequiredService<IValidator<T>>();
        var body = context.Arguments.OfType<T>().FirstOrDefault();
        if (body is null)
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Falta el cuerpo de la petición.");
        }

        var result = await validator.ValidateAsync(body, context.HttpContext.RequestAborted).ConfigureAwait(false);
        if (!result.IsValid)
        {
            return TypedResults.ValidationProblem(result.ToDictionary());
        }

        return await next(context).ConfigureAwait(false);
    }
}

public static class ValidationFilterExtensions
{
    /// <summary>Agrega <see cref="ValidationFilter{T}"/> al endpoint y documenta el 400.</summary>
    public static RouteHandlerBuilder WithValidation<T>(this RouteHandlerBuilder builder)
        where T : class =>
        builder.AddEndpointFilter<ValidationFilter<T>>().ProducesValidationProblem();
}
