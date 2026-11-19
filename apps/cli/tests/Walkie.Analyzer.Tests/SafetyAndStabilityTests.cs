using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Seguridad, robustez e identidad del análisis (spec walkie-live, ADR-0013 y ADR-0014): archivos malformados,
/// análisis parciales, exclusiones, límites, escaneo repetido y claves estables. Datos ficticios.
/// </summary>
public sealed class SafetyAndStabilityTests
{
    [Fact]
    public void Un_archivo_malformado_queda_como_limitacion_y_no_impide_analizar_el_resto()
    {
        using var project = new TempProject()
            .Write("roto/Roto.csproj", "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><ItemGroup>")
            .Write("docker-compose.yml", "services:\n  db: [image: postgres\n")
            .Write("docs/openapi.json", "{ \"openapi\": \"3.0.0\", \"paths\": { ")
            .Write("web/package.json", "{ \"dependencies\": ")
            .Write("src/Api/Api.csproj", "<Project Sdk=\"Microsoft.NET.Sdk.Web\" />")
            .Write("src/Api/Program.cs", "var app = WebApplication.CreateBuilder(args).Build();\napp.MapGet(\"/ok\", () => 1);\nclass Roto { void M( { }\n");

        var result = project.Analyze();

        var unparsed = result.Manifest["limitations"]!.AsArray()
            .Where(l => l!["code"]!.GetValue<string>() == "unparsed-file")
            .Select(l => l!["path"]!.GetValue<string>())
            .Order(StringComparer.Ordinal);
        Assert.Equal(["docker-compose.yml", "docs/openapi.json", "roto/Roto.csproj", "src/Api/Program.cs", "web/package.json"], unparsed);
        Assert.Contains("api:GET /ok", result.Keys()); // Roslyn se recupera del error de sintaxis
        Assert.Contains("service:Api", result.Keys());
        Assert.True(result.Partial);
    }

    [Fact]
    public void Con_solo_algunos_detectores_el_analisis_es_parcial_y_los_demas_quedan_sin_correr()
    {
        using var project = new TempProject().Dotnet().Compose();

        var result = project.Analyze(o => o with { Detectors = new HashSet<string>(["compose"], StringComparer.Ordinal) });

        Assert.True(result.Partial);
        Assert.Equal(["compose"], result.Detectors.Where(d => d.Status == "ran").Select(d => d.Id));
        Assert.All(result.Detectors.Where(d => d.Id != "compose"), d => Assert.Equal("skipped", d.Status));
        Assert.DoesNotContain(result.Keys(), k => k.StartsWith("api:", StringComparison.Ordinal));
    }

    [Fact]
    public void Los_archivos_sensibles_las_dependencias_y_lo_generado_no_se_leen()
    {
        using var project = new TempProject()
            .Write(".env", "API_KEY=clave-ficticia-123")
            .Write("src/Api/appsettings.json", "{ \"ConnectionStrings\": { \"Db\": \"Password=clave-ficticia-456\" } }")
            .Write("src/Api/appsettings.Production.json", "{ }")
            .Write("certs/servidor.pfx", "binario")
            .Write("node_modules/react/package.json", "{ \"dependencies\": { \"react\": \"1.0.0\" } }")
            .Write("src/Api/bin/Debug/Generado.cs", "app.MapGet(\"/generado\", () => 1);")
            .Write("src/Api/obj/Otro.cs", "app.MapGet(\"/obj\", () => 1);")
            .Write("src/Api/Api.csproj", "<Project Sdk=\"Microsoft.NET.Sdk.Web\" />");

        var result = project.Analyze();

        Assert.Equal(["service:Api"], result.Keys());
        Assert.DoesNotContain("react", result.TechnologyIds());
        Assert.DoesNotContain("clave-ficticia", result.Text(), StringComparison.Ordinal);
        var secrets = result.Manifest["limitations"]!.AsArray().Single(l => l!["code"]!.GetValue<string>() == "secret-excluded");
        Assert.StartsWith("Se excluyeron 4 archivos sensibles", secrets!["message"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.False(result.Partial); // excluir secretos es a propósito: no quita información de arquitectura
    }

    [Fact]
    public void Un_enlace_simbolico_no_saca_el_analisis_de_la_raiz()
    {
        using var project = new TempProject().Write("README.md", "#");
        var outside = Path.Combine(project.Parent, "fuera");
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "docker-compose.yml"), "services:\n  db:\n    image: postgres:17\n");
        try
        {
            Directory.CreateSymbolicLink(Path.Combine(project.Root, "enlace"), outside);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            return; // sin permiso para crear enlaces en esta plataforma
        }

        Assert.Empty(project.Analyze().Keys());
    }

