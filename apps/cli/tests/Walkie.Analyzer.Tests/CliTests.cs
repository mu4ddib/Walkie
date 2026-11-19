using Walkie.Cli;

namespace Walkie.Analyzer.Tests;

/// <summary>Experiencia de la CLI: ayuda, errores accionables, códigos de salida, resumen y exportación.</summary>
public sealed class CliTests
{
    [Fact]
    public void La_ayuda_explica_el_comando_y_lo_que_no_hace()
    {
        var (code, output, _) = Run("--help");

        Assert.Equal(CliApp.Ok, code);
        Assert.Contains("walkie scan [carpeta]", output, StringComparison.Ordinal);
        Assert.Contains("no compila, no instala dependencias", output, StringComparison.Ordinal);
        Assert.Contains("csproj, package-json, compose, openapi, aspnetcore-endpoints, efcore", output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(new string[0], CliApp.Usage, "")]
    [InlineData(new[] { "analizar" }, CliApp.Usage, "Comando desconocido «analizar»")]
    [InlineData(new[] { "scan", "--formato", "x" }, CliApp.Usage, "Opción desconocida «--formato»")]
    [InlineData(new[] { "scan", "--output" }, CliApp.Usage, "Falta el valor de --output")]
    [InlineData(new[] { "scan", "--source-id", "abc" }, CliApp.Usage, "--source-id tiene que ser un UUID")]
    [InlineData(new[] { "scan", "--detectors", "compose,cobol" }, CliApp.Usage, "No hay un detector «cobol»")]
    [InlineData(new[] { "scan", "--max-files", "0" }, CliApp.Usage, "--max-files tiene que ser un entero positivo")]
    [InlineData(new[] { "scan", "a", "b" }, CliApp.Usage, "Solo se analiza una carpeta a la vez")]
    [InlineData(new[] { "scan", "/no/existe/esta/carpeta" }, CliApp.InputError, "No existe la carpeta")]
    public void Un_uso_incorrecto_da_un_error_accionable_y_su_codigo(string[] args, int expected, string message)
    {
        var (code, _, error) = Run(args);

        Assert.Equal(expected, code);
        Assert.Contains(message, error, StringComparison.Ordinal);
    }

    [Fact]
    public void Scan_escribe_el_paquete_y_muestra_el_resumen()
    {
        using var project = new TempProject().Dotnet().Compose();
        var output = Path.Combine(project.Parent, "salida", "arquitectura de la tienda.walkiepack");
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);

        var (code, text, _) = Run("scan", project.Root, "-o", output, "--source-id", TempProject.SourceId.ToString());

        Assert.Equal(CliApp.Ok, code);
        Assert.True(File.Exists(output));
        Assert.Contains("Walkie analizó «Tienda demo»", text, StringComparison.Ordinal);
        Assert.Contains("Tecnologías: ", text, StringComparison.Ordinal);
        Assert.Contains("api ", text, StringComparison.Ordinal);
        Assert.Contains("Análisis parcial", text, StringComparison.Ordinal); // la ruta dinámica y la dependencia desconocida
        Assert.Contains("[dynamic-route]", text, StringComparison.Ordinal);
        Assert.Contains($"Paquete: {output}", text, StringComparison.Ordinal);
        var (manifest, discovery, _) = TempProject.ReadPack(output);
        Assert.Empty(TempProject.Validate(manifest, discovery));
    }

    [Fact]
    public void Scan_sin_salida_escribe_architecture_walkiepack_en_la_carpeta_actual_y_crea_la_fuente()
    {
        using var project = new TempProject().Write("compose.yaml", "services:\n  db:\n    image: postgres:17\n");
        var previous = Environment.CurrentDirectory;
        Environment.CurrentDirectory = project.Parent;
        try
        {
            var (code, text, _) = Run("scan", "Tienda demo");

            Assert.Equal(CliApp.Ok, code);
            Assert.True(File.Exists(Path.Combine(project.Parent, CliApp.DefaultOutput)));
            Assert.True(File.Exists(Path.Combine(project.Root, ".walkie", "source.json")));
            Assert.Contains("Fuente nueva: se creó .walkie/source.json", text, StringComparison.Ordinal);
        }
        finally
        {
            Environment.CurrentDirectory = previous;
        }
    }

    [Fact]
    public void Quiet_solo_imprime_la_ruta_del_paquete()
    {
        using var project = new TempProject().Write("README.md", "#");
        var output = Path.Combine(project.Parent, "x.walkiepack");

        var (code, text, _) = Run("scan", project.Root, "-o", output, "-q", "--no-source-file");

        Assert.Equal(CliApp.Ok, code);
        Assert.Equal(output, text.Trim());
    }

    [Fact]
    public void Un_repositorio_vacio_lo_dice_en_el_resumen()
    {
        using var project = new TempProject().Write("README.md", "#");

        var (code, text, _) = Run("scan", project.Root, "-o", Path.Combine(project.Parent, "x"), "--no-source-file");

        Assert.Equal(CliApp.Ok, code);
        Assert.Contains("Componentes: ninguno", text, StringComparison.Ordinal);
        Assert.Contains("Tecnologías: ninguna reconocida", text, StringComparison.Ordinal);
        Assert.True(File.Exists(Path.Combine(project.Parent, "x.walkiepack"))); // sin extensión, se agrega
        Assert.Contains("Aviso: sin .walkie/source.json", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Una_carpeta_de_salida_inexistente_es_un_error_de_entrada()
    {
        using var project = new TempProject().Write("README.md", "#");

        var (code, _, error) = Run("scan", project.Root, "-o", Path.Combine(project.Parent, "no", "existe.walkiepack"), "--no-source-file");

        Assert.Equal(CliApp.InputError, code);
        Assert.Contains("No existe la carpeta de salida", error, StringComparison.Ordinal);
    }

    private static (int Code, string Output, string Error) Run(params string[] args)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();
        var code = CliApp.Run(args, output, error, new FixedClock());
        return (code, output.ToString(), error.ToString());
    }
}
