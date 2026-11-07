using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Walkie.Modules.Canvas.Features;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas;

/// <summary>Punto de entrada público del módulo Canvas.</summary>
public static class CanvasModule
{
    public static IServiceCollection AddCanvasModule(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<CanvasDbContext>(options => options.UseNpgsql(connectionString, ConfigureNpgsql));
        services.AddSingleton<GraphValidator>();
        services.AddScoped<CanvasHandlers>();
        services.AddScoped<Apps.Contracts.ICatalogUsage, CatalogUsage>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>Endpoints <c>/api/features/{featureId}/canvas</c>.</summary>
    public static IEndpointRouteBuilder MapCanvasModule(this IEndpointRouteBuilder routes) => routes.MapCanvasEndpoints();

    /// <summary>Aplica las migraciones pendientes del módulo.</summary>
    public static async Task MigrateCanvasDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CanvasDbContext>();
        await db.Database.MigrateAsync(cancellationToken).ConfigureAwait(false);
    }

    internal static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) =>
        npgsql.MigrationsHistoryTable("__ef_migrations_history", CanvasDbContext.Schema);
}
