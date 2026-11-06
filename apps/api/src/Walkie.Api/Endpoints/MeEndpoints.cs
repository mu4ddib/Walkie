using System.Security.Claims;

namespace Walkie.Api.Endpoints;

internal static class MeEndpoints
{
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/me", (ClaimsPrincipal user) => TypedResults.Ok(new MeResponse(
                Id: user.FindFirstValue("sub") ?? "",
                Name: user.FindFirstValue("name") ?? user.Identity?.Name ?? "",
                Email: user.FindFirstValue("email"))))
            .WithName("GetMe")
            .WithTags("Auth")
            .WithSummary("Usuario autenticado según el access token.");

        return app;
    }
}

internal sealed record MeResponse(string Id, string Name, string? Email);
