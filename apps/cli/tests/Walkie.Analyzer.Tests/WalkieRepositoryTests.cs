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

        // El host de la API y la app web (apps/web/package.json, tarea 8).
        Assert.Equal(["service:@walkie/web", "service:Walkie.Api"], result.Keys("service"));
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
    }

    [Fact]
    public void Cada_ruta_de_la_web_es_una_pantalla_y_todos_los_detectores_corren()
    {
        var result = Result.Value;
        var routes = File.ReadAllText(Path.Combine(SafetyAndStabilityTests.RepoRoot(), "apps", "web", "src", "routes.tsx"));
        var declared = RoutePath().Matches(routes).Count(m => m.Groups[1].Value != "'*'");

        // Todas las rutas de routes.tsx salvo el comodín, también las que usan una constante importada (APPS_PATH).
        Assert.Equal(declared, result.Keys("screen").Length);
        Assert.Contains("screen:apps/web:/apps", result.Keys("screen"));
        Assert.Contains("screen:apps/web:/apps/{}/catalog/{}", result.Keys("screen"));
        Assert.Contains("screen:apps/web:/s/{}", result.Keys("screen"));
        Assert.DoesNotContain("frontend-semantics-not-analyzed", result.LimitationCodes());
        Assert.All(result.Manifest["detectors"]!.AsArray(), d => Assert.Equal("ran", d!["status"]!.GetValue<string>()));
    }

    /// <summary>
    /// Caso A (spec walkie-live-arquitectura, D2): la verdad sale de <c>apps/web/src/api/client.ts</c> leído con una
    /// expresión regular independiente del analizador: cada <c>request(…)</c> y <c>send(…)</c> con su ruta y su método.
    /// Se mide por separado la detección del endpoint (todos, sin APIs de más) y quién lo llama (una pantalla o la app).
    /// </summary>
    [Fact]
    public void Las_llamadas_del_cliente_propio_de_la_web_llegan_a_la_api_sin_inventar_ninguna()
    {
        var result = Result.Value;
        var client = File.ReadAllText(Path.Combine(SafetyAndStabilityTests.RepoRoot(), "apps", "web", "src", "api", "client.ts"));
        var expected = new SortedSet<string>(StringComparer.Ordinal);
        foreach (Match call in ClientCall().Matches(client))
        {
            // Cada ${…} que ocupa un segmento es un parámetro; uno pegado al final es la query (`${force ? '?force=true' : ''}`).
            var path = Placeholder().Replace(call.Groups["path"].Value, "{}").Replace("}{}", "}", StringComparison.Ordinal);
            path = GluedQuery().Replace(path, "");
            var rest = client[(call.Index + call.Length)..Math.Min(client.Length, call.Index + call.Length + 200)];
            var close = rest.IndexOf(");", StringComparison.Ordinal);
            var method = ClientMethod().Match(close < 0 ? rest : rest[..close]) is { Success: true } m ? m.Groups[1].Value : "GET";
            expected.Add($"api:{method} {path.Split('?')[0]}");
        }

        // importPackage arma la ruta en una constante local con un condicional: las dos ramas son llamadas reales (la
        // expresión regular no las ve; el analizador sí, por la constante y el ternario).
        Assert.Contains("const path = appId === null ? '/api/apps/import' : `/api/apps/${encodeURIComponent(appId)}/import`;", client, StringComparison.Ordinal);
        expected.Add("api:POST /api/apps/import");
        expected.Add("api:POST /api/apps/{}/import");

        var calls = result.Discovery["relations"]!.AsArray().Select(r => r!.AsObject()).Where(r => r["kind"]!.GetValue<string>() == "calls").ToList();
        var called = calls.Select(r => r["to"]!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
        Assert.True(expected.Count >= 40, $"El cliente cambió de forma: solo {expected.Count} llamadas.");
        Assert.Empty(expected.Except(called));          // detección: todos los endpoints del cliente
        Assert.Empty(called.Except(expected));          // sin APIs inventadas
        Assert.All(calls, r => Assert.True(r["from"]!.GetValue<string>() is var from && (from.StartsWith("screen:apps/web:", StringComparison.Ordinal) || from == "service:@walkie/web")));

        // Atribución: cada pantalla llama a algo; las que llegan por hooks y componentes son inferidas, nunca altas.
        var screens = result.Keys("screen");
        Assert.All(screens, s => Assert.Contains(calls, r => r["from"]!.GetValue<string>() == s));
        Assert.DoesNotContain(calls, r => r["confidence"]!.GetValue<string>() == "high");
        Assert.DoesNotContain("dynamic-http-url", result.LimitationCodes());
        Assert.Contains("non-api-fetch", result.LimitationCodes()); // imágenes y fuentes de canvasImage.ts
    }

    /// <summary>Caso A, D3: las navegaciones por funciones de rutas se resuelven y las que van a una variable se declaran.</summary>
    [Fact]
    public void La_navegacion_de_la_web_usa_las_funciones_de_rutas_y_declara_lo_que_no_resuelve()
    {
        var result = Result.Value;
        var navigation = result.RelationKeys().Where(k => k.StartsWith("navigates:", StringComparison.Ordinal)).ToArray();
        Assert.True(navigation.Length >= 30, $"Solo {navigation.Length} navegaciones.");
        Assert.Contains("navigates:screen:apps/web:/apps/{}->screen:apps/web:/apps/{}/catalog", navigation); // catalogPath(appId)
        Assert.Contains("navigates:screen:apps/web:/apps/{}->screen:apps/web:/apps/{}/map", navigation);     // mapPath(appId)
        // La vista pública de un enlace (/s/…) y la autenticada nunca se cruzan.
        Assert.All(navigation, k => Assert.Equal(k.Contains("navigates:screen:apps/web:/s/", StringComparison.Ordinal), k.Contains("->screen:apps/web:/s/", StringComparison.Ordinal)));
        Assert.Contains("dynamic-navigation", result.LimitationCodes()); // navigate(path) con path variable
    }

    [Fact]
    public void El_paquete_de_Walkie_cumple_el_contrato_y_no_escribe_en_el_repo()
    {
        Assert.Empty(TempProject.Validate(Result.Value.Manifest, Result.Value.Discovery));
        Assert.False(File.Exists(Path.Combine(SafetyAndStabilityTests.RepoRoot(), ".walkie", "source.json")));
    }

    [GeneratedRegex(@"\.Map(Get|Post|Put|Patch|Delete)\(", RegexOptions.CultureInvariant)]
    private static partial Regex MapCall();

    [GeneratedRegex(@"\bpath:\s*('[^']*'|[A-Z_]+)", RegexOptions.CultureInvariant)]
    private static partial Regex RoutePath();

    [GeneratedRegex(@"\b(?:request|send)(?:<[^>(]*>)?\(\s*(?:'(?<path>/api[^']*)'|`(?<path>/api[^`]*)`)", RegexOptions.CultureInvariant)]
    private static partial Regex ClientCall();

    [GeneratedRegex(@"method:\s*'([A-Z]+)'", RegexOptions.CultureInvariant)]
    private static partial Regex ClientMethod();

    [GeneratedRegex(@"\$\{[^}]*\}", RegexOptions.CultureInvariant)]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"(?<=[^/])\{\}$", RegexOptions.CultureInvariant)]
    private static partial Regex GluedQuery();
}
