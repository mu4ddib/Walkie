using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Un proyecto ficticio en una carpeta temporal cuya ruta tiene espacios (como «Mis proyectos/Tienda demo»). Datos
/// inventados: ningún dato real de clientes.
/// </summary>
internal sealed class TempProject : IDisposable
{
    public static readonly Guid SourceId = Guid.Parse("0198f0c0-aaaa-7000-8000-00000000c0de");

    public TempProject()
    {
        Parent = Path.Combine(Path.GetTempPath(), "walkie analyzer " + Guid.NewGuid().ToString("N")[..8]);
        Root = Path.Combine(Parent, "Tienda demo");
        Directory.CreateDirectory(Root);
    }

    /// <summary>Carpeta que contiene al proyecto (para salidas y enlaces fuera de él).</summary>
    public string Parent { get; }

    public string Root { get; }

    public TempProject Write(string relative, string content)
    {
        var path = Path.Combine(Root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content.ReplaceLineEndings("\n"));
        return this;
    }

    public AnalysisResult Analyze(Func<AnalyzerOptions, AnalyzerOptions>? configure = null)
    {
        var options = new AnalyzerOptions { Root = Root, SourceId = SourceId, WriteSourceFile = false, Clock = new FixedClock() };
        return ProjectAnalyzer.Analyze(configure?.Invoke(options) ?? options);
    }

    public void Dispose()
    {
        if (Directory.Exists(Parent))
        {
            Directory.Delete(Parent, recursive: true);
        }
    }

    /// <summary>Lee un <c>.walkiepack</c>: sus dos documentos y la lista de entradas.</summary>
    public static (JsonObject Manifest, JsonObject Discovery, string[] Entries) ReadPack(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        JsonObject Read(string name)
        {
            using var stream = zip.GetEntry(name)!.Open();
            return JsonNode.Parse(stream)!.AsObject();
        }

        return (Read(DiscoveryFormat.ManifestPath), Read(DiscoveryFormat.DiscoveryPath), zip.Entries.Select(e => e.FullName).Order(StringComparer.Ordinal).ToArray());
    }

    public static Dictionary<string, string[]> Validate(JsonObject manifest, JsonObject discovery) =>
        DiscoveryPackValidator.Validate(JsonSerializer.SerializeToElement(manifest), JsonSerializer.SerializeToElement(discovery));
}

/// <summary>Reloj fijo: el mismo análisis da el mismo paquete.</summary>
internal sealed class FixedClock : TimeProvider
{
    public static readonly DateTimeOffset Now = new(2026, 11, 14, 12, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>Atajos de lectura de un resultado.</summary>
internal static class ResultExtensions
{
    public static JsonObject? EntityOf(this AnalysisResult result, string key) =>
        result.Discovery["entities"]!.AsArray().FirstOrDefault(e => e!["key"]!.GetValue<string>() == key)?.AsObject();

    public static string[] Keys(this AnalysisResult result, string? kind = null) =>
        result.Discovery["entities"]!.AsArray()
            .Where(e => kind is null || e!["kind"]!.GetValue<string>() == kind)
            .Select(e => e!["key"]!.GetValue<string>())
            .ToArray();

    public static string[] RelationKeys(this AnalysisResult result) =>
        result.Discovery["relations"]!.AsArray().Select(r => r!["key"]!.GetValue<string>()).ToArray();

    public static string[] LimitationCodes(this AnalysisResult result) =>
        result.Manifest["limitations"]!.AsArray().Select(l => l!["code"]!.GetValue<string>()).ToArray();

    public static string[] TechnologyIds(this AnalysisResult result) =>
        result.Manifest["technologies"]!.AsArray().Select(t => t!["id"]!.GetValue<string>()).ToArray();

    public static string Text(this AnalysisResult result) =>
        result.Manifest.ToJsonString() + result.Discovery.ToJsonString();
}
