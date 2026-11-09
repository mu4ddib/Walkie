using System.Text.Json;
using Walkie.Shared.Schemas;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Valida un grafo contra <c>packages/schema/walkie-graph.schema.json</c> (<see cref="WalkieSchemas"/>)
/// y luego la integridad que el schema no puede expresar (claves = ids, conexiones, layout y pasos de tours apuntan a nodos, inputs y reglas).
/// </summary>
internal sealed class GraphValidator
{
    private readonly Json.Schema.JsonSchema _schema = WalkieSchemas.Graph;

    /// <summary>Errores por ruta JSON (ej. <c>/nodes/n1/type</c>); vacío si el grafo es válido.</summary>
    public Dictionary<string, string[]> Validate(JsonElement graph)
    {
        var errors = WalkieSchemas.Errors(_schema, graph);
        return errors.Count > 0 ? errors : IntegrityErrors(graph);
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
            OnlyOn(node, "assetId", "screen", "Solo las pantallas tienen imagen.", errors);
            OnlyOn(node, "targetFeatureId", "portal", "Solo los portales tienen feature destino.", errors);
            OnlyOn(node, "http", "api", "Solo las API tienen contrato.", errors);
            OnlyOn(node, "database", "database", "Solo las bases de datos tienen estructura.", errors);
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

        if (graph.TryGetProperty("tours", out var tours))
        {
            TourErrors(tours, nodeIds, errors);
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

    /// <summary>Tours: clave = <c>id</c> y cada paso apunta a un nodo existente (spec modo-tour, criterio 12).</summary>
    private static void TourErrors(JsonElement tours, HashSet<string> nodeIds, Dictionary<string, string[]> errors)
    {
        foreach (var tour in tours.EnumerateObject())
        {
            if (tour.Value.GetProperty("id").GetString() != tour.Name)
            {
                errors[$"/tours/{tour.Name}/id"] = ["El id del tour debe coincidir con su clave."];
            }

            var i = 0;
            foreach (var step in tour.Value.GetProperty("steps").EnumerateArray())
            {
                if (!nodeIds.Contains(step.GetProperty("nodeId").GetString()!))
                {
                    errors[$"/tours/{tour.Name}/steps/{i}/nodeId"] = ["El paso apunta a un nodo que no existe."];
                }

                i++;
            }
        }
    }

    /// <summary>La propiedad solo puede estar en nodos del tipo dado.</summary>
    private static void OnlyOn(JsonProperty node, string property, string type, string message, Dictionary<string, string[]> errors)
    {
        if (node.Value.TryGetProperty(property, out _) && node.Value.GetProperty("type").GetString() != type)
        {
            errors[$"/nodes/{node.Name}/{property}"] = [message];
        }
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
}
