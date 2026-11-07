using System.Reflection;
using System.Text.Json;
using Json.Schema;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Valida un grafo contra <c>packages/schema/walkie-graph.schema.json</c> (embebido en el ensamblado)
/// y luego la integridad que el schema no puede expresar (claves = ids, conexiones y layout apuntan a nodos, inputs y reglas).
/// </summary>
internal sealed class GraphValidator
{
    private readonly JsonSchema _schema = LoadSchema();

    /// <summary>Errores por ruta JSON (ej. <c>/nodes/n1/type</c>); vacío si el grafo es válido.</summary>
    public Dictionary<string, string[]> Validate(JsonElement graph)
    {
        var results = _schema.Evaluate(graph, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (!results.IsValid)
        {
            return SchemaErrors(results);
        }

        return IntegrityErrors(graph);
    }

    private static Dictionary<string, string[]> SchemaErrors(EvaluationResults results)
    {
        var errors = new Dictionary<string, List<string>>();
        foreach (var detail in (results.Details ?? []).Where(d => d.Errors is { Count: > 0 }))
        {
            var path = detail.InstanceLocation.ToString();
            var key = path.Length == 0 ? "/" : path;
            if (!errors.TryGetValue(key, out var list))
            {
                errors[key] = list = [];
            }

            list.AddRange(detail.Errors!.Values.Where(m => !list.Contains(m)));
        }

        if (errors.Count == 0)
        {
            errors["/"] = ["El grafo no cumple el schema."];
        }

        return errors.ToDictionary(e => e.Key, e => e.Value.ToArray());
    }

    private static Dictionary<string, string[]> IntegrityErrors(JsonElement graph)
    {
        var errors = new Dictionary<string, string[]>();
        var nodes = graph.GetProperty("nodes");
        var nodeIds = nodes.EnumerateObject().Select(n => n.Name).ToHashSet(StringComparer.Ordinal);

        var ruleIds = nodes.EnumerateObject()
            .Where(n => n.Value.GetProperty("type").GetString() == "rule")
            .Select(n => n.Name)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var node in nodes.EnumerateObject())
        {
            if (node.Value.GetProperty("id").GetString() != node.Name)
            {
                errors[$"/nodes/{node.Name}/id"] = ["El id del nodo debe coincidir con su clave."];
            }

            InputErrors(node, nodeIds, ruleIds, errors);
        }

        foreach (var edge in graph.GetProperty("edges").EnumerateObject())
        {
            if (edge.Value.GetProperty("id").GetString() != edge.Name)
            {
                errors[$"/edges/{edge.Name}/id"] = ["El id de la conexión debe coincidir con su clave."];
            }

            foreach (var end in new[] { "from", "to" })
            {
                if (!nodeIds.Contains(edge.Value.GetProperty(end).GetString()!))
                {
                    errors[$"/edges/{edge.Name}/{end}"] = ["La conexión apunta a un nodo que no existe."];
                }
            }
        }

        foreach (var position in graph.GetProperty("layout").EnumerateObject())
        {
            if (!nodeIds.Contains(position.Name))
            {
                errors[$"/layout/{position.Name}"] = ["La posición es de un nodo que no existe."];
            }
        }

        return errors;
    }

    /// <summary>Inputs de un nodo: nombres únicos, <c>options</c> solo en <c>enum</c> y <c>ruleIds</c> a nodos <c>rule</c>.</summary>
    private static void InputErrors(
        JsonProperty node, HashSet<string> nodeIds, HashSet<string> ruleIds, Dictionary<string, string[]> errors)
    {
        if (!node.Value.TryGetProperty("inputs", out var inputs))
        {
            return;
        }

        var names = new HashSet<string>(StringComparer.Ordinal);
        var i = 0;
        foreach (var input in inputs.EnumerateArray())
        {
            var path = $"/nodes/{node.Name}/inputs/{i}";
            if (!names.Add(input.GetProperty("name").GetString()!))
            {
                errors[$"{path}/name"] = ["Ya hay un input con ese nombre en el nodo."];
            }

            if (input.TryGetProperty("options", out _) && input.GetProperty("type").GetString() != "enum")
            {
                errors[$"{path}/options"] = ["Solo los inputs enum tienen opciones."];
            }

            if (input.TryGetProperty("ruleIds", out var refs))
            {
                var j = 0;
                foreach (var rule in refs.EnumerateArray())
                {
                    var id = rule.GetString()!;
                    if (!ruleIds.Contains(id))
                    {
                        errors[$"{path}/ruleIds/{j}"] = [nodeIds.Contains(id)
                            ? "El input apunta a un nodo que no es una regla."
                            : "El input apunta a una regla que no existe."];
                    }

                    j++;
                }
            }

            i++;
        }
    }

    private static JsonSchema LoadSchema()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("walkie-graph.schema.json")
            ?? throw new InvalidOperationException("Falta el recurso embebido walkie-graph.schema.json.");
        using var reader = new StreamReader(stream);
        return JsonSchema.FromText(reader.ReadToEnd());
    }
}
