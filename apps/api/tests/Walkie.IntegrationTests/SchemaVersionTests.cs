using System.Text.Json;
using Walkie.Shared;

namespace Walkie.IntegrationTests;

public sealed class SchemaVersionTests
{
    [Fact]
    public void La_api_usa_la_misma_version_que_packages_schema()
    {
        var path = Path.Combine(FindRepoRoot(), "packages", "schema", "walkie-graph.schema.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));

        var schemaVersion = doc.RootElement
            .GetProperty("properties").GetProperty("schemaVersion").GetProperty("const").GetInt32();

        Assert.Equal(WalkieInfo.SchemaVersion, schemaVersion);
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("No se encontró la raíz del repo (global.json).");
    }
}
