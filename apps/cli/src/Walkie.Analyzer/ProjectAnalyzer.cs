using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Walkie.Analyzer.Detectors;
using Walkie.Shared;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer;

/// <summary>Un error que la persona puede resolver (carpeta que no existe, <c>.walkie/source.json</c> dañado…).</summary>
public sealed class AnalyzerException(string code, string message, IReadOnlyDictionary<string, string[]>? errors = null)
    : Exception(message)
{
    public string Code { get; } = code;

    public IReadOnlyDictionary<string, string[]> Errors { get; } = errors ?? new Dictionary<string, string[]>();
}

/// <summary>Estado de un detector en un análisis.</summary>
public sealed record DetectorRun(string Id, string Status, string? Reason);

/// <summary>Resultado de un análisis: el paquete (ya validado contra el contrato) y lo que muestra el resumen.</summary>
public sealed record AnalysisResult(
    JsonObject Manifest,
    JsonObject Discovery,
    string SourceName,
    Guid SourceId,
    bool SourceFileCreated,
    int FilesInScope,
    IReadOnlyList<DetectorRun> Detectors)
{
    public bool Partial => Manifest["completeness"]!.GetValue<string>() == "partial";
}

/// <summary>
/// Analizador de Walkie Live (spec walkie-live, ADR-0013 y ADR-0014): recorre el proyecto, corre los detectores y arma
/// un <c>.walkiepack</c> que cumple el contrato de <c>Walkie.Shared/Discovery</c>. Análisis estático: no lanza
/// procesos, no compila, no instala ni ejecuta nada del proyecto. Lo único que escribe dentro del proyecto es
/// <c>.walkie/source.json</c> (el id de la fuente), y solo si se permite.
/// </summary>
public static partial class ProjectAnalyzer
{
    /// <summary>Nombre del analizador en el manifest.</summary>
    public const string Name = "walkie-cli";

    /// <summary>Versión del analizador (la del ensamblado), también la de cada detector.</summary>
    public static string Version { get; } =
        typeof(ProjectAnalyzer).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? "0.0.0";

    /// <summary>Detectores en orden de ejecución: OpenAPI antes que el código, así su contrato es el que queda.</summary>
    public static IReadOnlyList<IDetector> CreateDetectors() =>
    [
        new CsprojDetector(),
        new PackageJsonDetector(),
        new ComposeDetector(),
        new OpenApiDetector(),
        new AspNetCoreEndpointsDetector(),
        new EfCoreDetector(),
    ];

    /// <summary>Ids de los detectores disponibles.</summary>
    public static IReadOnlyList<string> DetectorIds { get; } = CreateDetectors().Select(d => d.Id).ToList();

    public static AnalysisResult Analyze(AnalyzerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var root = Path.GetFullPath(options.Root);
        if (!Directory.Exists(root))
        {
            throw new AnalyzerException("root-not-found", $"No existe la carpeta {root}.");
        }

        if (options.Detectors?.FirstOrDefault(d => !DetectorIds.Contains(d)) is { } unknown)
        {
            throw new AnalyzerException("unknown-detector",
                $"No hay un detector «{unknown}». Disponibles: {string.Join(", ", DetectorIds)}.");
        }

        var generatedAt = options.Clock.GetUtcNow();
        var (sourceId, sourceName, created) = SourceIdentity.Resolve(root, options);

        var listing = SourceFiles.List(root, options.Limits.MaxFiles);
        var findings = new Findings(options.Limits);
        if (listing.SensitiveExcluded > 0)
        {
            findings.Limitation("secret-excluded", string.Create(CultureInfo.InvariantCulture,
                $"Se excluyeron {listing.SensitiveExcluded} archivos sensibles (variables de entorno, claves, certificados, appsettings…): no se leyeron."),
                incomplete: false);
        }

        if (listing.LimitReached)
        {
            findings.Limitation("file-limit", string.Create(CultureInfo.InvariantCulture,
                $"Se alcanzó el límite de {options.Limits.MaxFiles} archivos: el resto del proyecto no se miró."));
        }

        var context = new AnalysisContext(root, listing.Files, findings, options.Limits);
        var runs = new List<DetectorRun>();
        var detectors = CreateDetectors();
        foreach (var detector in detectors)
        {
            if (options.Detectors is not null && !options.Detectors.Contains(detector.Id))
            {
                runs.Add(new DetectorRun(detector.Id, "skipped", "No se pidió (--detectors)."));
                continue;
            }

            try
            {
                detector.Run(context);
                runs.Add(new DetectorRun(detector.Id, "ran", null));
            }
#pragma warning disable CA1031 // un detector que falla no tumba el análisis: queda failed y el paquete, parcial
            catch (Exception ex) when (ex is not OutOfMemoryException)
#pragma warning restore CA1031
            {
                runs.Add(new DetectorRun(detector.Id, "failed", $"Error inesperado ({ex.GetType().Name}); lo encontrado antes se conserva."));
            }
        }

        if (runs.Any(r => r.Id == "csproj" && r.Status == "ran"))
        {
            CsprojDetector.LinkProjects(context);
        }

        var discovery = findings.DiscoveryJson();
        var complete = runs.All(r => r.Status == "ran") && !findings.Incomplete;
        var manifest = Manifest(generatedAt, sourceId, sourceName, GitInfo.Read(root), detectors, runs, complete, findings, discovery, context.FilesRead);

        var errors = DiscoveryPackValidator.Validate(JsonSerializer.SerializeToElement(manifest), JsonSerializer.SerializeToElement(discovery));
        if (errors.Count > 0)
        {
            throw new AnalyzerException("invalid-pack",
                "El paquete generado no cumple el contrato de Walkie (es un error del analizador; repórtalo con este detalle).", errors);
        }

        return new AnalysisResult(manifest, discovery, sourceName, sourceId, created, listing.Files.Count, runs);
    }

