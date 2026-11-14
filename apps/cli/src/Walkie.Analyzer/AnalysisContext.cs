using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Walkie.Analyzer;

/// <summary>Un detector: lee archivos del alcance y suma hallazgos. Nunca ejecuta nada.</summary>
public interface IDetector
{
    /// <summary>Id del manifest (ej. <c>csproj</c>).</summary>
    string Id { get; }

    /// <summary>Tipos de entidad que puede producir (capacidad declarada en el manifest).</summary>
    IReadOnlyList<string> Entities { get; }

    /// <summary>Tipos de relación que puede producir.</summary>
    IReadOnlyList<string> Relations { get; }

    void Run(AnalysisContext context);
}

/// <summary>Un proyecto .NET (<c>.csproj</c>) del alcance.</summary>
public sealed record DotnetProject(
    string Name,
    string Path,
    string Directory,
    DotnetProjectRole Role,
    IReadOnlyList<(string Path, Lines Lines)> References,
    string EvidenceId)
{
    /// <summary>Clave de la entidad si el proyecto es un servicio.</summary>
    public string ServiceKey => Walkie.Shared.Discovery.DiscoveryKeys.Service(Name);

    /// <summary>Clave de la entidad si el proyecto es un candidato a módulo.</summary>
    public string ModuleKey => Walkie.Shared.Discovery.DiscoveryKeys.Module(Name);
}

public enum DotnetProjectRole
{
    /// <summary>SDK web o worker: corre por sí mismo.</summary>
    Service,

    /// <summary>Biblioteca: candidata a módulo si expone endpoints o datos.</summary>
    Library,

    /// <summary>Aplicación de consola o herramienta: no es parte de la arquitectura en ejecución.</summary>
    Tool,

    /// <summary>Pruebas: se ignoran sus endpoints y datos.</summary>
    Test,
}

/// <summary>Lo que comparten los detectores de un análisis.</summary>
public sealed class AnalysisContext(string root, IReadOnlyList<SourceFile> files, Findings findings, AnalyzerLimits limits)
{
    private readonly Dictionary<string, SyntaxTree?> trees = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string?> texts = new(StringComparer.Ordinal);

    public string Root { get; } = root;

    public IReadOnlyList<SourceFile> Files { get; } = files;

    public Findings Findings { get; } = findings;

    /// <summary>Proyectos .NET que encontró el detector <c>csproj</c> (vacío si no corrió).</summary>
    public List<DotnetProject> Projects { get; } = [];

    /// <summary>Archivos distintos leídos por algún detector (cada uno se lee una sola vez).</summary>
    public int FilesRead => texts.Values.Count(t => t is not null);

    /// <summary>
    /// Texto de un archivo del alcance, o null si supera el tamaño máximo o no se puede leer (queda como limitación
    /// del detector). Solo lee rutas del listado: nada fuera de la raíz ni archivos sensibles.
    /// </summary>
    public string? Read(SourceFile file, string detector)
    {
        if (texts.TryGetValue(file.Path, out var cached))
        {
            return cached;
        }

        var text = ReadOnce(file, detector);
        texts[file.Path] = text;
        return text;
    }

    private string? ReadOnce(SourceFile file, string detector)
    {
        if (file.Length > limits.MaxFileBytes)
        {
            Findings.Limitation("file-too-large",
                $"No se leyó: pesa más de {limits.MaxFileBytes / 1024} KB.", detector, file.Path);
            return null;
        }

        try
        {
            return File.ReadAllText(System.IO.Path.Combine(Root, file.Path), Encoding.UTF8);
        }
        catch (IOException ex)
        {
            Findings.Limitation("unreadable-file", $"No se pudo leer: {ex.GetType().Name}.", detector, file.Path);
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            Findings.Limitation("unreadable-file", "Sin permiso de lectura.", detector, file.Path);
            return null;
        }
    }

    /// <summary>Árbol sintáctico de Roslyn de un <c>.cs</c>, parseado una sola vez para todos los detectores.</summary>
    public SyntaxTree? CSharp(SourceFile file, string detector)
    {
        if (trees.TryGetValue(file.Path, out var cached))
        {
            return cached;
        }

        var text = Read(file, detector);
        var tree = text is null ? null : CSharpSyntaxTree.ParseText(text, path: file.Path);
        if (tree is not null && tree.GetDiagnostics().Any(d => d.Severity == DiagnosticSeverity.Error))
        {
            Findings.Limitation("unparsed-file",
                "Tiene errores de sintaxis: lo encontrado en este archivo puede estar incompleto.", detector, file.Path);
        }

        trees[file.Path] = tree;
        return tree;
    }

    /// <summary>El proyecto .NET más cercano que contiene a <paramref name="path"/>, o null.</summary>
    public DotnetProject? ProjectOf(string path) =>
        Projects
            .Where(p => p.Directory.Length == 0 || path.StartsWith(p.Directory + "/", StringComparison.Ordinal))
            .OrderByDescending(p => p.Directory.Length)
            .FirstOrDefault();
}
