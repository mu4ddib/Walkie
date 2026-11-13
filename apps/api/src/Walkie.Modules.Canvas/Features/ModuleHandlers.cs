using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Módulos compartidos (spec modulos-compartidos, ADR-0010). Un módulo es una feature de tipo <c>module</c> cuyo lienzo
/// se guarda como cualquier otro; aquí están el resumen que usan las features (con las redirecciones de las interfaces
/// quitadas, que las features resuelven al leer), crear y borrar, dónde se usa y convertir una selección en módulo (con
/// compensación si algo falla).
/// </summary>
internal sealed class ModuleHandlers(
    CanvasDbContext db,
    IAppDirectory apps,
    IFeatureDirectory features,
    ICatalogDirectory catalog,
    IAppWriter writer,
    CanvasHandlers canvases,
    GraphValidator validator)
{
    public const int NameMaxLength = 120;
    public const int DescriptionMaxLength = 500;

    /// <summary>Resúmenes de los módulos de la app, por nombre; <c>null</c> si la app no existe.</summary>
    public async Task<IReadOnlyList<ModuleSummary>?> ListAsync(Guid appId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var modules = await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false);
        if (modules.Count == 0)
        {
            return [];
        }

        var graphs = await GraphsOfAppAsync(appId, modules, ct).ConfigureAwait(false);
        var items = await CatalogOfAsync(appId, modules.Select(m => graphs.GetValueOrDefault(m.Id)), ct).ConfigureAwait(false);
        return [.. modules.Select(m => Summarize(m, graphs, items))];
    }

    /// <summary>Resumen de un módulo; <c>null</c> si no existe o no es un módulo.</summary>
    public async Task<ModuleSummary?> GetAsync(Guid moduleId, CancellationToken ct)
    {
        var module = await features.DescribeAsync(moduleId, ct).ConfigureAwait(false);
        if (module?.Kind != "module")
        {
            return null;
        }

        var modules = await features.ModulesOfAppAsync(module.AppId, ct).ConfigureAwait(false);
        var graphs = await GraphsOfAppAsync(module.AppId, modules, ct).ConfigureAwait(false);
        var items = await CatalogOfAsync(module.AppId, [graphs.GetValueOrDefault(moduleId)], ct).ConfigureAwait(false);
        return Summarize(module, graphs, items);
    }

    /// <summary>
    /// Los módulos de la app que alcanza el grafo, a cualquier profundidad (<see cref="IModuleDirectory"/>), con su
    /// resumen y su lienzo, por nombre.
    /// </summary>
    public async Task<IReadOnlyList<ModuleGraph>> ReachableAsync(Guid appId, JsonElement graph, CancellationToken ct)
    {
        var start = ModuleReferences.ModuleIdsOf(graph);
        if (start.Count == 0)
        {
            return [];
        }

        var modules = (await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false)).ToDictionary(m => m.Id);
        var graphs = await GraphsOfAppAsync(appId, [.. modules.Values], ct).ConfigureAwait(false);
        var reached = new HashSet<Guid>();
        var pending = new Queue<Guid>(start);
        while (pending.TryDequeue(out var id))
        {
            if (!modules.ContainsKey(id) || !reached.Add(id))
            {
                continue;
            }

            if (graphs.TryGetValue(id, out var inner))
            {
                foreach (var next in ModuleReferences.ModuleIdsOf(inner))
                {
                    pending.Enqueue(next);
                }
            }
        }

        var items = await CatalogOfAsync(appId, reached.Select(id => graphs.GetValueOrDefault(id)), ct).ConfigureAwait(false);
        return [.. reached
            .Select(id => new ModuleGraph(
                Summarize(modules[id], graphs, items),
                graphs.TryGetValue(id, out var g) ? g : CanvasHandlers.Parse(CanvasHandlers.EmptyGraph)))
            .OrderBy(m => m.Summary.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(m => m.Summary.Id)];
    }

    /// <summary>Errores de nombre y descripción (los de una feature); vacío si son válidos.</summary>
    public static Dictionary<string, string[]> NameErrors(string? name, string? description)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(name))
        {
            errors["Name"] = ["El nombre es obligatorio."];
        }
        else if (name.Trim().Length > NameMaxLength)
        {
            errors["Name"] = [$"El nombre no puede tener más de {NameMaxLength} caracteres."];
        }

        if (description is not null && description.Trim().Length > DescriptionMaxLength)
        {
            errors["Description"] = [$"La descripción no puede tener más de {DescriptionMaxLength} caracteres."];
        }

        return errors;
    }

    public async Task<ModuleResult> CreateAsync(Guid appId, CreateModuleRequest request, string userId, CancellationToken ct)
    {
        var errors = NameErrors(request.Name, request.Description);
        if (errors.Count > 0)
        {
            return new ModuleResult.Invalid(errors);
        }

        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return new ModuleResult.NotFound();
        }

        var id = request.Id ?? Guid.CreateVersion7();
        if (!await writer.CreateModuleAsync(appId, id, request.Name, request.Description, userId, ct).ConfigureAwait(false))
        {
            return new ModuleResult.Conflict("Ya existe un módulo o una feature con ese id.");
        }

        return new ModuleResult.Done((await GetAsync(id, ct).ConfigureAwait(false))!);
    }

    /// <summary>
    /// Borra el módulo y su lienzo. Si alguna feature lo usa, no lo borra salvo con <paramref name="force"/>: sus
    /// cajas quedan como referencias pendientes (conservan el último nombre).
    /// </summary>
    public async Task<DeleteModuleResult> DeleteAsync(Guid moduleId, bool force, CancellationToken ct)
    {
        var summary = await GetAsync(moduleId, ct).ConfigureAwait(false);
        if (summary is null)
        {
            return new DeleteModuleResult.NotFound();
        }

        if (summary.UsedBy.Count > 0 && !force)
        {
            return new DeleteModuleResult.InUse(summary.UsedBy);
        }

        await db.Canvases.Where(c => c.FeatureId == moduleId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await writer.DeleteFeaturesAsync([moduleId], ct).ConfigureAwait(false);
        return new DeleteModuleResult.Deleted();
    }

    /// <summary>Los lienzos de la app (features y módulos) que referencian el módulo; <c>null</c> si no existe.</summary>
    public async Task<IReadOnlyList<ModuleUsage>?> UsagesAsync(Guid moduleId, CancellationToken ct)
    {
        var module = await features.DescribeAsync(moduleId, ct).ConfigureAwait(false);
        if (module?.Kind != "module")
        {
            return null;
        }

        var owners = await OwnersAsync(module.AppId, ct).ConfigureAwait(false);
        var graphs = await LoadGraphsAsync(owners.Keys, ct).ConfigureAwait(false);
        var usages = new List<ModuleUsage>();
        foreach (var (featureId, graph) in graphs)
        {
            var nodes = ModuleNodes(graph, moduleId);
            if (nodes.Count == 0)
            {
                continue;
            }

            var edges = new List<ModuleEdgeUsage>();
            foreach (var edge in graph.GetProperty("edges").EnumerateObject())
            {
                foreach (var end in new[] { "from", "to" })
                {
                    var nodeId = edge.Value.GetProperty(end).GetString()!;
                    if (!nodes.Contains(nodeId))
                    {
                        continue;
                    }

                    var iface = edge.Value.TryGetProperty(end + "Interface", out var i) ? i : (JsonElement?)null;
                    edges.Add(new ModuleEdgeUsage(
                        edge.Name, nodeId, end, iface?.GetProperty("id").GetString(), iface?.GetProperty("name").GetString()));
                }
            }

            var owner = owners[featureId];
            usages.Add(new ModuleUsage(featureId, owner.Name, owner.Kind, [.. nodes.Order(StringComparer.Ordinal)], edges));
        }

        return [.. usages.OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase).ThenBy(u => u.FeatureId)];
    }

    /// <summary>
    /// Convierte una selección en módulo (spec modulos-compartidos, criterios 5 a 10): valida los dos lienzos, crea el
    /// módulo y su lienzo y guarda la feature al final (con su versión). Si la feature no se puede guardar, borra lo
    /// creado (compensación, ADR-0009). Idempotente por <c>ModuleId</c>: si la feature ya usa ese módulo, la conversión
    /// ya se hizo y responde lo guardado; si quedó un módulo suelto de un intento anterior, se vuelve a crear.
    /// </summary>
    public async Task<ExtractResult> ExtractAsync(Guid appId, ExtractModuleRequest request, string userId, CancellationToken ct)
    {
        var errors = NameErrors(request.Name, request.Description);
        foreach (var (path, messages) in validator.Validate(request.Module))
        {
            errors["/module" + path] = messages;
        }

        foreach (var (path, messages) in validator.Validate(request.Feature))
        {
            errors["/feature" + path] = messages;
        }

        if (errors.Count > 0)
        {
            return new ExtractResult.Invalid(errors);
        }

        var feature = await features.DescribeAsync(request.FeatureId, ct).ConfigureAwait(false);
        if (feature is null || feature.AppId != appId)
        {
            return new ExtractResult.NotFound();
        }

        var existing = await features.DescribeAsync(request.ModuleId, ct).ConfigureAwait(false);
        if (existing is not null)
        {
            if (existing.Kind != "module" || existing.AppId != appId)
            {
                return new ExtractResult.Conflict("Ya existe una feature con el id del módulo.", null);
            }

            var saved = await canvases.GetAsync(request.FeatureId, ct).ConfigureAwait(false);
            if (saved is { } current && ModuleReferences.ModuleIdsOf(current).Contains(request.ModuleId))
            {
                // Reintento de una conversión que ya terminó.
                return new ExtractResult.Done(new ExtractModuleResponse((await GetAsync(request.ModuleId, ct).ConfigureAwait(false))!, current));
            }

            // Restos de un intento que no terminó: se descartan y se vuelve a empezar.
            await UndoAsync(request.ModuleId, ct).ConfigureAwait(false);
        }

        if (!await writer.CreateModuleAsync(appId, request.ModuleId, request.Name, request.Description, userId, ct).ConfigureAwait(false))
        {
            return new ExtractResult.Conflict("Otro pedido está creando el mismo módulo.", null);
        }

        try
        {
            var moduleSaved = await canvases.SaveAsync(request.ModuleId, request.Module, userId, ct).ConfigureAwait(false);
            if (moduleSaved is not SaveResult.Saved)
            {
                await UndoAsync(request.ModuleId, ct).ConfigureAwait(false);
                return moduleSaved is SaveResult.Invalid invalid
                    ? new ExtractResult.Invalid(invalid.Errors.ToDictionary(e => "/module" + e.Key, e => e.Value))
                    : new ExtractResult.Conflict("El lienzo del módulo no se pudo crear.", null);
            }

            var featureSaved = await canvases.SaveAsync(request.FeatureId, request.Feature, userId, ct).ConfigureAwait(false);
            switch (featureSaved)
            {
                case SaveResult.Saved saved:
                    return new ExtractResult.Done(new ExtractModuleResponse((await GetAsync(request.ModuleId, ct).ConfigureAwait(false))!, saved.Graph));
                case SaveResult.Invalid invalid:
                    await UndoAsync(request.ModuleId, ct).ConfigureAwait(false);
                    return new ExtractResult.Invalid(invalid.Errors.ToDictionary(e => "/feature" + e.Key, e => e.Value));
                case SaveResult.Conflict conflict:
                    await UndoAsync(request.ModuleId, ct).ConfigureAwait(false);
                    return new ExtractResult.Conflict("El lienzo de la feature cambió desde que lo cargaste.", conflict.CurrentVersion);
                default:
                    await UndoAsync(request.ModuleId, ct).ConfigureAwait(false);
                    return new ExtractResult.NotFound();
            }
        }
        catch
        {
            // Sin el token del pedido: la compensación tiene que terminar aunque el cliente se haya ido.
            await UndoAsync(request.ModuleId, CancellationToken.None).ConfigureAwait(false);
            throw;
        }
    }

    private async Task UndoAsync(Guid moduleId, CancellationToken ct)
    {
        await db.Canvases.Where(c => c.FeatureId == moduleId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await writer.DeleteFeaturesAsync([moduleId], ct).ConfigureAwait(false);
    }

    /// <summary>Features y módulos de la app, por id (los lienzos que pueden referenciar un módulo).</summary>
    private async Task<Dictionary<Guid, FeatureSummary>> OwnersAsync(Guid appId, CancellationToken ct)
    {
        var all = (await features.FeaturesOfAppAsync(appId, ct).ConfigureAwait(false))
            .Concat(await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false));
        return all.ToDictionary(f => f.Id);
    }

    private async Task<Dictionary<Guid, JsonElement>> GraphsOfAppAsync(Guid appId, IReadOnlyList<FeatureSummary> modules, CancellationToken ct)
    {
        var ids = (await features.FeatureIdsOfAppAsync(appId, ct).ConfigureAwait(false)).Concat(modules.Select(m => m.Id));
        return await LoadGraphsAsync(ids, ct).ConfigureAwait(false);
    }

    private async Task<Dictionary<Guid, JsonElement>> LoadGraphsAsync(IEnumerable<Guid> ids, CancellationToken ct)
    {
        var set = ids.ToHashSet();
        var rows = await db.Canvases.AsNoTracking()
            .Where(c => set.Contains(c.FeatureId))
            .Select(c => new { c.FeatureId, c.Graph })
            .ToListAsync(ct).ConfigureAwait(false);
        return rows.ToDictionary(r => r.FeatureId, r => CanvasHandlers.Parse(r.Graph));
    }

    /// <summary>Elementos del catálogo que usan las cajas de las interfaces (para su tipo y contrato).</summary>
    private async Task<Dictionary<Guid, CatalogItemResponse>> CatalogOfAsync(Guid appId, IEnumerable<JsonElement> graphs, CancellationToken ct)
    {
        var ids = new HashSet<Guid>();
        foreach (var graph in graphs)
        {
            if (graph.ValueKind != JsonValueKind.Object || !graph.TryGetProperty("interfaces", out var ifaces))
            {
                continue;
            }

            var nodes = graph.GetProperty("nodes");
            foreach (var iface in ifaces.EnumerateObject())
            {
                if (nodes.TryGetProperty(iface.Value.GetProperty("nodeId").GetString()!, out var node)
                    && node.TryGetProperty("catalogId", out var catalogId)
                    && Guid.TryParse(catalogId.GetString(), out var id))
                {
                    ids.Add(id);
                }
            }
        }

        return ids.Count == 0
            ? []
            : (await catalog.ItemsOfAppAsync(appId, ids, ct).ConfigureAwait(false)).ToDictionary(i => i.Id);
    }

    private static ModuleSummary Summarize(
        FeatureSummary module, Dictionary<Guid, JsonElement> graphs, Dictionary<Guid, CatalogItemResponse> items)
    {
        var usedBy = graphs
            .Where(g => g.Key != module.Id && ModuleNodes(g.Value, module.Id).Count > 0)
            .Select(g => g.Key)
            .Order()
            .ToList();
        var description = string.IsNullOrEmpty(module.Description) ? null : module.Description;
        if (!graphs.TryGetValue(module.Id, out var graph))
        {
            return new ModuleSummary(module.Id, module.AppId, module.Name, description, 0, 0, [], [], usedBy);
        }

        var nodes = graph.GetProperty("nodes");
        var tours = graph.TryGetProperty("tours", out var t) ? t : (JsonElement?)null;
        var interfaces = new List<ModuleInterfaceSummary>();
        if (graph.TryGetProperty("interfaces", out var ifaces))
        {
            foreach (var iface in ifaces.EnumerateObject())
            {
                var value = iface.Value;
                var nodeId = value.GetProperty("nodeId").GetString()!;
                string? type = null, title = null, method = null, path = null;
                if (nodes.TryGetProperty(nodeId, out var node))
                {
                    type = node.GetProperty("type").GetString();
                    title = node.GetProperty("title").GetString();
                    var http = node.TryGetProperty("http", out var h) ? h : (JsonElement?)null;
                    if (type == "ref" && node.TryGetProperty("catalogId", out var catalogId)
                        && Guid.TryParse(catalogId.GetString(), out var itemId) && items.TryGetValue(itemId, out var item))
                    {
                        type = item.Type;
                        title = item.Title;
                        http = item.Http;
                    }

                    method = http is { ValueKind: JsonValueKind.Object } hm && hm.TryGetProperty("method", out var m) ? m.GetString() : null;
                    path = http is { ValueKind: JsonValueKind.Object } hp && hp.TryGetProperty("path", out var p) ? p.GetString() : null;
                }

                var tourId = value.TryGetProperty("tourId", out var tid) ? tid.GetString() : null;
                var tourName = tourId is not null && tours is { } tt && tt.TryGetProperty(tourId, out var tour)
                    ? tour.GetProperty("name").GetString()
                    : null;
                interfaces.Add(new ModuleInterfaceSummary(
                    iface.Name,
                    value.GetProperty("name").GetString()!,
                    value.TryGetProperty("description", out var d) ? d.GetString() : null,
                    value.GetProperty("kind").GetString()!,
                    nodeId,
                    type,
                    title,
                    method,
                    path,
                    tourId,
                    tourName));
            }
        }

        // Interfaces quitadas: las features resuelven con esto sus conexiones (no se reescriben).
        var redirects = graph.TryGetProperty("interfaceRedirects", out var r)
            ? r.EnumerateObject()
                .Select(x => new InterfaceRedirect(x.Name, x.Value.TryGetProperty("to", out var to) ? to.GetString() : null))
                .OrderBy(x => x.From, StringComparer.Ordinal)
                .ToList()
            : [];
        return new ModuleSummary(
            module.Id,
            module.AppId,
            module.Name,
            description,
            graph.GetProperty("version").GetInt32(),
            nodes.EnumerateObject().Count(),
            [.. interfaces.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.Id, StringComparer.Ordinal)],
            [.. ModuleReferences.ModuleIdsOf(graph).Order()],
            usedBy,
            redirects.Count > 0 ? redirects : null);
    }

    /// <summary>Ids de los nodos <c>module</c> del grafo que apuntan a <paramref name="moduleId"/>.</summary>
    private static HashSet<string> ModuleNodes(JsonElement graph, Guid moduleId) =>
        graph.GetProperty("nodes").EnumerateObject()
            .Where(n => n.Value.GetProperty("type").GetString() == "module"
                && n.Value.TryGetProperty("moduleId", out var id)
                && Guid.TryParse(id.GetString(), out var parsed) && parsed == moduleId)
            .Select(n => n.Name)
            .ToHashSet(StringComparer.Ordinal);
}

internal abstract record ModuleResult
{
    public sealed record Done(ModuleSummary Module) : ModuleResult;
    public sealed record NotFound : ModuleResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : ModuleResult;
    public sealed record Conflict(string Detail) : ModuleResult;
}

internal abstract record DeleteModuleResult
{
    public sealed record Deleted : DeleteModuleResult;
    public sealed record NotFound : DeleteModuleResult;
    public sealed record InUse(IReadOnlyList<Guid> UsedBy) : DeleteModuleResult;
}

internal abstract record ExtractResult
{
    public sealed record Done(ExtractModuleResponse Response) : ExtractResult;
    public sealed record NotFound : ExtractResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : ExtractResult;
    public sealed record Conflict(string Detail, int? CurrentVersion) : ExtractResult;
}
