using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Walkie.Shared.Discovery;
using YamlDotNet.Core;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// Documentos OpenAPI 3 y Swagger 2 en JSON o YAML (archivos cuyo nombre contiene <c>openapi</c> o <c>swagger</c>):
/// cada operación es una api observada con su contrato (<c>$defs/http</c> del grafo: método, ruta, parámetros y
/// respuestas). Corre antes que los detectores de código, así su contrato, más completo, es el que queda. Los
/// <c>$ref</c> no se resuelven: un parámetro por referencia se omite y queda como limitación.
/// </summary>
public sealed partial class OpenApiDetector : IDetector
{
    private static readonly string[] Methods = ["get", "post", "put", "patch", "delete"];

    public string Id => "openapi";

    public IReadOnlyList<string> Entities { get; } = ["api"];

    public IReadOnlyList<string> Relations { get; } = [];

    public void Run(AnalysisContext context)
    {
        foreach (var file in context.Files.Where(f => OpenApiName().IsMatch(f.Name)))
        {
            if (context.Read(file, Id) is not { } text)
            {
                continue;
            }

            JsonNode? root;
            IReadOnlyDictionary<string, int> lines;
            try
            {
                if (file.Extension.Equals(".json", StringComparison.OrdinalIgnoreCase))
                {
                    root = JsonNode.Parse(text, documentOptions: new JsonDocumentOptions { MaxDepth = 64 });
                    lines = new Dictionary<string, int>();
                }
                else
                {
                    var document = Yaml.Parse(text);
                    (root, lines) = (document.Root, document.Lines);
                }
            }
            catch (Exception ex) when (ex is JsonException or YamlException or InvalidDataException)
            {
                context.Findings.Limitation("unparsed-file", "No se pudo leer el documento OpenAPI (JSON o YAML inválido).", Id, file.Path);
                continue;
            }

            if (root is not JsonObject document2 || (Yaml.Scalar(document2["openapi"]) ?? Yaml.Scalar(document2["swagger"])) is not { } version)
            {
                continue;
            }

            Document(context, file, document2, version, lines);
        }
    }

    private void Document(AnalysisContext context, SourceFile file, JsonObject document, string version, IReadOnlyDictionary<string, int> lines)
    {
        var basePath = document["swagger"] is not null ? Yaml.Scalar(document["basePath"]) ?? "" : "";
        if (document["paths"] is not JsonObject paths)
        {
            return;
        }

        var skippedRefs = 0;
        foreach (var (path, item) in paths.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            if (item is not JsonObject pathItem)
            {
                continue;
            }

            foreach (var method in Methods)
            {
                if (pathItem[method] is not JsonObject operation)
                {
                    continue;
                }

                var fullPath = AspNetCoreEndpointsDetector.CleanPath(basePath.TrimEnd('/') + "/" + path.TrimStart('/'));
                var line = lines.TryGetValue(Yaml.Pointer("paths", path, method), out var l) ? new Lines(l, l) : (Lines?)null;
                var evidence = context.Findings.Evidence(Id, file.Path, Confidence.High, $"paths.{path}.{method}", line);
                context.Findings.Technology("openapi", "OpenAPI", version, evidence);

                var verb = method.ToUpperInvariant();
                var key = DiscoveryKeys.Api(verb, fullPath);
                var summary = Yaml.Scalar(operation["summary"]) ?? Yaml.Scalar(operation["operationId"]);
                if (context.Findings.Entity(key, "api", summary ?? $"{verb} {fullPath}", Basis.Observed, Confidence.High, evidence) is not { } api)
                {
                    return;
                }

                if (summary is not null)
                {
                    api.PreferTitle(summary);
                }

                if (Yaml.Scalar(operation["description"]) is { } description)
                {
                    api.Description ??= description;
                }

                if (api.Http is null || api.Http["responses"] is null)
                {
                    api.Http = Http(verb, fullPath, pathItem["parameters"], operation, ref skippedRefs);
                }
            }
        }

        if (skippedRefs > 0)
        {
            context.Findings.Limitation("openapi-refs-not-resolved",
                string.Create(CultureInfo.InvariantCulture, $"{skippedRefs} parámetros por $ref no se resolvieron y no están en el contrato."), Id, file.Path);
        }
    }

    private static JsonObject Http(string method, string path, JsonNode? shared, JsonObject operation, ref int skippedRefs)
    {
        var http = new JsonObject { ["method"] = method, ["path"] = path };
        var parameters = new JsonArray();
        foreach (var parameter in Enumerate(shared).Concat(Enumerate(operation["parameters"])))
        {
            if (parameter is not JsonObject p)
            {
                continue;
            }

            if (p["$ref"] is not null)
            {
                skippedRefs++;
                continue;
            }

            var name = Yaml.Scalar(p["name"]);
            var location = Yaml.Scalar(p["in"]);
            if (name is null || location is not ("path" or "query" or "header") || parameters.Count >= 100
                || parameters.Any(e => Yaml.Scalar(e!["name"]) == name && Yaml.Scalar(e["in"]) == location))
            {
                continue;
            }

            var item = new JsonObject { ["name"] = Text.Truncate(name, 120), ["in"] = location };
            if ((Yaml.Scalar(p["schema"]?["type"]) ?? Yaml.Scalar(p["type"])) is { } type)
            {
                item["type"] = Text.Truncate(type, 60);
            }

            if (Yaml.Scalar(p["required"]) is { } required)
            {
                item["required"] = required.Equals("true", StringComparison.OrdinalIgnoreCase);
            }

            if (Yaml.Scalar(p["description"]) is { } description)
            {
                item["description"] = Text.Truncate(description, 500);
            }

            parameters.Add(item);
        }

        if (parameters.Count > 0)
        {
            http["params"] = parameters;
        }

        if (operation["responses"] is JsonObject responses)
        {
            var list = new JsonArray();
            foreach (var (code, response) in responses.OrderBy(r => r.Key, StringComparer.Ordinal))
            {
                if (!int.TryParse(code, NumberStyles.None, CultureInfo.InvariantCulture, out var status) || status is < 100 or > 599 || list.Count >= 50)
                {
                    continue;
                }

                var item = new JsonObject { ["status"] = status };
                if (Yaml.Scalar(response?["description"]) is { } description && description.Length > 0)
                {
                    item["description"] = Text.Truncate(description, 500);
                }

                list.Add(item);
            }

            if (list.Count > 0)
            {
                http["responses"] = list;
            }
        }

        return http;
    }

    private static IEnumerable<JsonNode?> Enumerate(JsonNode? node) => node as JsonArray ?? [];

    [GeneratedRegex(@"(openapi|swagger)[^/]*\.(json|ya?ml)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex OpenApiName();
}
