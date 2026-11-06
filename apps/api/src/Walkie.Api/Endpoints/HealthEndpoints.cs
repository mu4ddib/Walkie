using Walkie.Shared;

namespace Walkie.Api.Endpoints;

internal static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/health", () => TypedResults.Ok(new HealthResponse("ok", WalkieInfo.SchemaVersion)))
            .WithName("GetHealth")
            .WithTags("Health")
            .AllowAnonymous();

        return app;
    }
}

internal sealed record HealthResponse(string Status, int SchemaVersion);
