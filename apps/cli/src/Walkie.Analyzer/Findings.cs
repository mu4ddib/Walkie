using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer;

/// <summary>Base de un hallazgo (ADR-0014): observado tal cual o inferido. La confirmación nunca la da el analizador.</summary>
public enum Basis
{
    Observed,
    Inferred,
}

/// <summary>Confianza de un hallazgo; lo inferido nunca es <see cref="High"/>.</summary>
public enum Confidence
{
    Low,
    Medium,
    High,
}

/// <summary>Líneas informativas de una evidencia.</summary>
public readonly record struct Lines(int Start, int End);

/// <summary>Una entidad en construcción. Varios detectores pueden aportar a la misma clave: se combinan.</summary>
public sealed class EntityDraft
{
    internal EntityDraft(string key, string kind, string title)
    {
        Key = key;
        Kind = kind;
        Title = Text.Truncate(title, 120);
    }

    public string Key { get; }

    public string Kind { get; }

    public string Title { get; private set; }

    public string? Description { get; set; }

    public string? Technology { get; set; }

    public Basis Basis { get; internal set; } = Basis.Inferred;

    public Confidence Confidence { get; internal set; } = Confidence.Low;

    /// <summary><c>$defs/http</c> del grafo (solo api). El primero que lo da gana: OpenAPI corre antes que el código.</summary>
    public JsonObject? Http { get; set; }

    /// <summary><c>$defs/database</c> del grafo (solo database).</summary>
    public JsonObject? Database { get; set; }

    /// <summary><c>$defs/resource</c> del grafo (solo resource).</summary>
    public JsonObject? Resource { get; set; }

    /// <summary><c>$defs/runtime</c> del grafo (solo service).</summary>
    public string? Runtime { get; set; }

    /// <summary>Ruta de la pantalla (solo screen).</summary>
    public string? Route { get; set; }

    /// <summary>Ámbito de la app (solo screen y feature, ADR-0014): parte de la clave.</summary>
    public string? App { get; set; }

    internal SortedSet<string> Evidence { get; } = new(StringComparer.Ordinal);

    internal SortedSet<string> DerivedFrom { get; } = new(StringComparer.Ordinal);

    internal SortedSet<string> Members { get; } = new(StringComparer.Ordinal);

    /// <summary>Interfaces propuestas de un módulo, por clave de la entidad que la implementa.</summary>
    internal SortedDictionary<string, (string Name, string Kind)> Interfaces { get; } = new(StringComparer.Ordinal);

    public void AddDerivedFrom(string key) => DerivedFrom.Add(key);

    public void AddMember(string key) => Members.Add(key);

    public void AddInterface(string entityKey, string name, string kind) =>
        Interfaces.TryAdd(entityKey, (Text.Truncate(name, 60), kind));

    /// <summary>Un título mejor (ej. el <c>summary</c> de OpenAPI) reemplaza al que se armó con la firma.</summary>
    public void PreferTitle(string title) => Title = Text.Truncate(title, 120);
}

/// <summary>
/// Hallazgos de un análisis: entidades, relaciones, evidencia, tecnologías y limitaciones. Arma el <c>discovery.json</c>
/// con las reglas del contrato (ADR-0014): orden estable, claves de <see cref="DiscoveryKeys"/>, fingerprints de
/// <see cref="DiscoveryFingerprint"/>, sin referencias colgantes y con la confianza de lo inferido acotada.
/// </summary>
public sealed class Findings(AnalyzerLimits limits)
{
    private readonly SortedDictionary<string, EntityDraft> entities = new(StringComparer.Ordinal);
    private readonly SortedDictionary<string, (string Kind, string From, string To, Basis Basis, Confidence Confidence, SortedSet<string> Evidence)> relations = new(StringComparer.Ordinal);
    private readonly SortedDictionary<string, JsonObject> evidence = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Confidence> evidenceConfidence = new(StringComparer.Ordinal);
    private readonly SortedDictionary<string, (string Name, string? Version, SortedSet<string> Evidence)> technologies = new(StringComparer.Ordinal);
    private readonly List<(string Code, string Message, string? Detector, string? Path)> limitations = [];
    private int droppedEntities;
    private int droppedLimitations;

