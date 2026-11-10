using System.Text.Json;
using Walkie.Shared.Schemas;

namespace Walkie.Modules.Canvas.Features;

/// <summary>
/// Valida un grafo contra <c>packages/schema/walkie-graph.schema.json</c> (<see cref="WalkieSchemas"/>)
/// y luego la integridad que el schema no puede expresar (claves = ids, conexiones, layout y pasos de tours apuntan a nodos, grupos o notas, inputs y reglas, salidas de una decisión y solicitud de una respuesta).
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

        var groupIds = graph.TryGetProperty("groups", out var groups)
            ? groups.EnumerateObject().Select(g => g.Name).ToHashSet(StringComparer.Ordinal)
            : [];

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
            OnlyOn(node, "mode", "rule", "Solo una regla puede ser una decisión.", errors);
            BranchErrors(node, errors);
            if (node.Value.TryGetProperty("groupId", out var groupId) && !groupIds.Contains(groupId.GetString()!))
            {
                errors[$"/nodes/{node.Name}/groupId"] = ["El nodo está en un grupo que no existe."];
            }
        }

        if (graph.TryGetProperty("groups", out var groupMap))
        {
            foreach (var group in groupMap.EnumerateObject())
            {
                if (group.Value.GetProperty("id").GetString() != group.Name)
                {
                    errors[$"/groups/{group.Name}/id"] = ["El id del grupo debe coincidir con su clave."];
                }

                if (nodeIds.Contains(group.Name))
                {
                    errors[$"/groups/{group.Name}"] = ["Un grupo no puede tener el id de un nodo."];
                }
            }
        }

        var stickyIds = new HashSet<string>(StringComparer.Ordinal);
        if (graph.TryGetProperty("stickyNotes", out var stickyNotes))
        {
            foreach (var note in stickyNotes.EnumerateObject())
            {
                stickyIds.Add(note.Name);
                if (note.Value.GetProperty("id").GetString() != note.Name)
                {
                    errors[$"/stickyNotes/{note.Name}/id"] = ["El id de la nota debe coincidir con su clave."];
                }

                if (nodeIds.Contains(note.Name) || groupIds.Contains(note.Name))
                {
                    errors[$"/stickyNotes/{note.Name}"] = ["Una nota no puede tener el id de un nodo o de un grupo."];
                }
            }
        }

        var edges = graph.GetProperty("edges");
        foreach (var edge in edges.EnumerateObject())
        {
            EdgeLinkErrors(edge, edges, nodes, errors);

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
            if (groupIds.Contains(position.Name))
            {
                if (!position.Value.TryGetProperty("w", out _) || !position.Value.TryGetProperty("h", out _))
                {
                    errors[$"/layout/{position.Name}"] = ["La caja de un grupo necesita ancho y alto."];
                }
            }
            else if (!nodeIds.Contains(position.Name) && !stickyIds.Contains(position.Name))
            {
                errors[$"/layout/{position.Name}"] = ["La posición es de un nodo, grupo o nota que no existe."];
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

    /// <summary>Salidas de una decisión: solo en una regla en modo <c>decision</c> y con ids únicos.</summary>
    private static void BranchErrors(JsonProperty node, Dictionary<string, string[]> errors)
    {
        if (!node.Value.TryGetProperty("branches", out var branches))
        {
            return;
        }

        var decision = node.Value.GetProperty("type").GetString() == "rule"
            && node.Value.TryGetProperty("mode", out var mode) && mode.GetString() == "decision";
        if (!decision)
        {
            errors[$"/nodes/{node.Name}/branches"] = ["Solo una decisión tiene salidas."];
            return;
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        var i = 0;
        foreach (var branch in branches.EnumerateArray())
        {
            if (!ids.Add(branch.GetProperty("id").GetString()!))
            {
                errors[$"/nodes/{node.Name}/branches/{i}/id"] = ["Ya hay una salida con ese id en la decisión."];
            }

            i++;
        }
    }

    /// <summary>
    /// Vínculos de una conexión: <c>branch</c> es una salida de la decisión de origen y <c>replyTo</c> es otra
    /// conexión <c>request</c> del lienzo.
    /// </summary>
    private static void EdgeLinkErrors(JsonProperty edge, JsonElement edges, JsonElement nodes, Dictionary<string, string[]> errors)
    {
        if (edge.Value.TryGetProperty("branch", out var branch))
        {
            var known = nodes.TryGetProperty(edge.Value.GetProperty("from").GetString()!, out var source)
                && source.TryGetProperty("branches", out var branches)
                && branches.EnumerateArray().Any(b => b.GetProperty("id").GetString() == branch.GetString());
            if (!known)
            {
                errors[$"/edges/{edge.Name}/branch"] = ["La conexión apunta a una salida que su nodo de origen no tiene."];
            }
        }

        if (edge.Value.TryGetProperty("replyTo", out var replyTo))
        {
            var id = replyTo.GetString()!;
            var isRequest = id != edge.Name
                && edges.TryGetProperty(id, out var request)
                && request.GetProperty("kind").GetString() == "request";
            if (!isRequest)
            {
                errors[$"/edges/{edge.Name}/replyTo"] = ["La respuesta apunta a una solicitud que no existe."];
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
