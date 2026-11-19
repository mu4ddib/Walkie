using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Walkie.Shared.Discovery;
using YamlDotNet.Core;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// docker-compose (<c>docker-compose*.yml</c>, <c>compose*.yaml</c>…): cada servicio es una base de datos, un recurso
/// (caché, cola, almacenamiento, identidad, gateway, secretos) o un servicio, según su imagen; <c>depends_on</c> son
/// relaciones observadas. Nunca se ejecuta Docker ni se copian variables de entorno: solo se lee el nombre de la
/// base (<c>POSTGRES_DB</c>, <c>MYSQL_DATABASE</c>…) cuando es un texto literal.
/// </summary>
public sealed partial class ComposeDetector : IDetector
{
    /// <summary>Imagen (último segmento, sin etiqueta) → qué es.</summary>
    private static readonly (string Pattern, string Kind, string? Engine, string? Model, string? Resource, string? Label)[] Images =
    [
        ("postgres", "database", "PostgreSQL", "relational", null, null),
        ("postgis", "database", "PostgreSQL", "relational", null, null),
        ("mysql", "database", "MySQL", "relational", null, null),
        ("mariadb", "database", "MariaDB", "relational", null, null),
        ("mssql", "database", "SQL Server", "relational", null, null),
        ("oracle", "database", "Oracle", "relational", null, null),
        ("mongo", "database", "MongoDB", "document", null, null),
        ("cassandra", "database", "Cassandra", "wide-column", null, null),
        ("elasticsearch", "database", "Elasticsearch", "search", null, null),
        ("opensearch", "database", "OpenSearch", "search", null, null),
        ("neo4j", "database", "Neo4j", "graph", null, null),
        ("redis", "resource", null, null, "cache", null),
        ("valkey", "resource", null, null, "cache", null),
        ("memcached", "resource", null, null, "cache", null),
        ("rabbitmq", "resource", null, null, "queue", null),
        ("activemq", "resource", null, null, "queue", null),
        ("kafka", "resource", null, null, "topic", null),
        ("nats", "resource", null, null, "topic", null),
        ("minio", "resource", null, null, "storage", null),
        ("rustfs", "resource", null, null, "storage", null),
        ("azurite", "resource", null, null, "storage", null),
        ("localstack", "resource", null, null, "storage", null),
        ("keycloak", "resource", null, null, "custom", "Identidad (OIDC)"),
        ("vault", "resource", null, null, "secret", null),
        ("nginx", "resource", null, null, "gateway", null),
        ("traefik", "resource", null, null, "gateway", null),
        ("envoy", "resource", null, null, "gateway", null),
        ("haproxy", "resource", null, null, "gateway", null),
    ];

    private static readonly string[] DatabaseNameVariables =
        ["POSTGRES_DB", "MYSQL_DATABASE", "MARIADB_DATABASE", "MONGO_INITDB_DATABASE"];

    public string Id => "compose";

    public IReadOnlyList<string> Entities { get; } = ["service", "database", "resource"];

    public IReadOnlyList<string> Relations { get; } = ["depends-on"];

