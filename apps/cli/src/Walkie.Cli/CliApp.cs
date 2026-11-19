using System.Globalization;
using System.Text.Json.Nodes;
using Walkie.Analyzer;

namespace Walkie.Cli;

/// <summary>
/// CLI de Walkie Live (spec walkie-live): <c>walkie scan [carpeta]</c> analiza un proyecto local sin ejecutar nada y
/// escribe un <c>.walkiepack</c>. Códigos de salida: 0 bien (también parcial), 2 uso incorrecto, 3 algo que la persona
/// puede corregir (carpeta, <c>.walkie/source.json</c>, salida), 4 el paquete no se pudo generar (tamaño o error del
/// analizador), 1 error inesperado.
/// </summary>
public static class CliApp
{
    public const int Ok = 0;
    public const int Unexpected = 1;
    public const int Usage = 2;
    public const int InputError = 3;
    public const int PackError = 4;

    /// <summary>Nombre del paquete si no se da <c>--output</c>.</summary>
    public const string DefaultOutput = "architecture.walkiepack";

    public static string Help { get; } = $"""
        walkie {ProjectAnalyzer.Version} — Walkie Live: analiza un proyecto local y genera un .walkiepack para importarlo en Walkie.

        Uso:
          walkie scan [carpeta] [opciones]   Analiza la carpeta (por defecto, la actual) y escribe el paquete.
          walkie --version                   Muestra la versión.
          walkie --help                      Muestra esta ayuda.

        Opciones de scan:
          -o, --output <archivo>   Dónde escribir el paquete (por defecto, ./{DefaultOutput}).
              --name <nombre>      Nombre de la fuente (por defecto, el guardado o el de la carpeta).
              --source-id <uuid>   Id de la fuente; no lee ni escribe .walkie/source.json.
              --no-source-file     No crear .walkie/source.json (el id cambiará en cada análisis).
              --detectors <lista>  Solo estos detectores, separados por coma: {string.Join(", ", ProjectAnalyzer.DetectorIds)}.
                                   Los demás quedan sin correr y el análisis, parcial.
              --max-files <n>      Máximo de archivos a recorrer (por defecto, 20000).
          -q, --quiet              Solo errores y la ruta del paquete.

        Qué hace y qué no:
          Solo lee archivos: no compila, no instala dependencias, no ejecuta scripts, builds ni contenedores.
          Excluye dependencias, salidas de compilación y archivos sensibles (.env, claves, certificados, appsettings).
          La evidencia lleva ruta relativa, ancla y líneas, sin fragmentos de código.
          Lo único que escribe en el proyecto es .walkie/source.json, con el id de la fuente.
        """;

    public static int Run(string[] args, TextWriter output, TextWriter error, TimeProvider? clock = null)
    {
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(error);
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            output.WriteLine(Help);
            return args.Length == 0 ? Usage : Ok;
        }

        if (args[0] is "--version" or "-v")
        {
            output.WriteLine(ProjectAnalyzer.Version);
            return Ok;
        }

        if (args[0] != "scan")
        {
            error.WriteLine($"Comando desconocido «{args[0]}». Usa «walkie scan [carpeta]» o «walkie --help».");
            return Usage;
        }

        if (!TryParse(args[1..], out var scan, out var problem))
        {
            error.WriteLine(problem);
            error.WriteLine("Usa «walkie --help» para ver las opciones.");
            return Usage;
        }

        if (scan.Help)
        {
            output.WriteLine(Help);
            return Ok;
        }

