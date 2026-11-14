using System.Text.Json;
using System.Text.Json.Nodes;

namespace Walkie.IntegrationTests;

/// <summary>Ejemplos de <c>packages/schema/examples</c> (spec walkie-live): datos ficticios, la fuente de las pruebas del contrato.</summary>
internal static class DiscoveryExamples
{
    public static JsonObject Pack(string project, string file) => Read("walkiepack", project, file);

    public static JsonObject Record(string file) => Read("discovery-api", file);

    public static JsonElement Element(JsonNode node) => JsonSerializer.SerializeToElement(node);

    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("No se encontró la raíz del repo (global.json).");
    }

    private static JsonObject Read(params string[] parts) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine([RepoRoot(), "packages", "schema", "examples", .. parts])))!.AsObject();
}
