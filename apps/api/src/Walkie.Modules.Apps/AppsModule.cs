using FluentValidation;
using Microsoft.AspNetCore.Builder;
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
        // Autorización por app (ADR-0015): membresías, personas que entraron y a qué app pertenece cada id de la ruta.
        services.AddMemoryCache();
        services.AddScoped<Contracts.IAppAccess, AppAccess>();
        services.AddScoped<Contracts.IUserDirectory, UserDirectory>();
        services.AddScoped<Contracts.IAppScopeResolver, AppIdScope>();
        services.AddScoped<Contracts.IAppScopeResolver, FeatureScope>();
        services.AddScoped<Contracts.IAppScopeResolver, ModuleScope>();
        services.AddScoped<Contracts.IAppScopeResolver, CatalogItemScope>();
        services.AddScoped<MembersHandlers>();
        // Eliminar apps y features (ADR-0017): orquestación, puntos de prueba y recuperación de las pendientes.
        services.AddScoped<DeletionHandlers>();
        services.AddSingleton(new AppLocks(connectionString));
        services.TryAddScoped<Contracts.IAppWriteCheckpoints, NoAppWriteCheckpoints>();
        services.TryAddScoped<Contracts.IDeletionCheckpoints, NoDeletionCheckpoints>();
        services.AddHostedService<DeletionRecovery>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>Endpoints <c>/api/apps</c>, <c>/api/apps/{appId}/features</c>, <c>/api/apps/{appId}/catalog</c> y <c>/api/catalog</c>.</summary>
    public static IEndpointRouteBuilder MapAppsModule(this IEndpointRouteBuilder routes) =>
        routes.MapAppsEndpoints().MapCatalogEndpoints().MapMembersEndpoints().MapDeletionEndpoints();

    /// <summary>
    /// Anota a quien entra (<c>sub</c>, correo y nombre del token) para poder sumarlo a una app por correo (ADR-0015).
    /// Va después de <c>UseAuthentication</c>; las solicitudes sin sesión pasan de largo.
    /// </summary>
    public static IApplicationBuilder UseKnownUsers(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (context.User.Identity?.IsAuthenticated == true && context.User.FindFirst("sub")?.Value is { } userId)
            {
                await context.RequestServices.GetRequiredService<Contracts.IUserDirectory>()
                    .SeenAsync(userId, context.User.FindFirst("email")?.Value, context.User.FindFirst("name")?.Value, context.RequestAborted)
                    .ConfigureAwait(false);
            }

            await next(context).ConfigureAwait(false);
        });

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
