using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Features;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery;

/// <summary>
/// Punto de entrada público del módulo Discovery (spec walkie-live, ADR-0012): análisis de proyectos locales
/// (<c>.walkiepack</c>) guardados en el schema <c>discovery</c>. Capa complementaria: depende de Apps (que la app
/// exista) y nadie depende de él. Apagado por defecto (<see cref="DiscoveryOptions"/>).
/// </summary>
public static partial class DiscoveryModule
{
    public static IServiceCollection AddDiscoveryModule(this IServiceCollection services, string connectionString, IConfiguration configuration)
    {
        services.AddDbContext<DiscoveryDbContext>(options => options.UseNpgsql(connectionString, ConfigureNpgsql));
        services.Configure<DiscoveryOptions>(configuration.GetSection(DiscoveryOptions.Section));
        services.AddScoped<SnapshotHandlers>();
        services.AddScoped<ReviewHandlers>();
        services.AddScoped<ApplyHandlers>();
        services.AddScoped<SourceHandlers>();
        services.AddScoped<IDiscoveryReader, DiscoveryReader>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>
    /// <c>POST /api/apps/{appId}/sources/snapshots</c>, <c>GET /api/apps/{appId}/sources</c>,
    /// <c>GET /api/snapshots/{snapshotId}/review</c> y <c>POST /api/snapshots/{snapshotId}/apply</c>. Si Discovery está encendido fuera de Development, lo avisa en el
    /// log: falta la autorización por app (bloqueo de seguridad de ADR-0012).
    /// </summary>
    public static IEndpointRouteBuilder MapDiscoveryModule(this IEndpointRouteBuilder routes)
    {
        ArgumentNullException.ThrowIfNull(routes);
        var services = routes.ServiceProvider;
        if (services.GetRequiredService<IOptionsMonitor<DiscoveryOptions>>().CurrentValue.Enabled
            && !services.GetRequiredService<IHostEnvironment>().IsDevelopment())
        {
            LogEnabledOutsideDevelopment(services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DiscoveryModule)));
        }

        return routes.MapSnapshotEndpoints();
    }

    /// <summary>Aplica las migraciones pendientes del módulo.</summary>
    public static async Task MigrateDiscoveryDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        await db.Database.MigrateAsync(cancellationToken).ConfigureAwait(false);
    }

    internal static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) =>
        npgsql.MigrationsHistoryTable("__ef_migrations_history", DiscoveryDbContext.Schema);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Discovery está encendido fuera de Development. Falta la autorización por app (ADR-0012): cualquier usuario autenticado vería los análisis de cualquier app. No lo uses con proyectos privados ni usuarios reales.")]
    private static partial void LogEnabledOutsideDevelopment(ILogger logger);
}
