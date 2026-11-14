using System.Text.RegularExpressions;
using System.Xml;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// Proyectos .NET (<c>.csproj</c>): el SDK web o worker es un servicio; las bibliotecas quedan registradas para que
/// los detectores de código las propongan como módulo si exponen algo. Tecnologías: .NET, ASP.NET Core y EF Core.
/// Las referencias entre proyectos son relaciones <c>depends-on</c> observadas (las arma <see cref="LinkProjects"/>
/// al final, cuando ya se sabe qué proyectos son entidades). XML sin DTD ni resolución externa.
/// </summary>
public sealed partial class CsprojDetector : IDetector
{
    public string Id => "csproj";

    public IReadOnlyList<string> Entities { get; } = ["service", "module"];

    public IReadOnlyList<string> Relations { get; } = ["depends-on"];

    public void Run(AnalysisContext context)
    {
        foreach (var file in context.Files.Where(f => f.Extension.Equals(".csproj", StringComparison.OrdinalIgnoreCase)))
        {
            if (context.Read(file, Id) is not { } text)
            {
                continue;
            }

            Project? project;
            try
            {
                project = Parse(text);
            }
            catch (XmlException ex)
            {
                context.Findings.Limitation("unparsed-file", $"XML inválido (línea {ex.LineNumber}).", Id, file.Path);
                continue;
            }

            var name = Path.GetFileNameWithoutExtension(file.Name);
            var directory = Path.GetDirectoryName(file.Path)?.Replace('\\', '/') ?? "";
            var role = RoleOf(project, name);
            var evidence = context.Findings.Evidence(Id, file.Path, Confidence.High, "Project", new Lines(project.SdkLine, project.SdkLine),
                project.Sdk is null ? null : $"Sdk {project.Sdk}");
            var references = project.References
                .Select(r => (Path: Normalize(directory, r.Include), r.Lines))
                .ToList();
            context.Projects.Add(new DotnetProject(name, file.Path, directory, role, references, evidence));

            // El TargetFramework suele vivir en un Directory.Build.props de una carpeta superior (dentro de la raíz).
            var framework = project.TargetFramework ?? InheritedFramework(context, directory);
            if (framework is not null && DotnetVersion().Match(framework) is { Success: true } match)
            {
                context.Findings.Technology("dotnet", ".NET", match.Groups[1].Value, evidence);
            }

            if (role == DotnetProjectRole.Service)
            {
                if (project.Sdk?.Contains(".Web", StringComparison.OrdinalIgnoreCase) == true)
                {
                    context.Findings.Technology("aspnetcore", "ASP.NET Core", null, evidence);
                }

                var service = context.Findings.Entity(DiscoveryKeys.Service(name), "service", name, Basis.Observed, Confidence.High, evidence);
                if (service is not null)
                {
                    service.Technology = project.Sdk?.Contains(".Web", StringComparison.OrdinalIgnoreCase) == true ? "aspnetcore" : "dotnet";
                }
            }

            foreach (var package in project.Packages.Where(p => p.Name.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.OrdinalIgnoreCase)))
            {
                var packageEvidence = context.Findings.Evidence(Id, file.Path, Confidence.High, $"PackageReference.{package.Name}", package.Lines);
                context.Findings.Technology("efcore", "Entity Framework Core", package.Version, packageEvidence);
            }
        }
    }

    /// <summary>
    /// Después de todos los detectores: cada servicio o módulo que referencia a otro proyecto que también es entidad
    /// depende de él (observado: la referencia está declarada en el <c>.csproj</c>). Un módulo deriva de los servicios
    /// que lo referencian, directa o indirectamente.
    /// </summary>
    public static void LinkProjects(AnalysisContext context)
    {
        var byPath = context.Projects.ToDictionary(p => p.Path, StringComparer.Ordinal);
        string? KeyOf(DotnetProject project) =>
            context.Findings.Entities.ContainsKey(project.ServiceKey) && project.Role == DotnetProjectRole.Service ? project.ServiceKey
            : context.Findings.Entities.ContainsKey(project.ModuleKey) ? project.ModuleKey
            : null;

        foreach (var project in context.Projects.Where(p => p.Role is DotnetProjectRole.Service or DotnetProjectRole.Library))
        {
            if (KeyOf(project) is not { } from)
            {
                continue;
            }

            foreach (var (path, lines) in project.References)
            {
                if (byPath.TryGetValue(path, out var target) && KeyOf(target) is { } to)
                {
                    var evidence = context.Findings.Evidence("csproj", project.Path, Confidence.High,
                        $"ProjectReference.{target.Name}", lines, "Referencia de proyecto declarada");
                    context.Findings.Relation("depends-on", from, to, Basis.Observed, Confidence.High, evidence);
                }
            }
        }

        foreach (var module in context.Projects.Where(p => context.Findings.Entities.ContainsKey(p.ModuleKey)))
        {
            var entity = context.Findings.Entities[module.ModuleKey];
            foreach (var service in context.Projects.Where(p => p.Role == DotnetProjectRole.Service && Reaches(p, module, byPath, [])))
            {
                if (context.Findings.Entities.ContainsKey(service.ServiceKey))
                {
                    entity.AddDerivedFrom(service.ServiceKey);
                }
            }
        }
    }

    private static bool Reaches(DotnetProject from, DotnetProject target, Dictionary<string, DotnetProject> byPath, HashSet<string> seen)
    {
        if (!seen.Add(from.Path))
        {
            return false;
        }

        foreach (var (path, _) in from.References)
        {
            if (path == target.Path || (byPath.TryGetValue(path, out var next) && Reaches(next, target, byPath, seen)))
            {
                return true;
            }
        }

        return false;
    }

    private static DotnetProjectRole RoleOf(Project project, string name)
    {
        if (project.IsTest || project.Packages.Any(p => p.Name.Equals("Microsoft.NET.Test.Sdk", StringComparison.OrdinalIgnoreCase))
            || name.EndsWith(".Tests", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".Test", StringComparison.OrdinalIgnoreCase))
        {
            return DotnetProjectRole.Test;
        }

        if (project.Sdk is { } sdk && (sdk.Contains(".Web", StringComparison.OrdinalIgnoreCase) || sdk.Contains(".Worker", StringComparison.OrdinalIgnoreCase)))
        {
            return DotnetProjectRole.Service;
        }

        return project.OutputType?.Equals("Exe", StringComparison.OrdinalIgnoreCase) == true || project.IsTool
            ? DotnetProjectRole.Tool
            : DotnetProjectRole.Library;
    }

    /// <summary><c>TargetFramework</c> del <c>Directory.Build.props</c> más cercano hacia arriba, dentro del alcance.</summary>
    private string? InheritedFramework(AnalysisContext context, string directory)
    {
        for (var dir = directory; ; dir = dir.Contains('/', StringComparison.Ordinal) ? dir[..dir.LastIndexOf('/')] : "")
        {
            var path = dir.Length == 0 ? "Directory.Build.props" : $"{dir}/Directory.Build.props";
            if (context.Files.FirstOrDefault(f => f.Path == path) is { } props && context.Read(props, Id) is { } text)
            {
                try
                {
                    if (Parse(text).TargetFramework is { } framework)
                    {
                        return framework;
                    }
                }
                catch (XmlException)
                {
                    context.Findings.Limitation("unparsed-file", "XML inválido en Directory.Build.props.", Id, path);
                }
            }

            if (dir.Length == 0)
            {
                return null;
            }
        }
    }

    /// <summary>Ruta de una referencia relativa al <c>.csproj</c>, normalizada a la raíz con <c>/</c>.</summary>
    private static string Normalize(string directory, string include)
    {
        var parts = new List<string>(directory.Length == 0 ? [] : directory.Split('/'));
        foreach (var part in include.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part == "..")
            {
                if (parts.Count > 0)
                {
                    parts.RemoveAt(parts.Count - 1);
                }
            }
            else if (part != ".")
            {
                parts.Add(part);
            }
        }

        return string.Join('/', parts);
    }

    private static Project Parse(string text)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true };
        using var reader = XmlReader.Create(new StringReader(text), settings);
        var project = new Project();
        string? element = null;
        while (reader.Read())
        {
            var line = ((IXmlLineInfo)reader).LineNumber;
            if (reader.NodeType == XmlNodeType.Element)
            {
                element = reader.LocalName;
                switch (reader.LocalName)
                {
                    case "Project":
                        project.Sdk = reader.GetAttribute("Sdk");
                        project.SdkLine = line;
                        break;
                    case "ProjectReference" when reader.GetAttribute("Include") is { } include:
                        project.References.Add((include, new Lines(line, line)));
                        break;
                    case "PackageReference" when reader.GetAttribute("Include") is { } package:
                        project.Packages.Add((package, reader.GetAttribute("Version"), new Lines(line, line)));
                        break;
                }
            }
            else if (reader.NodeType == XmlNodeType.Text && element is not null)
            {
                var value = reader.Value.Trim();
                switch (element)
                {
                    case "TargetFramework":
                    case "TargetFrameworks":
                        project.TargetFramework ??= value.Split(';')[0];
                        break;
                    case "OutputType":
                        project.OutputType = value;
                        break;
                    case "IsTestProject":
                        project.IsTest = value.Equals("true", StringComparison.OrdinalIgnoreCase);
                        break;
                    case "PackAsTool":
                        project.IsTool = value.Equals("true", StringComparison.OrdinalIgnoreCase);
                        break;
                }
            }
            else if (reader.NodeType == XmlNodeType.EndElement)
            {
                element = null;
            }
        }

        return project;
    }

    [GeneratedRegex(@"^net(\d+\.\d+)", RegexOptions.CultureInvariant)]
    private static partial Regex DotnetVersion();

    private sealed class Project
    {
        public string? Sdk { get; set; }

        public int SdkLine { get; set; } = 1;

        public string? TargetFramework { get; set; }

        public string? OutputType { get; set; }

        public bool IsTest { get; set; }

        public bool IsTool { get; set; }

        public List<(string Include, Lines Lines)> References { get; } = [];

        public List<(string Name, string? Version, Lines Lines)> Packages { get; } = [];
    }
}