    public IReadOnlyDictionary<string, EntityDraft> Entities => entities;

    public int RelationCount => relations.Count;

    public int EvidenceCount => evidence.Count;

    /// <summary>Hubo algo que no se pudo analizar o se cortó por un límite: el análisis queda <c>partial</c>.</summary>
    public bool Incomplete { get; private set; }

    /// <summary>Registra una evidencia y devuelve su id (derivado de detector, ruta, ancla y línea).</summary>
    public string Evidence(string detector, string path, Confidence confidence, string? symbol = null, Lines? lines = null, string? note = null)
    {
        var start = lines?.Start ?? 0;
        var id = "ev-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Create(CultureInfo.InvariantCulture, $"{detector}\n{path}\n{symbol}\n{start}"))))[..16];
        if (evidence.ContainsKey(id))
        {
            if (confidence > evidenceConfidence[id])
            {
                evidenceConfidence[id] = confidence;
                evidence[id]["confidence"] = Name(confidence);
            }

            return id;
        }

        var item = new JsonObject { ["id"] = id, ["detector"] = detector, ["path"] = path };
        if (symbol is not null)
        {
            item["symbol"] = Text.Truncate(symbol, 300);
        }

        if (lines is { } l)
        {
            item["lines"] = new JsonObject { ["start"] = Math.Max(1, l.Start), ["end"] = Math.Max(Math.Max(1, l.Start), l.End) };
        }

        item["confidence"] = Name(confidence);
        if (note is not null)
        {
            item["note"] = Text.Truncate(note, 500);
        }

        evidence[id] = item;
        evidenceConfidence[id] = confidence;
        return id;
    }

    /// <summary>
    /// Suma una entidad (o aporta a la que ya tiene esa clave). Lo observado gana a lo inferido y la confianza se
    /// queda con la mayor. Devuelve null si se alcanzó el límite de entidades.
    /// </summary>
    public EntityDraft? Entity(string key, string kind, string title, Basis basis, Confidence confidence, string evidenceId)
    {
        if (!entities.TryGetValue(key, out var entity))
        {
            if (entities.Count >= limits.MaxEntities)
            {
                droppedEntities++;
                Incomplete = true;
                return null;
            }

            entity = new EntityDraft(key, kind, title) { Basis = basis, Confidence = confidence };
            entities[key] = entity;
        }
        else
        {
            if (basis == Basis.Observed)
            {
                entity.Basis = Basis.Observed;
            }

            if (confidence > entity.Confidence)
            {
                entity.Confidence = confidence;
            }
        }

        entity.Evidence.Add(evidenceId);
        return entity;
    }

    /// <summary>Suma una relación entre dos claves (o aporta evidencia a la que ya existe).</summary>
    public void Relation(string kind, string from, string to, Basis basis, Confidence confidence, string evidenceId)
    {
        if (from == to)
        {
            return;
        }

        var key = DiscoveryKeys.Relation(kind, from, to);
        if (relations.TryGetValue(key, out var existing))
        {
            existing.Evidence.Add(evidenceId);
            relations[key] = existing with
            {
                Basis = basis == Basis.Observed ? Basis.Observed : existing.Basis,
                Confidence = confidence > existing.Confidence ? confidence : existing.Confidence,
            };
            return;
        }

        relations[key] = (kind, from, to, basis, confidence, new SortedSet<string>(StringComparer.Ordinal) { evidenceId });
    }

    /// <summary>Las APIs que publica (<c>exposes</c>) más de un servicio, con esos servicios en orden.</summary>
    public IEnumerable<(string Api, IReadOnlyList<string> Services)> SharedApis() =>
        relations.Values.Where(r => r.Kind == "exposes")
            .GroupBy(r => r.To, StringComparer.Ordinal)
            .Select(g => (g.Key, (IReadOnlyList<string>)[.. g.Select(r => r.From).Distinct().Order(StringComparer.Ordinal)]))
            .Where(g => g.Item2.Count > 1)
            .OrderBy(g => g.Key, StringComparer.Ordinal);

