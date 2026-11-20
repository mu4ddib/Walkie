using System.Text.Json;
using Walkie.Modules.Discovery.Contracts;

namespace Walkie.Modules.Discovery.Features;

/// <summary>Lo que la proyección necesita de un hallazgo: sin su <c>jsonb</c> completo, solo los campos que agrupan.</summary>
internal sealed class ArchitectureEntityRow
{
    public required string Key { get; init; }

    public required string Kind { get; init; }

    public required string Title { get; init; }

    public required string Basis { get; init; }

    public required string Confidence { get; init; }

    public string? App { get; init; }

    public string? Technology { get; init; }

    public string? Route { get; init; }

    /// <summary>Miembros (módulo o feature) como texto JSON; null en lo demás.</summary>
    public string? Members { get; init; }

    public string? Description { get; init; }
}

internal sealed record ArchitectureRelationRow(string Key, string Kind, string From, string To, string Basis, string Confidence);

internal sealed record ArchitectureLimitationRow(string Code, string Message, string? Path, string? Detector, bool Incomplete);

/// <summary>
/// La arquitectura descubierta de un análisis (spec walkie-live-arquitectura, ADR-0016), calculada y sin efectos. Función
/// pura y determinista, lineal en hallazgos y relaciones:
/// <list type="number">
/// <item><b>Grupos:</b> cada app de front con las pantallas que contiene (<c>contains</c>) y sus propuestas de feature;
/// cada módulo con sus miembros y las APIs que expone; cada servicio del backend con las APIs que expone; las bases y los
/// recursos que nadie reclama; las APIs que el análisis no ve publicar (llamadas desde el front); y lo demás.</item>
/// <item><b>Vínculos:</b> las relaciones entre grupos, sumadas por tipo, con cuántas son observadas, inferidas y de
/// confianza baja, y su significado: ejecución, navegación, contención o dependencia. Las de dentro de un grupo se
/// cuentan aparte.</item>
/// <item><b>Cobertura:</b> cada limitación va al grupo de su archivo (la carpeta de la app de front, el proyecto del
/// módulo o del servicio).</item>
/// <item><b>Propuestas:</b> cada candidato a feature con sus pantallas, APIs, la navegación y las llamadas demostradas
/// entre ellas, su fuerza (evidencia o heurística), lo que quedó sin resolver en su app y si ya se decidió.</item>
/// </list>
/// </summary>
internal static class ArchitectureProjection
{
    private static readonly string[] GroupOrder = ["frontend", "service", "module", "data", "infrastructure", "external", "unassigned"];

    public static string Semantic(string kind) => kind switch
    {
        "navigates" => "navigation",
        "exposes" or "contains" => "containment",
        "depends-on" => "dependency",
        _ => "execution",
    };