    [Fact]
    public void Los_limites_cortan_el_analisis_y_lo_dicen()
    {
        using var project = new TempProject().Dotnet().Compose();

        var small = project.Analyze(o => o with { Limits = new AnalyzerLimits { MaxFileBytes = 200 } });
        var few = project.Analyze(o => o with { Limits = new AnalyzerLimits { MaxFiles = 3 } });
        var capped = project.Analyze(o => o with { Limits = new AnalyzerLimits { MaxEntities = 2 } });

        Assert.Contains("file-too-large", small.LimitationCodes());
        Assert.Contains("file-limit", few.LimitationCodes());
        Assert.Contains("entity-limit", capped.LimitationCodes());
        Assert.Equal(2, capped.Keys().Length);
        Assert.All(new[] { small, few, capped }, r => Assert.True(r.Partial));
    }

    [Fact]
    public void Escanear_dos_veces_el_mismo_arbol_da_el_mismo_paquete_byte_a_byte()
    {
        using var project = new TempProject().Dotnet().OpenApi().Compose();
        var first = Path.Combine(project.Parent, "primero.walkiepack");
        var second = Path.Combine(project.Parent, "segundo.walkiepack");

        ProjectAnalyzer.Write(project.Analyze(), first, new AnalyzerLimits());
        ProjectAnalyzer.Write(project.Analyze(), second, new AnalyzerLimits());

        Assert.Equal(File.ReadAllBytes(first), File.ReadAllBytes(second));
    }

    [Fact]
    public void Mover_lineas_o_renombrar_un_parametro_no_cambia_las_claves_y_el_fingerprint_dice_que_cambio()
    {
        using var project = new TempProject().Dotnet();
        var before = project.Analyze();

        var program = Path.Combine(project.Root, "src/Tienda.Api/Program.cs");
        File.WriteAllText(program, "// comentario nuevo\n\n" + File.ReadAllText(program).Replace("{pedidoId:guid}", "{id:guid}", StringComparison.Ordinal));
        var after = project.Analyze();

        Assert.Equal(before.Keys(), after.Keys());
        Assert.Equal(before.RelationKeys(), after.RelationKeys());
        var key = "api:GET /api/pedidos/{}";
        Assert.NotEqual(before.EntityOf(key)!["fingerprint"]!.GetValue<string>(), after.EntityOf(key)!["fingerprint"]!.GetValue<string>());
        Assert.Equal(before.EntityOf("api:POST /api/pedidos")!["fingerprint"]!.GetValue<string>(),
            after.EntityOf("api:POST /api/pedidos")!["fingerprint"]!.GetValue<string>()); // solo se movió de línea
    }

    [Fact]
    public void Renombrar_un_proyecto_cambia_su_clave_pero_deja_la_misma_ancla_para_reconocer_la_correspondencia()
    {
        using var project = new TempProject().Dotnet();
        var before = project.Analyze();
        File.Move(Path.Combine(project.Root, "src/Tienda.Api/Tienda.Api.csproj"), Path.Combine(project.Root, "src/Tienda.Api/Tienda.Gateway.csproj"));
        var after = project.Analyze();

        Assert.Contains("service:Tienda.Api", before.Keys());
        Assert.Contains("service:Tienda.Gateway", after.Keys());
        Assert.DoesNotContain("service:Tienda.Api", after.Keys());

        // La revisión puede proponer la correspondencia: la evidencia del nuevo está en la misma carpeta y con la misma
        // ancla; nunca se borra el anterior (ADR-0014: «ya no aparece» solo se marca).
        static string Anchor(AnalysisResult result, string key)
        {
            var id = result.EntityOf(key)!["evidence"]![0]!.GetValue<string>();
            var evidence = result.Discovery["evidence"]!.AsArray().Single(e => e!["id"]!.GetValue<string>() == id)!;
            return $"{Path.GetDirectoryName(evidence["path"]!.GetValue<string>())}#{evidence["symbol"]}";
        }

        Assert.Equal(Anchor(before, "service:Tienda.Api"), Anchor(after, "service:Tienda.Gateway"));
    }