    /// <summary>Una tecnología detectada (lenguaje, framework, motor) con su evidencia.</summary>
    public void Technology(string id, string name, string? version, string evidenceId)
    {
        if (!technologies.TryGetValue(id, out var technology))
        {
            technology = (name, version, new SortedSet<string>(StringComparer.Ordinal));
        }
        else if (technology.Version is null && version is not null)
        {
            technology = technology with { Version = version };
        }

        technology.Evidence.Add(evidenceId);
        technologies[id] = technology;
    }

    public bool HasTechnology(string id) => technologies.ContainsKey(id);

    /// <summary>
    /// Algo que el análisis no pudo resolver o no miró. <paramref name="incomplete"/> marca el análisis como parcial
    /// (todo menos los avisos que no quitan información, como los archivos sensibles excluidos a propósito).
    /// </summary>
    public void Limitation(string code, string message, string? detector = null, string? path = null, bool incomplete = true)
    {
        Incomplete |= incomplete;
        if (limitations.Any(l => l.Code == code && l.Message == message && l.Detector == detector && l.Path == path))
        {
            return;
        }

        if (limitations.Count >= limits.MaxLimitations)
        {
            droppedLimitations++;
            return;
        }

        limitations.Add((code, Text.Truncate(message, 500), detector, path));
    }

    /// <summary>Tecnologías para el manifest.</summary>
    internal JsonArray TechnologiesJson() =>
        new([.. technologies.Select(t =>
        {
            var item = new JsonObject { ["id"] = t.Key, ["name"] = Text.Truncate(t.Value.Name, 60) };
            if (t.Value.Version is { } version)
            {
                item["version"] = Text.Truncate(version, 40);
            }

            item["evidence"] = new JsonArray([.. t.Value.Evidence.Select(e => (JsonNode)e)]);
            return (JsonNode)item;
        })]);

    /// <summary>Limitaciones para el manifest, en orden estable.</summary>
    internal JsonArray LimitationsJson()
    {
        var list = limitations.ToList();
        if (droppedEntities > 0)
        {
            list.Add(("entity-limit", string.Create(CultureInfo.InvariantCulture,
                $"Se alcanzó el límite de {limits.MaxEntities} entidades: {droppedEntities} hallazgos no entraron en el paquete."), null, null));
        }

        if (droppedLimitations > 0)
        {
            list.Add(("more-limitations", string.Create(CultureInfo.InvariantCulture,
                $"Hay {droppedLimitations} limitaciones más que no se listan."), null, null));
        }

        return new([.. list
            .OrderBy(l => l.Code, StringComparer.Ordinal).ThenBy(l => l.Path, StringComparer.Ordinal)
            .ThenBy(l => l.Message, StringComparer.Ordinal)
            .Select(l =>
            {
                var item = new JsonObject { ["code"] = l.Code, ["message"] = l.Message };
                if (l.Detector is not null)
                {
                    item["detector"] = l.Detector;
                }

                if (l.Path is not null)
                {
                    item["path"] = l.Path;
                }

                return (JsonNode)item;
            })]);
    }

    /// <summary>
    /// El <c>discovery.json</c>: entidades por clave, relaciones por clave y evidencia por id. Quita las referencias
    /// a entidades que no llegaron (miembros, derivadas, interfaces, extremos) y la evidencia que nadie cita.
    /// </summary>
    internal JsonObject DiscoveryJson()
    {
        var entityArray = new JsonArray();
        var cited = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entity in entities.Values)
        {
            entityArray.Add(EntityJson(entity));
            cited.UnionWith(entity.Evidence);
        }