    /// <summary>A qué grupo va cada hallazgo, y los grupos (clave → tipo, título, tecnología y hallazgo que lo nombra).</summary>
    public static (Dictionary<string, string> GroupOf, Dictionary<string, (string Kind, string Title, string? Technology, string? EntityKey)> Groups) Assign(
        IReadOnlyList<ArchitectureEntityRow> entities, IReadOnlyList<ArchitectureRelationRow> relations)
    {
        var byKey = entities.ToDictionary(e => e.Key, StringComparer.Ordinal);
        var groupOf = new Dictionary<string, string>(StringComparer.Ordinal);
        var groups = new Dictionary<string, (string Kind, string Title, string? Technology, string? EntityKey)>(StringComparer.Ordinal);
        void Put(string entity, string group)
        {
            groupOf.TryAdd(entity, group);
        }

        // 1. Apps de front: el servicio que contiene pantallas.
        foreach (var contains in relations.Where(r => r.Kind == "contains" && r.To.StartsWith("screen:", StringComparison.Ordinal)).OrderBy(r => r.Key, StringComparer.Ordinal))
        {
            if (!byKey.TryGetValue(contains.From, out var app))
            {
                continue;
            }

            var key = "frontend:" + app.Key;
            groups.TryAdd(key, ("frontend", app.Title, app.Technology, app.Key));
            Put(app.Key, key);
            Put(contains.To, key);
        }

        // 2. Módulos: el módulo, sus miembros y lo que expone.
        foreach (var module in entities.Where(e => e.Kind == "module").OrderBy(e => e.Key, StringComparer.Ordinal))
        {
            var key = "module:" + module.Key;
            groups[key] = ("module", module.Title, module.Technology, module.Key);
            Put(module.Key, key);
            foreach (var member in Members(module))
            {
                if (byKey.ContainsKey(member))
                {
                    Put(member, key);
                }
            }
        }

        foreach (var exposes in relations.Where(r => r.Kind == "exposes").OrderBy(r => r.Key, StringComparer.Ordinal))
        {
            if (groupOf.TryGetValue(exposes.From, out var owner))
            {
                Put(exposes.To, owner);
            }
            else if (byKey.TryGetValue(exposes.From, out var service) && service.Kind == "service")
            {
                // 3. Servicios del backend: el servicio y lo que expone.
                var key = "service:" + service.Key;
                groups.TryAdd(key, ("service", service.Title, service.Technology, service.Key));
                Put(service.Key, key);
                Put(exposes.To, key);
            }
        }

        // 4. Propuestas de feature: con la app técnica de su primera pantalla.
        foreach (var feature in entities.Where(e => e.Kind == "feature"))
        {
            if (Members(feature).FirstOrDefault(m => m.StartsWith("screen:", StringComparison.Ordinal) && groupOf.ContainsKey(m)) is { } screen)
            {
                Put(feature.Key, groupOf[screen]);
            }
        }

        // 5. Lo demás, por tipo.
        foreach (var entity in entities.Where(e => !groupOf.ContainsKey(e.Key)))
        {
            var (key, kind, title) = entity.Kind switch
            {
                "database" => ("data", "data", "Datos"),
                "resource" => ("infrastructure", "infrastructure", "Infraestructura"),
                "api" => ("external", "external", "APIs sin backend en el análisis"),
                "service" => ("service:" + entity.Key, "service", entity.Title),
                "screen" when entity.App is { } app => ("frontend-app:" + app, "frontend", app),
                _ => ("unassigned", "unassigned", "Sin agrupar"),
            };
            groups.TryAdd(key, (kind, title, kind == "service" ? entity.Technology : null, kind == "service" ? entity.Key : null));
            Put(entity.Key, key);
        }

        return (groupOf, groups);
    }