    private static JsonObject Manifest(DateTimeOffset generatedAt, Guid sourceId, string sourceName, JsonObject? vcs,
        IReadOnlyList<IDetector> detectors, List<DetectorRun> runs, bool complete, Findings findings, JsonObject discovery, int filesRead)
    {
        var manifest = new JsonObject
        {
            ["format"] = DiscoveryFormat.Name,
            ["formatVersion"] = DiscoveryFormat.CurrentVersion,
            ["schemaVersion"] = WalkieInfo.SchemaVersion,
            ["generatedAt"] = generatedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            ["analyzer"] = new JsonObject { ["name"] = Name, ["version"] = Version },
            ["source"] = new JsonObject { ["id"] = sourceId.ToString(), ["name"] = sourceName },
        };
        if (vcs is not null)
        {
            manifest["vcs"] = vcs;
        }

        manifest["detectors"] = new JsonArray([.. detectors.Select(d =>
        {
            var run = runs.Single(r => r.Id == d.Id);
            var item = new JsonObject { ["id"] = d.Id, ["version"] = Version, ["status"] = run.Status };
            if (run.Reason is not null)
            {
                item["reason"] = run.Reason;
            }

            item["produces"] = new JsonObject
            {
                ["entities"] = new JsonArray([.. d.Entities.Select(e => (JsonNode)e)]),
                ["relations"] = new JsonArray([.. d.Relations.Select(r => (JsonNode)r)]),
            };
            return (JsonNode)item;
        })]);
        manifest["scope"] = new JsonObject
        {
            ["include"] = new JsonArray("**/*"),
            ["exclude"] = new JsonArray([.. SourceFiles.ExcludeGlobs.Select(g => (JsonNode)g)]),
        };
        manifest["completeness"] = complete ? "complete" : "partial";
        manifest["technologies"] = findings.TechnologiesJson();
        manifest["limitations"] = findings.LimitationsJson();
        manifest["stats"] = new JsonObject
        {
            ["files"] = filesRead,
            ["entities"] = discovery["entities"]!.AsArray().Count,
            ["relations"] = discovery["relations"]!.AsArray().Count,
            ["evidence"] = discovery["evidence"]!.AsArray().Count,
        };
        manifest["includeSnippets"] = false;
        return manifest;
    }

    /// <summary>JSON del paquete: con sangría, saltos <c>\n</c> y acentos sin escapar (el mismo texto en cualquier sistema).</summary>
    public static JsonSerializerOptions JsonOptions { get; } = new()
    {
        WriteIndented = true,
        NewLine = "\n",
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// Escribe el <c>.walkiepack</c> (zip con <c>manifest.json</c> y <c>discovery.json</c>): primero en memoria para
    /// comprobar el tamaño, después a un archivo temporal junto al destino y al final lo mueve, así nunca queda un
    /// paquete a medias. Fechas de las entradas = <c>generatedAt</c>: el mismo análisis da el mismo archivo.
    /// </summary>
    public static long Write(AnalysisResult result, string outputPath, AnalyzerLimits limits)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(limits);
        var generatedAt = DateTimeOffset.Parse(result.Manifest["generatedAt"]!.GetValue<string>(), CultureInfo.InvariantCulture);
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Entry(zip, DiscoveryFormat.ManifestPath, result.Manifest, generatedAt);
            Entry(zip, DiscoveryFormat.DiscoveryPath, result.Discovery, generatedAt);
        }

        if (buffer.Length > limits.MaxPackBytes)
        {
            throw new AnalyzerException("pack-too-large", string.Create(CultureInfo.InvariantCulture,
                $"El paquete pesa {buffer.Length / (1024 * 1024)} MB y el máximo es {limits.MaxPackBytes / (1024 * 1024)} MB: analiza una carpeta más chica o con --detectors."));
        }

        var target = Path.GetFullPath(outputPath);
        var directory = Path.GetDirectoryName(target)!;
        if (!Directory.Exists(directory))
        {
            throw new AnalyzerException("output-dir-not-found", $"No existe la carpeta de salida {directory}.");
        }

        var temporary = Path.Combine(directory, $".{Path.GetFileName(target)}.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllBytes(temporary, buffer.ToArray());
            File.Move(temporary, target, overwrite: true);
        }
        finally
        {
            File.Delete(temporary);
        }