    [Fact]
    public void La_fuente_se_crea_una_vez_y_se_reutiliza()
    {
        using var project = new TempProject().Write("README.md", "#");
        AnalyzerOptions Options(AnalyzerOptions o) => o with { SourceId = null, WriteSourceFile = true };

        var first = project.Analyze(Options);
        var second = project.Analyze(Options);

        Assert.True(first.SourceFileCreated);
        Assert.False(second.SourceFileCreated);
        Assert.Equal(first.SourceId, second.SourceId);
        Assert.Equal("Tienda demo", second.SourceName);
        var stored = JsonNode.Parse(File.ReadAllText(Path.Combine(project.Root, ".walkie", "source.json")))!;
        Assert.Equal(first.SourceId.ToString(), stored["id"]!.GetValue<string>());
        Assert.Empty(second.Keys()); // .walkie/ no se analiza
    }

    [Fact]
    public void Un_source_json_danado_es_un_error_accionable()
    {
        using var project = new TempProject().Write(".walkie/source.json", "{ \"id\": \"no-es-un-uuid\" }");

        var error = Assert.Throws<AnalyzerException>(() => project.Analyze(o => o with { SourceId = null }));

        Assert.Equal("invalid-source-file", error.Code);
        Assert.Contains(".walkie/source.json", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Sin_permiso_para_escribir_la_fuente_no_se_crea_nada_en_el_proyecto()
    {
        using var project = new TempProject().Write("README.md", "#");

        project.Analyze(o => o with { SourceId = null, WriteSourceFile = false });

        Assert.False(Directory.Exists(Path.Combine(project.Root, ".walkie")));
    }

    [Fact]
    public void Las_claves_las_referencias_y_el_orden_del_paquete_son_consistentes()
    {
        using var project = new TempProject().Dotnet().OpenApi().Compose();

        var result = project.Analyze();

        Assert.Empty(TempProject.Validate(result.Manifest, result.Discovery));
        var keys = result.Keys();
        Assert.Equal(keys.Order(StringComparer.Ordinal), keys);
        foreach (var api in result.Discovery["entities"]!.AsArray().Where(e => e!["kind"]!.GetValue<string>() == "api"))
        {
            Assert.Equal(DiscoveryKeys.Api(api!["http"]!["method"]!.GetValue<string>(), api["http"]!["path"]!.GetValue<string>()),
                api["key"]!.GetValue<string>());
        }
    }

    [Fact]
    public void El_analizador_no_lanza_procesos()
    {
        // Revisión del código fuente: ni Process ni ProcessStartInfo en el analizador ni en la CLI (ADR-0013).
        var sources = Directory.GetFiles(Path.Combine(RepoRoot(), "apps", "cli", "src"), "*.cs", SearchOption.AllDirectories);

        Assert.NotEmpty(sources);
        Assert.All(sources, file =>
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotContain("Process.Start", text, StringComparison.Ordinal);
            Assert.DoesNotContain("ProcessStartInfo", text, StringComparison.Ordinal);
            Assert.DoesNotContain("System.Diagnostics.Process", text, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void El_paquete_escrito_tiene_solo_el_manifest_y_el_discovery_y_cumple_el_contrato()
    {
        using var project = new TempProject().Dotnet();
        var path = Path.Combine(project.Parent, "salida con espacios.walkiepack");

        ProjectAnalyzer.Write(project.Analyze(), path, new AnalyzerLimits());
        var (manifest, discovery, entries) = TempProject.ReadPack(path);

        Assert.Equal([DiscoveryFormat.DiscoveryPath, DiscoveryFormat.ManifestPath], entries);
        Assert.Empty(TempProject.Validate(manifest, discovery));
        Assert.Equal(JsonSerializer.Serialize(FixedClock.Now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture)),
            manifest["generatedAt"]!.ToJsonString());
        Assert.False(manifest["includeSnippets"]!.GetValue<bool>());
        Assert.DoesNotContain(discovery["evidence"]!.AsArray(), e => e!["snippet"] is not null);
        Assert.DoesNotContain(discovery["evidence"]!.AsArray(), e => Path.IsPathRooted(e!["path"]!.GetValue<string>()));
    }

    [Fact]
    public void Un_paquete_mas_grande_que_el_limite_no_se_escribe()
    {
        using var project = new TempProject().Dotnet();
        var path = Path.Combine(project.Parent, "grande.walkiepack");

        var error = Assert.Throws<AnalyzerException>(() => ProjectAnalyzer.Write(project.Analyze(), path, new AnalyzerLimits { MaxPackBytes = 100 }));

        Assert.Equal("pack-too-large", error.Code);
        Assert.False(File.Exists(path));
    }

    internal static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("No se encontró la raíz del repo (global.json).");
    }
}
