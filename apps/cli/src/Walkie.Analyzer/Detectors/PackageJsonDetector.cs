using System.Text.Json;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// <c>package.json</c> (fuera de <c>node_modules</c>): tecnologías del front y de Node (React, Angular, Next.js, Vue,
/// TypeScript…) con su versión declarada. No produce entidades: las pantallas, rutas y llamadas HTTP de React y
/// Angular necesitan un parser de TypeScript que todavía no está (ADR-0013, tarea 8), y eso se declara como
/// limitación en vez de adivinarlo.
/// </summary>
public sealed class PackageJsonDetector : IDetector
{
    private static readonly (string Package, string Id, string Name, bool Frontend)[] Known =
    [
        ("react", "react", "React", true),
        ("@angular/core", "angular", "Angular", true),
        ("next", "nextjs", "Next.js", true),
        ("vue", "vue", "Vue", true),
        ("svelte", "svelte", "Svelte", true),
        ("typescript", "typescript", "TypeScript", false),
        ("vite", "vite", "Vite", false),
        ("express", "express", "Express", false),
        ("@nestjs/core", "nestjs", "NestJS", false),
    ];

    public string Id => "package-json";

    public IReadOnlyList<string> Entities { get; } = [];

    public IReadOnlyList<string> Relations { get; } = [];

    public void Run(AnalysisContext context)
    {
        foreach (var file in context.Files.Where(f => f.Name.Equals("package.json", StringComparison.Ordinal)))
        {
            if (context.Read(file, Id) is not { } text)
            {
                continue;
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 64 });
            }
            catch (JsonException)
            {
                context.Findings.Limitation("unparsed-file", "JSON inválido: no se pudo leer el package.json.", Id, file.Path);
                continue;
            }

            using (document)
            {
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var lines = text.Split('\n');
                var root = document.RootElement;
                var packageEvidence = context.Findings.Evidence(Id, file.Path, Confidence.High, "package.json");
                var node = root.TryGetProperty("engines", out var engines) && engines.ValueKind == JsonValueKind.Object
                    && engines.TryGetProperty("node", out var nodeVersion) && nodeVersion.ValueKind == JsonValueKind.String
                    ? Version(nodeVersion.GetString()!)
                    : null;
                context.Findings.Technology("nodejs", "Node.js", node, packageEvidence);

                var frontends = new List<string>();
                foreach (var (package, id, name, frontend) in Known)
                {
                    foreach (var section in new[] { "dependencies", "devDependencies", "peerDependencies" })
                    {
                        if (!root.TryGetProperty(section, out var dependencies) || dependencies.ValueKind != JsonValueKind.Object
                            || !dependencies.TryGetProperty(package, out var declared))
                        {
                            continue;
                        }

                        var line = Array.FindIndex(lines, l => l.Contains($"\"{package}\"", StringComparison.Ordinal)) + 1;
                        var evidence = context.Findings.Evidence(Id, file.Path, Confidence.High, $"{section}.{package}",
                            line > 0 ? new Lines(line, line) : null);
                        context.Findings.Technology(id, name, declared.ValueKind == JsonValueKind.String ? Version(declared.GetString()!) : null, evidence);
                        if (frontend)
                        {
                            frontends.Add(name);
                        }

                        break;
                    }
                }

                if (frontends.Count > 0)
                {
                    context.Findings.Limitation("frontend-semantics-not-analyzed",
                        $"{string.Join(", ", frontends.Distinct())}: se detectó la tecnología, pero las pantallas, rutas y llamadas HTTP todavía no se analizan (falta el parser de TypeScript, ADR-0013).",
                        Id, file.Path);
                }
            }
        }
    }

    /// <summary>Versión declarada sin operadores (<c>^19.3.1</c> → <c>19.3.1</c>); null si no es una versión.</summary>
    private static string? Version(string declared)
    {
        var trimmed = declared.Trim().TrimStart('^', '~', '>', '=', '<', 'v', ' ');
        return trimmed.Length > 0 && char.IsAsciiDigit(trimmed[0]) ? trimmed.Split(' ')[0] : null;
    }
}