        return buffer.Length;
    }

    private static void Entry(ZipArchive zip, string name, JsonObject content, DateTimeOffset modified)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        entry.LastWriteTime = modified.Year < 1980 ? new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero) : modified;
        using var stream = entry.Open();
        var bytes = Encoding.UTF8.GetBytes(content.ToJsonString(JsonOptions) + "\n");
        stream.Write(bytes);
    }
}

/// <summary>
/// Id estable de la fuente (ADR-0014): <c>.walkie/source.json</c> en la raíz del proyecto, que se crea la primera vez.
/// Así reanalizar el mismo proyecto apunta a la misma fuente en Walkie.
/// </summary>
internal static class SourceIdentity
{
    public const string FilePath = ".walkie/source.json";

    public static (Guid Id, string Name, bool Created) Resolve(string root, AnalyzerOptions options)
    {
        var folder = Clean(Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)));
        if (options.SourceId is { } given)
        {
            return (given, Clean(options.Name) ?? folder ?? "proyecto", false);
        }

        var file = Path.Combine(root, ".walkie", "source.json");
        if (File.Exists(file))
        {
            try
            {
                var stored = JsonNode.Parse(File.ReadAllText(file));
                if (stored?["id"]?.GetValue<string>() is { } text && Guid.TryParse(text, out var id))
                {
                    return (id, Clean(options.Name) ?? Clean(stored["name"]?.GetValue<string>()) ?? folder ?? "proyecto", false);
                }
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                // cae al error de abajo
            }

            throw new AnalyzerException("invalid-source-file",
                $"{FilePath} no tiene un id válido. Corrígelo o bórralo para crear una fuente nueva (perderá la relación con los análisis anteriores en Walkie).");
        }

        var name = Clean(options.Name) ?? folder ?? "proyecto";
        var newId = Guid.CreateVersion7(options.Clock.GetUtcNow());
        if (!options.WriteSourceFile)
        {
            return (newId, name, false);
        }

        Directory.CreateDirectory(Path.Combine(root, ".walkie"));
        File.WriteAllText(file, new JsonObject { ["id"] = newId.ToString(), ["name"] = name }.ToJsonString(ProjectAnalyzer.JsonOptions) + "\n");
        return (newId, name, true);
    }

    private static string? Clean(string? name)
    {
        var trimmed = name?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : Text.Truncate(trimmed, 120);
    }
}

/// <summary>
/// Commit y rama leídos de los archivos de <c>.git</c> (de la raíz hacia arriba), sin ejecutar git. Si algo no se
/// entiende, no hay <c>vcs</c>: no es un error.
/// </summary>
internal static partial class GitInfo
{
    public static JsonObject? Read(string root)
    {
        for (var dir = new DirectoryInfo(root); dir is not null; dir = dir.Parent)
        {
            var dotGit = Path.Combine(dir.FullName, ".git");
            var gitDir = Directory.Exists(dotGit) ? dotGit
                : File.Exists(dotGit) && File.ReadAllText(dotGit).Trim() is var pointer && pointer.StartsWith("gitdir:", StringComparison.Ordinal)
                    ? Path.GetFullPath(Path.Combine(dir.FullName, pointer["gitdir:".Length..].Trim()))
                    : null;
            if (gitDir is not null)
            {
                return FromGitDir(gitDir);
            }
        }

        return null;
    }

    private static JsonObject? FromGitDir(string gitDir)
    {
        try
        {
            var head = File.ReadAllText(Path.Combine(gitDir, "HEAD")).Trim();
            string? branch = null;
            string? commit;
            if (head.StartsWith("ref: ", StringComparison.Ordinal))
            {
                var reference = head[5..].Trim();
                branch = reference.StartsWith("refs/heads/", StringComparison.Ordinal) ? reference["refs/heads/".Length..] : null;
                var common = File.Exists(Path.Combine(gitDir, "commondir"))
                    ? Path.GetFullPath(Path.Combine(gitDir, File.ReadAllText(Path.Combine(gitDir, "commondir")).Trim()))
                    : gitDir;
                var loose = Path.Combine(common, reference.Replace('/', Path.DirectorySeparatorChar));
                commit = File.Exists(loose)
                    ? File.ReadAllText(loose).Trim()
                    : File.Exists(Path.Combine(common, "packed-refs"))
                        ? File.ReadLines(Path.Combine(common, "packed-refs"))
                            .Select(l => l.Split(' '))
                            .FirstOrDefault(p => p.Length == 2 && p[1] == reference)?[0]
                        : null;
            }
            else
            {
                commit = head;
            }

            if (commit is null || !Commit().IsMatch(commit))
            {
                return null;
            }

            var vcs = new JsonObject { ["kind"] = "git", ["commit"] = commit };
            if (branch is not null && branch.Length <= 255)
            {
                vcs["branch"] = branch;
            }

            return vcs;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    [GeneratedRegex("^[0-9a-f]{7,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Commit();
}
