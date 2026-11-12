using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Walkie.Modules.Export.Features;

namespace Walkie.Modules.Export;

/// <summary>
/// Punto de entrada público del módulo Export: exportar una feature o una app (Markdown, contexto para IA, PDF, <c>.walkie</c>)
/// e importar un <c>.walkie</c> (specs export-markdown y exportar-e-importar). Sin tablas.
/// </summary>
public static class ExportModule
{
    public static IServiceCollection AddExportModule(this IServiceCollection services)
    {
        services.AddScoped<ExportHandlers>();
        services.AddScoped<ImportHandlers>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }

    /// <summary>Endpoints de export (<c>/api/features/{featureId}/export</c>, <c>/api/apps/{appId}/export</c>) e import.</summary>
    public static IEndpointRouteBuilder MapExportModule(this IEndpointRouteBuilder routes) => routes.MapExportEndpoints();
}
