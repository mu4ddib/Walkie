using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Walkie.Modules.Canvas.Contracts;

namespace Walkie.Modules.Canvas.Features;

/// <summary>Endpoints de los módulos compartidos (spec modulos-compartidos, ADR-0010).</summary>
internal static class ModuleEndpoints
{
    public static IEndpointRouteBuilder MapModuleEndpoints(this IEndpointRouteBuilder routes)
    {
        var app = routes.MapGroup("/api/apps/{appId:guid}/modules").WithTags("Modules");

        app.MapGet("/", List)
            .WithName("ListModules")
            .WithSummary("Resúmenes de los módulos de la app (packages/schema/walkie-module-summary.schema.json).");

        app.MapPost("/", Create)
            .WithName("CreateModule")
            .WithSummary("Crea un módulo vacío; el id lo puede generar el cliente (reintentar no duplica).")
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        app.MapPost("/extract", Extract)
            .WithName("ExtractModule")
            .WithSummary("Convierte una selección en módulo: crea el módulo con su lienzo y guarda la feature, o no deja nada.")
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        var module = routes.MapGroup("/api/modules/{moduleId:guid}").WithTags("Modules");

        module.MapGet("/", Get).WithName("GetModule").WithSummary("Resumen de un módulo.");

        module.MapDelete("/", Delete)
            .WithName("DeleteModule")
            .WithSummary("Borra el módulo y su lienzo; si alguna feature lo usa responde 409 salvo con ?force=true (sus cajas quedan pendientes).")
            .ProducesProblem(StatusCodes.Status409Conflict);

        module.MapGet("/usages", Usages)
            .WithName("GetModuleUsages")
            .WithSummary("Lienzos que referencian el módulo, con sus cajas y las conexiones a cada interfaz.");

        return routes;
    }

    private static string UserId(ClaimsPrincipal user) =>
        user.FindFirstValue("sub") ?? throw new InvalidOperationException("El token no trae el claim sub.");

    private static async Task<Results<Ok<IReadOnlyList<ModuleSummary>>, NotFound>> List(
        Guid appId, ModuleHandlers handlers, CancellationToken ct) =>
        await handlers.ListAsync(appId, ct).ConfigureAwait(false) is { } list ? TypedResults.Ok(list) : TypedResults.NotFound();

    private static async Task<Results<Ok<ModuleSummary>, NotFound>> Get(Guid moduleId, ModuleHandlers handlers, CancellationToken ct) =>
        await handlers.GetAsync(moduleId, ct).ConfigureAwait(false) is { } summary ? TypedResults.Ok(summary) : TypedResults.NotFound();

    private static async Task<Results<Created<ModuleSummary>, NotFound, ValidationProblem, ProblemHttpResult>> Create(
        Guid appId, CreateModuleRequest request, ClaimsPrincipal user, ModuleHandlers handlers, CancellationToken ct) =>
        await handlers.CreateAsync(appId, request, UserId(user), ct).ConfigureAwait(false) switch
        {
            ModuleResult.Done done => TypedResults.Created($"/api/modules/{done.Module.Id}", done.Module),
            ModuleResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors, title: "El módulo no es válido."),
            ModuleResult.Conflict conflict => TypedResults.Problem(statusCode: StatusCodes.Status409Conflict, title: "No se pudo crear el módulo.", detail: conflict.Detail),
            _ => TypedResults.NotFound(),
        };

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Delete(
        Guid moduleId, ModuleHandlers handlers, CancellationToken ct, bool force = false) =>
        await handlers.DeleteAsync(moduleId, force, ct).ConfigureAwait(false) switch
        {
            DeleteModuleResult.Deleted => TypedResults.NoContent(),
            DeleteModuleResult.InUse inUse => TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "El módulo se usa en otros lienzos.",
                detail: "Quita sus cajas de esos lienzos o bórralo igual (quedarán pendientes).",
                extensions: new Dictionary<string, object?> { ["usedBy"] = inUse.UsedBy }),
            _ => TypedResults.NotFound(),
        };

    private static async Task<Results<Ok<IReadOnlyList<ModuleUsage>>, NotFound>> Usages(
        Guid moduleId, ModuleHandlers handlers, CancellationToken ct) =>
        await handlers.UsagesAsync(moduleId, ct).ConfigureAwait(false) is { } list ? TypedResults.Ok(list) : TypedResults.NotFound();

    private static async Task<Results<Ok<ExtractModuleResponse>, NotFound, ValidationProblem, ProblemHttpResult>> Extract(
        Guid appId, ExtractModuleRequest request, ClaimsPrincipal user, ModuleHandlers handlers, CancellationToken ct) =>
        await handlers.ExtractAsync(appId, request, UserId(user), ct).ConfigureAwait(false) switch
        {
            ExtractResult.Done done => TypedResults.Ok(done.Response),
            ExtractResult.Invalid invalid => TypedResults.ValidationProblem(invalid.Errors, title: "La conversión no es válida."),
            ExtractResult.Conflict conflict => TypedResults.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "No se pudo convertir en módulo.",
                detail: conflict.Detail,
                extensions: new Dictionary<string, object?> { ["currentVersion"] = conflict.CurrentVersion }),
            _ => TypedResults.NotFound(),
        };
}
