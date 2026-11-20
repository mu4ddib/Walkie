using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Validation;

namespace Walkie.Modules.Apps.Features;

/// <summary>Miembros de una app (ADR-0015): <c>/api/apps/{appId}/members</c>.</summary>
internal static class MembersEndpoints
{
    public static IEndpointRouteBuilder MapMembersEndpoints(this IEndpointRouteBuilder routes)
    {
        var members = routes.MapGroup("/api/apps/{appId:guid}/members").WithTags("Members");

        members.MapGet("/", List).WithName("ListMembers").WithSummary("Miembros de la app con su rol.").RequireAppRole(AppRole.Viewer);
        members.MapPost("/", Add).WithName("AddMember")
            .WithSummary("Suma a una persona por su correo (tiene que haber entrado a Walkie al menos una vez).")
            .WithValidation<AddMemberRequest>().RequireAppRole(AppRole.Owner);
        members.MapPut("/{userId}", Update).WithName("UpdateMember").WithSummary("Cambia el rol; siempre queda un owner.")
            .WithValidation<UpdateMemberRequest>().RequireAppRole(AppRole.Owner);
        members.MapDelete("/{userId}", Remove).WithName("RemoveMember")
            .WithSummary("Quita a una persona (un owner a cualquiera; cada uno a sí mismo); siempre queda un owner.")
            .RequireAppRole(AppRole.Viewer);
        return routes;
    }

    private static async Task<Ok<IReadOnlyList<AppMemberResponse>>> List(Guid appId, MembersHandlers handlers, CancellationToken ct) =>
        TypedResults.Ok(await handlers.ListAsync(appId, ct).ConfigureAwait(false));

    private static async Task<IResult> Add(Guid appId, AddMemberRequest request, ClaimsPrincipal user, MembersHandlers handlers, CancellationToken ct) =>
        ToResult(await handlers.AddAsync(appId, request, UserId(user), ct).ConfigureAwait(false), created: true);

    private static async Task<IResult> Update(Guid appId, string userId, UpdateMemberRequest request, MembersHandlers handlers, CancellationToken ct) =>
        ToResult(await handlers.UpdateAsync(appId, userId, request.Role, ct).ConfigureAwait(false));

    private static async Task<IResult> Remove(
        Guid appId, string userId, ClaimsPrincipal user, IAppAccess access, MembersHandlers handlers, CancellationToken ct)
    {
        var actor = UserId(user);
        var role = await access.RoleAsync(appId, actor, ct).ConfigureAwait(false) ?? AppRole.Viewer;
        return ToResult(await handlers.RemoveAsync(appId, userId, actor, role, ct).ConfigureAwait(false));
    }

    private static IResult ToResult(MemberResult result, bool created = false) => result switch
    {
        MemberResult.Done { Member: null } => TypedResults.NoContent(),
        MemberResult.Done done => created
            ? TypedResults.Created($"/api/apps/members/{done.Member!.UserId}", done.Member)
            : TypedResults.Ok(done.Member),
        MemberResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors),
        MemberResult.Conflict conflict => TypedResults.Problem(title: conflict.Message, statusCode: StatusCodes.Status409Conflict),
        MemberResult.Forbidden forbidden => TypedResults.Problem(title: forbidden.Message, statusCode: StatusCodes.Status403Forbidden),
        _ => TypedResults.NotFound(),
    };

    private static string UserId(ClaimsPrincipal user) =>
        user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");
}