    public void Run(AnalysisContext context)
    {
        foreach (var file in context.Files.Where(f => ComposeName().IsMatch(f.Name)))
        {
            if (context.Read(file, Id) is not { } text)
            {
                continue;
            }

            Yaml.Document document;
            try
            {
                document = Yaml.Parse(text);
            }
            catch (Exception ex) when (ex is YamlException or InvalidDataException)
            {
                context.Findings.Limitation("unparsed-file", "YAML inválido: no se pudo leer el compose.", Id, file.Path);
                continue;
            }

            if (document.Root?["services"] is not JsonObject services)
            {
                continue;
            }

            var keys = new Dictionary<string, string>(StringComparer.Ordinal);
            var evidenceOf = new Dictionary<string, string>(StringComparer.Ordinal);
            var composeEvidence = context.Findings.Evidence(Id, file.Path, Confidence.High, "services",
                document.Lines.TryGetValue("/services", out var servicesLine) ? new Lines(servicesLine, servicesLine) : null);
            context.Findings.Technology("docker-compose", "Docker Compose", null, composeEvidence);

            foreach (var (name, definition) in services.OrderBy(s => s.Key, StringComparer.Ordinal))
            {
                if (definition is not JsonObject service)
                {
                    continue;
                }

                var line = document.Lines.TryGetValue(Yaml.Pointer("services", name), out var l) ? new Lines(l, l) : (Lines?)null;
                var image = Yaml.Scalar(service["image"]);
                var (match, exact) = image is null ? (default, false) : Classify(image);
                var certainty = exact ? Confidence.High : Confidence.Medium;
                var note = image is null ? (service.ContainsKey("build") ? "Servicio con build propio" : "Servicio sin imagen") : $"Imagen {image}";
                var evidence = context.Findings.Evidence(Id, file.Path, match.Kind is null ? Confidence.High : certainty, $"services.{name}", line, note);
                evidenceOf[name] = evidence;

                if (match.Kind == "database")
                {
                    // Literal, o el valor por defecto literal de ${VAR:-valor}: en ejecución lo puede cambiar una variable.
                    var declared = DatabaseNameVariables.Select(v => Environment(service, v)).FirstOrDefault(v => v is not null);
                    var (databaseName, fromDefault) = declared switch
                    {
                        null => (name, false),
                        _ when !declared.Contains('$', StringComparison.Ordinal) => (declared, false),
                        _ when DefaultValue().Match(declared) is { Success: true } m && !m.Groups[1].Value.Contains('$', StringComparison.Ordinal) => (m.Groups[1].Value, true),
                        _ => (name, false),
                    };
                    if (fromDefault)
                    {
                        certainty = Confidence.Medium;
                    }
                    var key = DiscoveryKeys.Database(match.Engine!, databaseName);
                    var technology = match.Engine!.ToUpperInvariant() switch
                    {
                        "POSTGRESQL" => "postgresql",
                        "MYSQL" => "mysql",
                        "MARIADB" => "mariadb",
                        "SQL SERVER" => "sqlserver",
                        "ORACLE" => "oracle",
                        "MONGODB" => "mongodb",
                        _ => null,
                    };
                    if (technology is not null)
                    {
                        context.Findings.Technology(technology, match.Engine!, Tag(image!), evidence);
                    }

                    if (context.Findings.Entity(key, "database", databaseName, Basis.Observed, certainty, evidence) is { } entity)
                    {
                        entity.Technology ??= technology;
                        entity.Database ??= new JsonObject { ["engine"] = match.Engine, ["model"] = match.Model, ["name"] = Text.Truncate(databaseName, 120) };
                    }

                    keys[name] = key;
                }
                else if (match.Kind == "resource")
                {
                    var key = DiscoveryKeys.Resource(match.Resource!, name);
                    var resource = new JsonObject { ["kind"] = match.Resource };
                    if (match.Label is not null)
                    {
                        resource["label"] = match.Label;
                    }

                    resource["name"] = Text.Truncate(name, 120);
                    if (context.Findings.Entity(key, "resource", name, Basis.Observed, certainty, evidence) is { } entity)
                    {
                        entity.Resource ??= resource;
                    }

                    keys[name] = key;
                }
                else
                {
                    var key = DiscoveryKeys.Service(name);
                    var confidence = service.ContainsKey("build") ? Confidence.High : Confidence.Medium;
                    if (context.Findings.Entity(key, "service", name, Basis.Observed, confidence, evidence) is { } entity)
                    {
                        entity.Runtime ??= "container";
                    }

                    keys[name] = key;
                }
            }

            foreach (var (name, definition) in services.OrderBy(s => s.Key, StringComparer.Ordinal))
            {
                if (definition is not JsonObject service || !keys.TryGetValue(name, out var from))
                {
                    continue;
                }

                foreach (var target in DependsOn(service["depends_on"]))
                {
                    if (keys.TryGetValue(target, out var to))
                    {
                        context.Findings.Relation("depends-on", from, to, Basis.Observed, Confidence.High, evidenceOf[name]);
                    }
                    else
                    {
                        context.Findings.Limitation("unknown-reference",
                            $"El servicio {name} depende de {target}, que no está en este compose.", Id, file.Path);
                    }
                }
            }
        }
    }

    private static IEnumerable<string> DependsOn(JsonNode? node) => node switch
    {
        JsonArray list => list.Select(Yaml.Scalar).OfType<string>(),
        JsonObject map => map.Select(e => e.Key),
        _ => [],
    };

    /// <summary>Una variable de <c>environment</c> (lista <c>K=V</c> o mapa).</summary>
    private static string? Environment(JsonObject service, string variable) => service["environment"] switch
    {
        JsonObject map => Yaml.Scalar(map[variable]),
        JsonArray list => list.Select(Yaml.Scalar).OfType<string>()
            .Where(e => e.StartsWith(variable + "=", StringComparison.Ordinal))
            .Select(e => e[(variable.Length + 1)..])
            .FirstOrDefault(),
        _ => null,
    };

    /// <summary>
    /// Qué es una imagen por sus segmentos sin etiqueta (<c>mcr.microsoft.com/mssql/server:2022</c> → <c>mssql</c>):
    /// un segmento igual al patrón es exacto; uno que empieza por él (ej. <c>redis-exporter</c>) no lo es.
    /// </summary>
    private static ((string Pattern, string Kind, string? Engine, string? Model, string? Resource, string? Label) Match, bool Exact) Classify(string image)
    {
        var segments = image.Split('@')[0].Split('/').Select(s => s.Split(':')[0]).ToArray();
        foreach (var candidate in Images)
        {
            if (segments.Any(s => s.Equals(candidate.Pattern, StringComparison.OrdinalIgnoreCase)))
            {
                return (candidate, true);
            }
        }

        foreach (var candidate in Images)
        {
            if (segments[^1].StartsWith(candidate.Pattern, StringComparison.OrdinalIgnoreCase))
            {
                return (candidate, false);
            }
        }

        return (default, false);
    }

    private static string? Tag(string image)
    {
        var last = image.Split('@')[0].Split('/')[^1];
        var colon = last.IndexOf(':', StringComparison.Ordinal);
        var tag = colon >= 0 ? last[(colon + 1)..] : null;
        return tag is null || tag == "latest" || tag.Contains('$', StringComparison.Ordinal) ? null : tag;
    }

    /// <summary><c>${VAR:-valor}</c> o <c>${VAR-valor}</c> completo.</summary>
    [GeneratedRegex(@"^\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}$", RegexOptions.CultureInvariant)]
    private static partial Regex DefaultValue();

    [GeneratedRegex(@"^(docker-)?compose([.-][\w.-]+)?\.ya?ml$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ComposeName();
}
