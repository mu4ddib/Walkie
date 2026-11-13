using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Referencias a módulos compartidos (spec modulos-compartidos, ADR-0010): cada <c>moduleId</c> es un módulo de la
/// misma app (uno que no existe se acepta: es una referencia pendiente, ej. a un módulo borrado) y un módulo no se
/// contiene a sí mismo a ninguna profundidad. Las conexiones entre módulos no cuentan: solo la contención.
/// </summary>
internal sealed class ModuleReferences(CanvasDbContext db, IFeatureDirectory features)
{
    public async Task ErrorsAsync(
        Guid featureId,
        Guid appId,
        bool isModule,
        List<(string Node, Guid? Id)> references,
        Dictionary<string, string[]> errors,
        CancellationToken ct)
    {
        var appModules = (await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false)).Select(m => m.Id).ToHashSet();
        foreach (var (node, id) in references)
        {
            var path = $"/nodes/{node}/moduleId";
            if (id is not { } moduleId)
            {
                errors[path] = ["El módulo no es un id válido."];
            }
            else if (moduleId == featureId)
            {
                errors[path] = ["Un módulo no puede contenerse a sí mismo."];
            }
            else if (!appModules.Contains(moduleId) && await features.FeatureExistsAsync(moduleId, ct).ConfigureAwait(false))
            {
                errors[path] = ["No es un módulo de esta app."];
            }
        }

        if (!isModule || errors.Count > 0)
        {
            return;
        }

        // Contención entre módulos con lo guardado, más lo que se está guardando ahora.
        var contains = await ContainmentAsync(appModules, ct).ConfigureAwait(false);
        contains[featureId] = references.Select(r => r.Id).OfType<Guid>().ToHashSet();
        foreach (var (node, id) in references)
        {
            if (id is { } moduleId && Reaches(contains, moduleId, featureId))
            {
                errors[$"/nodes/{node}/moduleId"] = ["Ciclo de contención: ese módulo ya contiene (directa o indirectamente) a este."];
            }
        }
    }

    /// <summary>Qué módulos contiene cada módulo, según su último lienzo guardado.</summary>
    public async Task<Dictionary<Guid, HashSet<Guid>>> ContainmentAsync(IReadOnlySet<Guid> moduleIds, CancellationToken ct)
    {
        var canvases = await db.Canvases.AsNoTracking()
            .Where(c => moduleIds.Contains(c.FeatureId))
            .Select(c => new { c.FeatureId, c.Graph })
            .ToListAsync(ct).ConfigureAwait(false);
        return canvases.ToDictionary(c => c.FeatureId, c => ModuleIdsOf(CanvasHandlers.Parse(c.Graph)));
    }

    /// <summary>Ids de los módulos que referencian los nodos <c>module</c> del grafo.</summary>
    public static HashSet<Guid> ModuleIdsOf(JsonElement graph) =>
        graph.GetProperty("nodes").EnumerateObject()
            .Where(n => n.Value.GetProperty("type").GetString() == "module" && n.Value.TryGetProperty("moduleId", out _))
            .Select(n => Guid.TryParse(n.Value.GetProperty("moduleId").GetString(), out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToHashSet();

    private static bool Reaches(Dictionary<Guid, HashSet<Guid>> contains, Guid from, Guid target)
    {
        var seen = new HashSet<Guid>();
        var pending = new Stack<Guid>([from]);
        while (pending.TryPop(out var current))
        {
            if (current == target)
            {
                return true;
            }

            if (seen.Add(current) && contains.TryGetValue(current, out var inner))
            {
                foreach (var next in inner)
                {
                    pending.Push(next);
                }
            }
        }

        return false;
    }
}
