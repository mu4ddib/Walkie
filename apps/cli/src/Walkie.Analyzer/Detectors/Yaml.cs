using System.Text.Json.Nodes;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// YAML a <see cref="JsonNode"/> con el modelo de nodos de YamlDotNet (no deserializa a tipos: no puede crear objetos
/// ni ejecutar nada). Límites de profundidad y de nodos contra documentos hostiles (anclas en cadena). Guarda la línea
/// de cada clave de un mapa hasta <see cref="LineDepth"/> niveles, por puntero JSON (ej. <c>/services/db</c>).
/// </summary>
internal static class Yaml
{
    private const int MaxDepth = 64;
    private const int MaxNodes = 200_000;
    private const int LineDepth = 4;

    public sealed record Document(JsonNode? Root, IReadOnlyDictionary<string, int> Lines);

    /// <summary>Lee el primer documento; lanza <see cref="YamlException"/> o <see cref="InvalidDataException"/> si no se puede.</summary>
    public static Document Parse(string text)
    {
        var stream = new YamlStream();
        stream.Load(new StringReader(text));
        if (stream.Documents.Count == 0)
        {
            return new Document(null, new Dictionary<string, int>());
        }

        var lines = new Dictionary<string, int>(StringComparer.Ordinal);
        var count = 0;
        var root = Convert(stream.Documents[0].RootNode, "", 0, lines, ref count);
        return new Document(root, lines);
    }

    private static JsonNode? Convert(YamlNode node, string pointer, int depth, Dictionary<string, int> lines, ref int count)
    {
        if (depth > MaxDepth || ++count > MaxNodes)
        {
            throw new InvalidDataException("El YAML es demasiado profundo o grande.");
        }

        switch (node)
        {
            case YamlMappingNode mapping:
                var obj = new JsonObject();
                foreach (var (key, value) in mapping.Children)
                {
                    if (key is not YamlScalarNode { Value: { } name } || obj.ContainsKey(name))
                    {
                        continue;
                    }

                    var child = $"{pointer}/{name.Replace("~", "~0", StringComparison.Ordinal).Replace("/", "~1", StringComparison.Ordinal)}";
                    if (depth < LineDepth)
                    {
                        lines[child] = (int)key.Start.Line;
                    }

                    obj[name] = Convert(value, child, depth + 1, lines, ref count);
                }

                return obj;
            case YamlSequenceNode sequence:
                var array = new JsonArray();
                var i = 0;
                foreach (var item in sequence.Children)
                {
                    array.Add(Convert(item, $"{pointer}/{i++}", depth + 1, lines, ref count));
                }

                return array;
            case YamlScalarNode scalar:
                return scalar.Value is null ? null : JsonValue.Create(scalar.Value);
            default:
                return null;
        }
    }

    /// <summary>Puntero JSON de una clave (escapa <c>~</c> y <c>/</c>).</summary>
    public static string Pointer(params string[] parts) =>
        string.Concat(parts.Select(p => "/" + p.Replace("~", "~0", StringComparison.Ordinal).Replace("/", "~1", StringComparison.Ordinal)));

    /// <summary>Texto de un escalar (YAML lo deja todo como texto; JSON puede traer números o booleanos).</summary>
    public static string? Scalar(JsonNode? node) => node switch
    {
        JsonValue value when value.TryGetValue<string>(out var s) => s,
        JsonValue value => value.ToJsonString(),
        _ => null,
    };
}
