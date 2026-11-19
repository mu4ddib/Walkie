using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;

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

            var role = appId is { } id
                ? await http.RequestServices.GetRequiredService<IAppAccess>().RoleAsync(id, userId, http.RequestAborted).ConfigureAwait(false)
                : null;
            if (role is null)
            {
                return TypedResults.Problem(title: "No existe o no tienes acceso a esta app.", statusCode: StatusCodes.Status404NotFound);
            }

            if (role < minimum)
            {
                return TypedResults.Problem(
                    title: string.Create(CultureInfo.InvariantCulture,
                        $"Tu rol en esta app ({AppRoles.ToValue(role.Value)}) no permite esta acción: hace falta {AppRoles.ToValue(minimum)}."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            http.Items[AppKey] = appId!.Value;
            return await next(context).ConfigureAwait(false);
        });
        return builder;
    }

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
