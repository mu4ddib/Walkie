using System.Text.RegularExpressions;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Caso real: Walkie se analiza a sí mismo (spec walkie-live). Los resultados esperados no se escriben a mano: salen
/// del código del repo (cuántos <c>MapGet/MapPost…</c> tiene la API, qué proyectos referencia el host), así la prueba
/// sigue valiendo cuando la API cambia.
/// </summary>
public sealed partial class WalkieRepositoryTests
{
    private static readonly Lazy<AnalysisResult> Result = new(() => ProjectAnalyzer.Analyze(new AnalyzerOptions
    {
        Root = SafetyAndStabilityTests.RepoRoot(),
        SourceId = TempProject.SourceId,
        WriteSourceFile = false,
        Clock = new FixedClock(),
    }));

    [Fact]
    public void Cada_endpoint_de_la_API_es_una_api_del_paquete()
    {
        var api = Path.Combine(SafetyAndStabilityTests.RepoRoot(), "apps", "api", "src");
        var declared = Directory.GetFiles(api, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Sum(f => MapCall().Count(File.ReadAllText(f)));

        Assert.True(declared > 0);
        Assert.Equal(declared, Result.Value.Keys("api").Length);
        Assert.Contains("api:GET /api/apps", Result.Value.Keys("api"));
        Assert.Contains("api:PUT /api/features/{}/canvas", Result.Value.Keys("api"));
    }

    [Fact]
    public void El_host_es_un_servicio_y_cada_modulo_de_la_API_con_endpoints_o_datos_es_un_modulo()
    {
        var result = Result.Value;
        var modules = Directory.GetDirectories(Path.Combine(SafetyAndStabilityTests.RepoRoot(), "apps", "api", "src"), "Walkie.Modules.*")
            .Select(d => "module:" + Path.GetFileName(d))
            .Order(StringComparer.Ordinal);

        Assert.Equal(["service:Walkie.Api"], result.Keys("service"));
        Assert.Equal(modules, result.Keys("module"));
        Assert.All(result.Keys("module"), m => Assert.Contains($"depends-on:service:Walkie.Api->{m}", result.RelationKeys()));
        Assert.Contains("depends-on:module:Walkie.Modules.Canvas->module:Walkie.Modules.Apps", result.RelationKeys());
    }

    [Fact]
    public void Las_bases_y_los_recursos_salen_de_los_DbContext_y_de_infra()
    {
        var result = Result.Value;

        Assert.Contains("database:postgresql/walkie", result.Keys("database")); // infra/docker-compose.yml
        Assert.Contains("database:postgresql/AppsDbContext", result.Keys("database"));
        Assert.Contains("resource:storage/rustfs", result.Keys("resource"));
        Assert.Contains("resource:custom/keycloak", result.Keys("resource"));
        Assert.Contains("react", result.TechnologyIds());
        Assert.Contains("frontend-semantics-not-analyzed", result.LimitationCodes());
    }

    [Fact]
    public void El_paquete_de_Walkie_cumple_el_contrato_y_no_escribe_en_el_repo()
    {
        Assert.Empty(TempProject.Validate(Result.Value.Manifest, Result.Value.Discovery));
        Assert.False(File.Exists(Path.Combine(SafetyAndStabilityTests.RepoRoot(), ".walkie", "source.json")));
    }

    [GeneratedRegex(@"\.Map(Get|Post|Put|Patch|Delete)\(", RegexOptions.CultureInvariant)]
    private static partial Regex MapCall();
}