    public static DiscoveryArchitecture Overview(
        Guid snapshotId, string completeness, IReadOnlyList<ArchitectureEntityRow> entities, IReadOnlyList<ArchitectureRelationRow> relations,
        IReadOnlyList<ArchitectureLimitationRow> limitations, IReadOnlyDictionary<string, string> decisions)
    {
        var (groupOf, groups) = Assign(entities, relations);
        var counts = groups.Keys.ToDictionary(k => k, _ => new SortedDictionary<string, int>(StringComparer.Ordinal), StringComparer.Ordinal);
        foreach (var entity in entities)
        {
            var bucket = counts[groupOf[entity.Key]];
            bucket[entity.Kind] = bucket.GetValueOrDefault(entity.Kind) + 1;
        }

        var internalCounts = groups.Keys.ToDictionary(k => k, _ => new SortedDictionary<string, int>(StringComparer.Ordinal), StringComparer.Ordinal);
        var links = new Dictionary<(string From, string To, string Kind), int[]>();
        foreach (var relation in relations)
        {
            if (!groupOf.TryGetValue(relation.From, out var from) || !groupOf.TryGetValue(relation.To, out var to))
            {
                continue;
            }

            var semantic = Semantic(relation.Kind);
            if (from == to)
            {
                internalCounts[from][semantic] = internalCounts[from].GetValueOrDefault(semantic) + 1;
                continue;
            }

            if (!links.TryGetValue((from, to, relation.Kind), out var tally))
            {
                links[(from, to, relation.Kind)] = tally = new int[4];
            }

            tally[0]++;
            tally[relation.Basis == "observed" ? 1 : 2]++;
            if (relation.Confidence == "low")
            {
                tally[3]++;
            }
        }

        // Cobertura: cada limitación al grupo de su archivo.
        var prefixes = Prefixes(entities, groupOf, groups);
        var placed = limitations.Select(l => (Limitation: l, Group: l.Path is { } path ? GroupOfPath(path, prefixes) : null)).ToList();
        var byGroup = placed.Where(p => p.Group is not null).GroupBy(p => p.Group!).ToDictionary(g => g.Key, g => (All: g.Count(), Incomplete: g.Count(p => p.Limitation.Incomplete)), StringComparer.Ordinal);

        var navigation = relations.Where(r => r.Kind == "navigates").ToLookup(r => r.From, StringComparer.Ordinal);
        var calls = relations.Where(r => r.Kind == "calls").ToLookup(r => r.From, StringComparer.Ordinal);
        var proposals = new List<ArchitectureProposal>();
        foreach (var feature in entities.Where(e => e.Kind == "feature").OrderBy(e => e.Key, StringComparer.Ordinal))
        {
            var members = Members(feature).ToHashSet(StringComparer.Ordinal);
            var screens = members.Where(m => m.StartsWith("screen:", StringComparison.Ordinal)).ToList();
            var apis = members.Count(m => m.StartsWith("api:", StringComparison.Ordinal));
            var group = groupOf.GetValueOrDefault(feature.Key);
            proposals.Add(new ArchitectureProposal(
                feature.Key, feature.Title, feature.App, group, feature.Description, feature.Confidence,
                feature.Confidence == "low" ? "heuristic" : "evidence",
                screens.Count, apis,
                screens.Sum(s => navigation[s].Count(r => members.Contains(r.To) && r.To.StartsWith("screen:", StringComparison.Ordinal))),
                screens.Sum(s => calls[s].Count(r => members.Contains(r.To))),
                group is not null && byGroup.TryGetValue(group, out var unresolved) ? unresolved.Incomplete : 0,
                decisions.GetValueOrDefault(feature.Key),
                [.. members.Order(StringComparer.Ordinal).Take(500)]));
        }

        var groupList = groups
            .OrderBy(g => Array.IndexOf(GroupOrder, g.Value.Kind)).ThenBy(g => g.Value.Title, StringComparer.Ordinal).ThenBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new ArchitectureGroup(
                g.Key, g.Value.Kind, Truncate(g.Value.Title, 120), g.Value.Technology, g.Value.EntityKey,
                counts[g.Key], internalCounts[g.Key],
                byGroup.TryGetValue(g.Key, out var c) ? c.All : 0, byGroup.TryGetValue(g.Key, out var d) ? d.Incomplete : 0))
            .ToList();

