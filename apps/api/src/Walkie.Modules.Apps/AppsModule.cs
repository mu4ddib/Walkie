using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps;

/// <summary>Punto de entrada público del módulo Apps.</summary>
public static class AppsModule
{
    public static IServiceCollection AddAppsModule(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<AppsDbContext>(options => options.UseNpgsql(connectionString, ConfigureNpgsql));
        return services;
    }

    /// <summary>Aplica las migraciones pendientes del módulo.</summary>
    public static async Task MigrateAppsDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
        await db.Database.MigrateAsync(cancellationToken).ConfigureAwait(false);
    }

    internal static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) =>
        npgsql.MigrationsHistoryTable("__ef_migrations_history", AppsDbContext.Schema);
}