        return Scan(scan, output, error, clock ?? TimeProvider.System);
    }

    private static int Scan(ScanArguments scan, TextWriter output, TextWriter error, TimeProvider clock)
    {
        var limits = new AnalyzerLimits { MaxFiles = scan.MaxFiles ?? new AnalyzerLimits().MaxFiles };
        var options = new AnalyzerOptions
        {
            Root = scan.Root,
            Name = scan.Name,
            SourceId = scan.SourceId,
            WriteSourceFile = !scan.NoSourceFile,
            Detectors = scan.Detectors,
            Limits = limits,
            Clock = clock,
        };
        var outputPath = Path.GetFullPath(scan.Output);
        var started = clock.GetTimestamp();
        try
        {
            var result = ProjectAnalyzer.Analyze(options);
            var bytes = ProjectAnalyzer.Write(result, outputPath, limits);
            if (scan.Quiet)
            {
                output.WriteLine(outputPath);
            }
            else
            {
                Summary(result, outputPath, bytes, clock.GetElapsedTime(started), scan, output);
            }

            return Ok;
        }
        catch (AnalyzerException ex)
        {
            error.WriteLine($"Error: {ex.Message}");
            foreach (var (path, messages) in ex.Errors.OrderBy(e => e.Key, StringComparer.Ordinal).Take(20))
            {
                error.WriteLine($"  {path}: {string.Join(" ", messages)}");
            }

            return ex.Code is "invalid-pack" or "pack-too-large" ? PackError : InputError;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            error.WriteLine($"Error: no se pudo leer o escribir ({ex.Message}). Revisa los permisos de la carpeta y de la salida.");
            return InputError;
        }
    }

    private static void Summary(AnalysisResult result, string outputPath, long bytes, TimeSpan elapsed, ScanArguments scan, TextWriter output)
    {
        var culture = CultureInfo.InvariantCulture;
        var manifest = result.Manifest;
        var entities = result.Discovery["entities"]!.AsArray();
        output.WriteLine(string.Create(culture,
            $"Walkie analizó «{result.SourceName}»: {result.FilesInScope} archivos en el alcance, {manifest["stats"]!["files"]} leídos, en {elapsed.TotalSeconds:0.0} s."));

        var technologies = manifest["technologies"]!.AsArray()
            .Select(t => t!["version"] is { } v ? $"{t["name"]} {v}" : t!["name"]!.GetValue<string>())
            .ToList();
        output.WriteLine(technologies.Count == 0 ? "Tecnologías: ninguna reconocida." : $"Tecnologías: {string.Join(", ", technologies)}.");

        if (entities.Count == 0)
        {
            output.WriteLine("Componentes: ninguno. Ningún detector reconoció APIs, servicios, bases, recursos ni módulos.");
        }
        else
        {
            output.WriteLine("Componentes:");
            foreach (var group in entities.GroupBy(e => e!["kind"]!.GetValue<string>()).OrderBy(g => g.Key, StringComparer.Ordinal))
            {
                var observed = group.Count(e => e!["basis"]!.GetValue<string>() == "observed");
                output.WriteLine(string.Create(culture,
                    $"  {group.Key,-9} {group.Count(),5}  ({observed} observados, {group.Count() - observed} inferidos)"));
            }
        }

        output.WriteLine(string.Create(culture,
            $"Relaciones: {manifest["stats"]!["relations"]}. Evidencias: {manifest["stats"]!["evidence"]}."));
        output.WriteLine("Detectores: " + string.Join(", ", result.Detectors.Select(d => d.Status == "ran" ? d.Id : $"{d.Id} ({d.Status})")) + ".");

        var limitations = manifest["limitations"]!.AsArray();
        if (result.Partial)
        {
            output.WriteLine("Análisis parcial: hay cosas que no se pudieron mirar o resolver (abajo). Walkie no dará por desaparecido lo que no se miró.");
        }

        if (limitations.Count > 0)
        {
            output.WriteLine("Limitaciones:");
            foreach (var limitation in limitations.Take(15))
            {
                var path = limitation!["path"] is { } p ? $" {p}:" : "";
                output.WriteLine($"  [{limitation["code"]}]{path} {limitation["message"]}");
            }

            if (limitations.Count > 15)
            {
                output.WriteLine(string.Create(culture, $"  … y {limitations.Count - 15} más (en manifest.json del paquete)."));
            }
        }

        if (result.SourceFileCreated)
        {
            output.WriteLine($"Fuente nueva: se creó .walkie/source.json con el id {result.SourceId} (versiónalo: así Walkie reconoce los análisis siguientes).");
        }
        else if (scan.NoSourceFile && scan.SourceId is null)
        {
            output.WriteLine("Aviso: sin .walkie/source.json el id de la fuente es nuevo en cada análisis y Walkie no los relaciona.");
        }

        output.WriteLine(string.Create(culture, $"Paquete: {outputPath} ({Math.Max(1, bytes / 1024)} KB)."));
    }

    internal sealed record ScanArguments
    {
        public string Root { get; init; } = ".";

        public string Output { get; init; } = DefaultOutput;

        public string? Name { get; init; }

        public Guid? SourceId { get; init; }

        public bool NoSourceFile { get; init; }

        public IReadOnlySet<string>? Detectors { get; init; }

        public int? MaxFiles { get; init; }

        public bool Quiet { get; init; }

        public bool Help { get; init; }
    }

    internal static bool TryParse(string[] args, out ScanArguments scan, out string problem)
    {
        scan = new ScanArguments();
        problem = "";
        string? root = null;
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];

            switch (arg)
            {
                case "-h" or "--help":
                    scan = scan with { Help = true };
                    break;
                case "-o" or "--output":
                    if (Value(args, ref i, arg, out problem) is not { } output)
                    {
                        return false;
                    }

                    scan = scan with { Output = Path.HasExtension(output) ? output : output + ".walkiepack" };
                    break;
                case "--name":
                    if (Value(args, ref i, arg, out problem) is not { } name)
                    {
                        return false;
                    }

                    scan = scan with { Name = name };
                    break;
                case "--source-id":
                    if (Value(args, ref i, arg, out problem) is not { } id)
                    {
                        return false;
                    }

                    if (!Guid.TryParse(id, out var sourceId))
                    {
                        problem = $"--source-id tiene que ser un UUID (recibido «{id}»).";
                        return false;
                    }

                    scan = scan with { SourceId = sourceId };
                    break;
                case "--no-source-file":
                    scan = scan with { NoSourceFile = true };
                    break;
                case "--detectors":
                    if (Value(args, ref i, arg, out problem) is not { } list)
                    {
                        return false;
                    }

                    var detectors = list.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet(StringComparer.Ordinal);
                    if (detectors.FirstOrDefault(d => !ProjectAnalyzer.DetectorIds.Contains(d)) is { } unknown)
                    {
                        problem = $"No hay un detector «{unknown}». Disponibles: {string.Join(", ", ProjectAnalyzer.DetectorIds)}.";
                        return false;
                    }

                    scan = scan with { Detectors = detectors };
                    break;
                case "--max-files":
                    if (Value(args, ref i, arg, out problem) is not { } max)
                    {
                        return false;
                    }

                    if (!int.TryParse(max, NumberStyles.None, CultureInfo.InvariantCulture, out var maxFiles) || maxFiles < 1)
                    {
                        problem = $"--max-files tiene que ser un entero positivo (recibido «{max}»).";
                        return false;
                    }

                    scan = scan with { MaxFiles = maxFiles };
                    break;
                case "-q" or "--quiet":
                    scan = scan with { Quiet = true };
                    break;
                default:
                    if (arg.StartsWith('-'))
                    {
                        problem = $"Opción desconocida «{arg}».";
                        return false;
                    }

                    if (root is not null)
                    {
                        problem = $"Solo se analiza una carpeta a la vez (recibidas «{root}» y «{arg}»).";
                        return false;
                    }

                    root = arg;
                    scan = scan with { Root = arg };
                    break;
            }
        }

        return true;
    }

    /// <summary>Valor de una opción (el argumento siguiente); null si falta.</summary>
    private static string? Value(string[] args, ref int index, string option, out string message)
    {
        message = "";
        if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
        {
            message = $"Falta el valor de {option}.";
            return null;
        }

        return args[++index];
    }
}
