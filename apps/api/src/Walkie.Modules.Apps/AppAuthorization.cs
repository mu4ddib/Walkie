using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Features;

namespace Walkie.Modules.Apps;

/// <summary>
/// Autorización por app (ADR-0015), un solo punto de decisión para todos los módulos. <see cref="RequireAppRole{TBuilder}"/>
/// toma el recurso de la ruta (<c>appId</c>, <c>featureId</c>, <c>moduleId</c>, <c>itemId</c>, <c>assetId</c>,
/// <c>shareId</c>, <c>snapshotId</c>: cada módulo registra su <see cref="IAppScopeResolver"/>), resuelve su app y
/// compara el rol de quien llama:
/// <list type="bullet">
/// <item>recurso inexistente o persona sin membresía: <b>404</b> (no confirma que exista);</item>
/// <item>miembro con un rol menor: <b>403</b>.</item>
/// </list>
/// Deja la app en <see cref="HttpContext.Items"/> (<see cref="AppOf"/>). La metadata <see cref="AppRoleRequirement"/>
/// la revisa una prueba: ningún endpoint con un recurso de app en la ruta queda sin rol.
/// </summary>
/// <summary>Marca de un endpoint que escribe sin el candado compartido (ver <see cref="AppAuthorization.WithoutAppWriteGate{TBuilder}"/>).</summary>
public sealed record AppWriteGateExempt;

public static class AppAuthorization
{
    private const string AppKey = "walkie.app";

    public static TBuilder RequireAppRole<TBuilder>(this TBuilder builder, AppRole minimum) where TBuilder : IEndpointConventionBuilder
    {
        builder.WithMetadata(new AppRoleRequirement(minimum));
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            if (http.User.FindFirstValue("sub") is not { } userId)
            {
                return TypedResults.Unauthorized();
            }

            var (matched, appId) = await ResolveAsync(http).ConfigureAwait(false);
            if (!matched)
            {
                throw new InvalidOperationException($"{http.GetEndpoint()?.DisplayName}: RequireAppRole sin un recurso de app en la ruta.");
            }

            if (appId is not { } id)
            {
                return NotFound();
            }

            // Una escritura toma el candado compartido de la app (ADR-0017) y lo mantiene hasta terminar: una eliminación
            // espera a que acabe y ninguna escritura empieza mientras se elimina. Con el candado tomado se resuelve de
            // nuevo: lo que se marcó para eliminar mientras se esperaba ya no existe.
            if (!IsWrite(http))
            {
                return await AuthorizeAsync(http, context, next, id, userId, minimum).ConfigureAwait(false);
            }

            var locks = http.RequestServices.GetRequiredService<AppLocks>();
            await using var gate = await locks.SharedAsync(id, http.RequestAborted).ConfigureAwait(false);
            if (gate is null)
            {
                return TypedResults.Problem(title: "La app está ocupada (se está eliminando algo en ella): vuelve a intentarlo en unos segundos.",
                    statusCode: StatusCodes.Status409Conflict);
            }

            if ((await ResolveAsync(http).ConfigureAwait(false)).AppId != id)
            {
                return NotFound();
            }

            var checkpoints = http.RequestServices.GetRequiredService<IAppWriteCheckpoints>();
            var route = $"{http.Request.Method} {http.GetEndpoint()?.DisplayName}";
            await checkpoints.EnteredAsync(id, route, http.RequestAborted).ConfigureAwait(false);
            var result = await AuthorizeAsync(http, context, next, id, userId, minimum).ConfigureAwait(false);
            await checkpoints.LeavingAsync(id, route, CancellationToken.None).ConfigureAwait(false);
            return result;
        });
        return builder;
    }

    /// <summary>
    /// Un endpoint que escribe pero no toma el candado compartido: eliminar una feature o una app, que toman el
    /// exclusivo (con el compartido de la misma solicitud se esperarían a sí mismos).
    /// </summary>
    public static TBuilder WithoutAppWriteGate<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.WithMetadata(new AppWriteGateExempt());

    private static bool IsWrite(HttpContext http) =>
        !(HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method) || HttpMethods.IsOptions(http.Request.Method))
        && http.GetEndpoint()?.Metadata.GetMetadata<AppWriteGateExempt>() is null;

    private static async ValueTask<object?> AuthorizeAsync(HttpContext http, EndpointFilterInvocationContext context, EndpointFilterDelegate next,
        Guid appId, string userId, AppRole minimum)
    {
        var role = await http.RequestServices.GetRequiredService<IAppAccess>().RoleAsync(appId, userId, http.RequestAborted).ConfigureAwait(false);
        if (role is null)
        {
            return NotFound();
        }

        if (role < minimum)
        {
            return TypedResults.Problem(
                title: string.Create(CultureInfo.InvariantCulture,
                    $"Tu rol en esta app ({AppRoles.ToValue(role.Value)}) no permite esta acción: hace falta {AppRoles.ToValue(minimum)}."),
                statusCode: StatusCodes.Status403Forbidden);
        }

        http.Items[AppKey] = appId;
        return await next(context).ConfigureAwait(false);
    }

    private static ProblemHttpResult NotFound() =>
        TypedResults.Problem(title: "No existe o no tienes acceso a esta app.", statusCode: StatusCodes.Status404NotFound);

    /// <summary>La app del recurso que autorizó <see cref="RequireAppRole{TBuilder}"/> en esta solicitud.</summary>
    public static Guid AppOf(HttpContext http) =>
        http.Items.TryGetValue(AppKey, out var value) && value is Guid id ? id : throw new InvalidOperationException("La solicitud no pasó por RequireAppRole.");

    private static async Task<(bool Matched, Guid? AppId)> ResolveAsync(HttpContext http)
    {
        foreach (var resolver in http.RequestServices.GetServices<IAppScopeResolver>())
        {
            if (http.Request.RouteValues.TryGetValue(resolver.RouteKey, out var raw)
                && Guid.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), out var id))
            {
                return (true, await resolver.AppOfAsync(id, http.RequestAborted).ConfigureAwait(false));
            }
        }

        return (false, null);
    }
}
