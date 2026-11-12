using System.Reflection;
using System.Text.Json;
using Json.Schema;

namespace Walkie.Shared.Schemas;

/// <summary>
/// Schemas de <c>packages/schema</c> embebidos (fuente de verdad, sin copia). El grafo valida los lienzos (Canvas) y sus
/// definiciones <c>http</c>, <c>database</c>, <c>resource</c> y <c>runtime</c> validan también la definición compartida del catálogo (Apps).
/// </summary>
public static class WalkieSchemas
{
    private const string GraphId = "https://github.com/mu4ddib/Walkie/packages/schema/walkie-graph.schema.json";
    private const string AppMapId = "https://github.com/mu4ddib/Walkie/packages/schema/walkie-app-map.schema.json";

    /// <summary>Registro propio: no se mezcla con el global de la aplicación ni de las pruebas.</summary>
    private static readonly BuildOptions Options = new() { SchemaRegistry = new SchemaRegistry() };

    /// <summary><c>walkie-graph.schema.json</c>.</summary>
    public static JsonSchema Graph { get; } = JsonSchema.FromText(Load("walkie-graph.schema.json"), Options);

    /// <summary><c>$defs/http</c> del grafo: contrato de una API.</summary>
    public static JsonSchema Http { get; } = Definition("http");

    /// <summary><c>$defs/database</c> del grafo: estructura de una base de datos.</summary>
    public static JsonSchema Database { get; } = Definition("database");

    /// <summary><c>$defs/resource</c> del grafo: subtipo y detalles de un recurso de infraestructura.</summary>
    public static JsonSchema Resource { get; } = Definition("resource");

    /// <summary><c>$defs/runtime</c> del grafo: dónde corre un servicio.</summary>
    public static JsonSchema Runtime { get; } = Definition("runtime");

    /// <summary><c>walkie-app-map.schema.json</c>: mapa de una app.</summary>
    public static JsonSchema AppMap { get; } = JsonSchema.FromText(Load("walkie-app-map.schema.json"), Options);

    /// <summary><c>walkie-ai-context.schema.json</c>: contexto para IA (lo valida la prueba del export, no un request).</summary>
    public static JsonSchema AiContext { get; } = LoadAfterGraph("walkie-ai-context.schema.json");

    /// <summary><c>walkie-app-ai-context.schema.json</c>: contexto para IA de una app (usa el de la feature).</summary>
    public static JsonSchema AppAiContext { get; } = LoadAfter(AiContext, "walkie-app-ai-context.schema.json");

    /// <summary><c>$defs/layout</c> del mapa: distribución guardada (cuerpo de <c>PUT /api/apps/{appId}/map/layout</c>).</summary>
    public static JsonSchema MapLayout { get; } = JsonSchema.FromText(
        $$"""{ "$ref": "{{AppMapId}}#/$defs/layout" }""",
        Options);

    /// <summary>
    /// Errores por ruta JSON con <paramref name="prefix"/> delante (ej. <c>/nodes/n1</c> o <c>Http</c>); vacío si cumple.
    /// </summary>
    public static Dictionary<string, string[]> Errors(JsonSchema schema, JsonElement value, string prefix = "")
    {
        var results = schema.Evaluate(value, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (results.IsValid)
        {
            return [];
        }

        var errors = new Dictionary<string, List<string>>();
        foreach (var detail in (results.Details ?? []).Where(d => d.Errors is { Count: > 0 }))
        {
            var path = prefix + detail.InstanceLocation;
            var key = path.Length == 0 ? "/" : path;
            if (!errors.TryGetValue(key, out var list))
            {
                errors[key] = list = [];
            }

            list.AddRange(detail.Errors!.Values.Where(m => !list.Contains(m)));
        }

        if (errors.Count == 0)
        {
            errors[prefix.Length == 0 ? "/" : prefix] = ["No cumple el schema."];
        }

        return errors.ToDictionary(e => e.Key, e => e.Value.ToArray());
    }

    private static JsonSchema LoadAfter(JsonSchema dependency, string name)
    {
        _ = dependency; // el schema del que usa $refs tiene que estar registrado antes
        return JsonSchema.FromText(Load(name), Options);
    }

    private static JsonSchema LoadAfterGraph(string name)
    {
        _ = Graph; // usa $defs del grafo: tiene que estar registrado antes
        return JsonSchema.FromText(Load(name), Options);
    }

    private static JsonSchema Definition(string name)
    {
        _ = Graph; // el grafo tiene que estar registrado antes de resolver el $ref
        return JsonSchema.FromText($$"""{ "$ref": "{{GraphId}}#/$defs/{{name}}" }""", Options);
    }

    private static string Load(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Falta el recurso embebido {name}.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
