using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Walkie.Modules.Export.Features;

namespace Walkie.Modules.Export;

/// <summary>Punto de entrada público del módulo Export: una feature como Markdown (spec export-markdown). Sin tablas.</summary>
public static class ExportModule
{
    public static IServiceCollection AddExportModule(this IServiceCollection services)
    {
        services.AddScoped<ExportHandlers>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>Endpoint <c>/api/features/{featureId}/export</c>.</summary>
    public static IEndpointRouteBuilder MapExportModule(this IEndpointRouteBuilder routes) => routes.MapExportEndpoints();
}
