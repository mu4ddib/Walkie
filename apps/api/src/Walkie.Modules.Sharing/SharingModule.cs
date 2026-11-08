using FluentValidation;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Walkie.Modules.Sharing.Features;
using Walkie.Modules.Sharing.Persistence;

namespace Walkie.Modules.Sharing;

/// <summary>Punto de entrada público del módulo Sharing: enlaces de solo lectura (ADR-0005).</summary>
public static class SharingModule
{
    public static IServiceCollection AddSharingModule(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<SharingDbContext>(options => options.UseNpgsql(connectionString, ConfigureNpgsql));
        services.AddValidatorsFromAssemblyContaining<SharingDbContext>(includeInternalTypes: true);
        services.AddScoped<ShareHandlers>();
        services.AddScoped<PublicShareHandlers>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>
    /// Endpoints con sesión <c>/api/features/{featureId}/shares</c> y <c>/api/shares/{shareId}</c>,
    /// y sin sesión <c>/api/public/shares/{token}</c>.
    /// </summary>
    public static IEndpointRouteBuilder MapSharingModule(this IEndpointRouteBuilder routes) =>
        routes.MapShareEndpoints().MapPublicShareEndpoints();

    /// <summary>Aplica las migraciones pendientes del módulo.</summary>
    public static async Task MigrateSharingDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SharingDbContext>();
        await db.Database.MigrateAsync(cancellationToken).ConfigureAwait(false);
    }

    internal static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) =>
        npgsql.MigrationsHistoryTable("__ef_migrations_history", SharingDbContext.Schema);
}