        var relationArray = new JsonArray();
        foreach (var (key, relation) in relations)
        {
            if (!entities.ContainsKey(relation.From) || !entities.ContainsKey(relation.To))
            {
                continue;
            }

            var basis = relation.Basis;
            relationArray.Add(new JsonObject
            {
                ["key"] = key,
                ["kind"] = relation.Kind,
                ["from"] = relation.From,
                ["to"] = relation.To,
                ["basis"] = Name(basis),
                ["confidence"] = Name(Cap(basis, relation.Confidence)),
                ["evidence"] = new JsonArray([.. relation.Evidence.Select(e => (JsonNode)e)]),
            });
            cited.UnionWith(relation.Evidence);
        }

        foreach (var technology in technologies.Values)
        {
            cited.UnionWith(technology.Evidence);
        }

        return new JsonObject
        {
            ["entities"] = entityArray,
            ["relations"] = relationArray,
            ["evidence"] = new JsonArray([.. evidence.Where(e => cited.Contains(e.Key)).Select(e => (JsonNode)e.Value.DeepClone())]),
        };
    }

    private JsonObject EntityJson(EntityDraft entity)
    {
        var content = Build(entity, fingerprint: null);
        var fingerprint = DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(content));
        return Build(entity, fingerprint);
    }

    private JsonObject Build(EntityDraft entity, string? fingerprint)
    {
        var item = new JsonObject { ["key"] = entity.Key, ["kind"] = entity.Kind, ["title"] = entity.Title };
        if (entity.Description is { } description)
        {
            item["description"] = Text.Truncate(description, 2000);
        }

        if (entity.Technology is { } technology && technologies.ContainsKey(technology))
        {
            item["technology"] = technology;
        }

        item["basis"] = Name(entity.Basis);
        item["confidence"] = Name(Cap(entity.Basis, entity.Confidence));
        if (fingerprint is not null)
        {
            item["fingerprint"] = fingerprint;
        }

        var derived = entity.Basis == Basis.Inferred
            ? entity.DerivedFrom.Where(k => k != entity.Key && entities.ContainsKey(k)).ToList()
            : [];
        if (derived.Count > 0)
        {
            item["derivedFrom"] = new JsonArray([.. derived.Select(k => (JsonNode)k)]);
        }

        if (entity.Http is not null)
        {
            item["http"] = entity.Http.DeepClone();
        }

        if (entity.Database is not null)
        {
            item["database"] = entity.Database.DeepClone();
        }

        if (entity.Resource is not null)
        {
            item["resource"] = entity.Resource.DeepClone();
        }

        if (entity.Runtime is not null)
        {
            item["runtime"] = entity.Runtime;
        }

        if (entity.App is not null)
        {
            item["app"] = entity.App;
        }

        if (entity.Route is not null)
        {
            item["route"] = entity.Route;
        }

        if (entity.Kind is "module" or "feature")
        {
            var members = entity.Members.Where(k => k != entity.Key && entities.ContainsKey(k)).ToHashSet(StringComparer.Ordinal);
            item["members"] = new JsonArray([.. members.Order(StringComparer.Ordinal).Select(k => (JsonNode)k)]);
            var interfaces = entity.Interfaces.Where(i => members.Contains(i.Key)).ToList();
            if (entity.Kind == "module" && interfaces.Count > 0)
            {
                item["interfaces"] = new JsonArray([.. interfaces.Select(i => (JsonNode)new JsonObject
                {
                    ["name"] = i.Value.Name,
                    ["kind"] = i.Value.Kind,
                    ["entity"] = i.Key,
                })]);
            }
        }

        item["evidence"] = new JsonArray([.. entity.Evidence.Select(e => (JsonNode)e)]);
        return item;
    }

    private static Confidence Cap(Basis basis, Confidence confidence) =>
        basis == Basis.Inferred && confidence == Confidence.High ? Confidence.Medium : confidence;

    private static string Name(Basis basis) => basis == Basis.Observed ? "observed" : "inferred";

    private static string Name(Confidence confidence) => confidence switch
    {
        Confidence.High => "high",
        Confidence.Medium => "medium",
        _ => "low",
    };
}

/// <summary>Textos dentro de los límites del contrato.</summary>
internal static class Text
{
    public static string Truncate(string value, int max)
    {
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..(max - 1)].TrimEnd() + "…";
    }
}
