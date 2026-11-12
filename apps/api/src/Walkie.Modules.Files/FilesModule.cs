using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Walkie.Modules.Files.Features;
using Walkie.Modules.Files.Persistence;
using Walkie.Modules.Files.Storage;

namespace Walkie.Modules.Files;

/// <summary>Punto de entrada público del módulo Files (ADR-0004).</summary>
public static class FilesModule
{
    public static IServiceCollection AddFilesModule(
        this IServiceCollection services, string connectionString, IConfiguration configuration)
    {
        services.AddDbContext<FilesDbContext>(options => options.UseNpgsql(connectionString, ConfigureNpgsql));
        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.Section));
        services.AddSingleton<IFileStorage, S3FileStorage>();
        services.AddScoped<AssetHandlers>();
        services.AddScoped<Contracts.IAssetDirectory, AssetDirectory>();
        services.AddScoped<Contracts.IAssetWriter, AssetWriter>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>Endpoints <c>/api/apps/{appId}/assets</c> y <c>/api/assets/{assetId}</c>.</summary>
    public static IEndpointRouteBuilder MapFilesModule(this IEndpointRouteBuilder routes) => routes.MapAssetEndpoints();

    /// <summary>Aplica las migraciones pendientes y crea el bucket si no existe.</summary>
    public static async Task MigrateFilesAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FilesDbContext>();
        await db.Database.MigrateAsync(cancellationToken).ConfigureAwait(false);
        await scope.ServiceProvider.GetRequiredService<IFileStorage>().EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
    }

    internal static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) =>
        npgsql.MigrationsHistoryTable("__ef_migrations_history", FilesDbContext.Schema);
}
