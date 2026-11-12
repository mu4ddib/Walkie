using FluentValidation;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Walkie.Modules.Apps.Features;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps;

/// <summary>Punto de entrada público del módulo Apps.</summary>
public static class AppsModule
{
    public static IServiceCollection AddAppsModule(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<AppsDbContext>(options => options.UseNpgsql(connectionString, ConfigureNpgsql));
        services.AddValidatorsFromAssemblyContaining<AppsDbContext>(includeInternalTypes: true);
        services.AddScoped<AppsHandlers>();
        services.AddScoped<CatalogHandlers>();
        services.AddScoped<Contracts.IFeatureDirectory, FeatureDirectory>();
        services.AddScoped<Contracts.ICatalogDirectory, CatalogDirectory>();
        services.AddScoped<Contracts.IAppDirectory, AppDirectory>();
        services.AddScoped<Contracts.IAppWriter, AppWriter>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>Endpoints <c>/api/apps</c>, <c>/api/apps/{appId}/features</c>, <c>/api/apps/{appId}/catalog</c> y <c>/api/catalog</c>.</summary>
    public static IEndpointRouteBuilder MapAppsModule(this IEndpointRouteBuilder routes) =>
        routes.MapAppsEndpoints().MapCatalogEndpoints();

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