        return new DiscoveryArchitecture(
            snapshotId, completeness, new ArchitectureTotals(entities.Count, relations.Count), groupList,
            [.. links.OrderBy(l => l.Key.From, StringComparer.Ordinal).ThenBy(l => l.Key.To, StringComparer.Ordinal).ThenBy(l => l.Key.Kind, StringComparer.Ordinal)
                .Select(l => new ArchitectureLink(l.Key.From, l.Key.To, l.Key.Kind, Semantic(l.Key.Kind), l.Value[0], l.Value[1], l.Value[2], l.Value[3]))],
            proposals,
            [.. placed.Select(p => new ArchitectureLimitation(p.Limitation.Code, Truncate(p.Limitation.Message, 1000), p.Limitation.Path, p.Limitation.Detector, p.Group, p.Limitation.Incomplete))]);
    }

    /// <summary>Un grupo por dentro: sus hallazgos (paginados), las relaciones de esa página y los vecinos de otros grupos.</summary>
    public static DiscoveryArchitectureGroup? Group(
        string groupKey, int page, int pageSize, IReadOnlyList<ArchitectureEntityRow> entities, IReadOnlyList<ArchitectureRelationRow> relations,
        IReadOnlyDictionary<string, string> decisions)
    {
        var (groupOf, groups) = Assign(entities, relations);
        if (!groups.ContainsKey(groupKey))
        {
            return null;
        }

        var byKey = entities.ToDictionary(e => e.Key, StringComparer.Ordinal);
        var members = entities.Where(e => groupOf[e.Key] == groupKey)
            .OrderBy(e => e.Kind, StringComparer.Ordinal).ThenBy(e => e.Key, StringComparer.Ordinal).ToList();
        var slice = members.Skip(page * pageSize).Take(pageSize).ToList();
        var inPage = slice.Select(e => e.Key).ToHashSet(StringComparer.Ordinal);
        var touching = relations.Where(r => inPage.Contains(r.From) || inPage.Contains(r.To))
            .OrderBy(r => r.Key, StringComparer.Ordinal).Take(5000).ToList();
        var neighbors = touching.SelectMany(r => new[] { r.From, r.To }).Where(k => !inPage.Contains(k) && byKey.ContainsKey(k) && groupOf[k] != groupKey)
            .Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).Select(k => byKey[k]).ToList();
        ArchitectureEntity Map(ArchitectureEntityRow e) =>
            new(e.Key, e.Kind, e.Title, e.Basis, e.Confidence, groupOf[e.Key], e.Route, decisions.GetValueOrDefault(e.Key));

        return new DiscoveryArchitectureGroup(
            groupKey, page, pageSize, members.Count, [.. slice.Select(Map)],
            [.. touching.Select(r => new ArchitectureRelation(r.Key, r.Kind, r.From, r.To, r.Basis, r.Confidence, Semantic(r.Kind)))],
            [.. neighbors.Select(Map)]);
    }

    public static IEnumerable<string> Members(ArchitectureEntityRow entity)
    {
        if (entity.Members is not { Length: > 0 } json)
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>
    /// Dónde está el código de cada grupo, para ubicar sus limitaciones: la carpeta de una app de front (su ámbito, si es
    /// una carpeta) y el nombre del proyecto de un módulo o servicio del backend.
    /// </summary>
    private static List<(string Group, string Prefix, bool Folder)> Prefixes(
        IReadOnlyList<ArchitectureEntityRow> entities, Dictionary<string, string> groupOf, Dictionary<string, (string Kind, string Title, string? Technology, string? EntityKey)> groups)
    {
        var prefixes = new List<(string, string, bool)>();
        foreach (var scope in entities.Where(e => e.Kind == "screen" && e.App is not null).GroupBy(e => (e.App!, groupOf[e.Key])))
        {
            prefixes.Add((scope.Key.Item2, scope.Key.Item1 == "." ? "" : scope.Key.Item1.TrimEnd('/') + "/", true));
        }

        foreach (var (key, group) in groups.Where(g => g.Value.Kind is "module" or "service" && g.Value.Technology != "react" && g.Value.Technology != "angular" && g.Value.Technology != "nextjs"))
        {
            prefixes.Add((key, group.Title, false));
        }

        return [.. prefixes.Distinct().OrderByDescending(p => p.Item2.Length)];
    }

    private static string? GroupOfPath(string path, List<(string Group, string Prefix, bool Folder)> prefixes)
    {
        foreach (var (group, prefix, folder) in prefixes)
        {
            if (folder ? path.StartsWith(prefix, StringComparison.Ordinal) && prefix.Length > 0
                       : path.Split('/').Contains(prefix, StringComparer.Ordinal))
            {
                return group;
            }
        }

        // Una app en la raíz del repo (ámbito «.»): todo lo que no es de otro grupo.
        return prefixes.FirstOrDefault(p => p.Folder && p.Prefix.Length == 0).Group;
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..(max - 1)] + "…";
}
