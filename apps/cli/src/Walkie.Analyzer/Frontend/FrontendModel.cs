using System.Text.Json;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Frontend;

/// <summary>
/// Una aplicación de front: la carpeta de un <c>package.json</c> que declara React, Angular o Next.js. <see cref="Scope"/>
/// es su ámbito (ADR-0014): la carpeta o el que eligió el equipo en <c>.walkie/source.json</c>; va en la clave de sus
/// pantallas y candidatos a feature.
/// </summary>
internal sealed record FrontendApp(string Dir, string Name, string PackagePath, IReadOnlySet<string> Dependencies, string Scope)
{
    public bool React => Dependencies.Contains("react");

    public bool Angular => Dependencies.Contains("@angular/core");

    public bool Next => Dependencies.Contains("next");

    public string ServiceKey => DiscoveryKeys.Service(Name);

    /// <summary>La clave de una pantalla de esta app.</summary>
    public string ScreenKey(string route) => DiscoveryKeys.Screen(Scope, route);

    /// <summary>Ruta relativa con barra final (o vacía en la raíz), para saber si un archivo es de esta app.</summary>
    public string Prefix => Dir.Length == 0 ? "" : Dir + "/";
}

/// <summary>
/// Una pantalla registrada por un detector de rutas: su app, su clave, su ruta completa, la ruta de la carga diferida que
/// la trae (Angular <c>loadChildren</c>; null si no hay) y dónde se declaró (archivo y línea), para que otros detectores citen la misma evidencia con su propio id.
/// </summary>
internal sealed record ScreenRecord(FrontendApp App, string Key, string Route, string? LazyMount, string Path, int Line);

/// <summary>
/// Lo que comparten los detectores del front en un análisis (ADR-0013, tarea 8): las aplicaciones, los hechos de cada
/// archivo (cada uno se lee y se escanea una sola vez), qué archivo es el componente de qué pantalla y las llamadas de
/// cada pantalla. Los detectores de rutas registran pantallas; el de HTTP y el de features los leen.
/// </summary>
internal sealed class FrontendModel
{
    private static readonly string[] ScriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];
    private static readonly string[] Frameworks = ["react", "@angular/core", "next"];

    private readonly AnalysisContext context;
    private readonly Dictionary<string, SourceFile> byPath;
    private readonly Dictionary<string, ScriptFacts?> facts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int[]> lineStarts = new(StringComparer.Ordinal);

    private FrontendModel(AnalysisContext context)
    {
        this.context = context;
        byPath = context.Files.ToDictionary(f => f.Path, StringComparer.Ordinal);
        Apps = FindApps();
    }

    public IReadOnlyList<FrontendApp> Apps { get; }

    /// <summary>
    /// Archivo del componente → pantallas que lo muestran, con el nombre del componente (null si la pantalla es el
    /// archivo entero, como una página de Next.js o un <c>lazy</c> sin nombre).
    /// </summary>
    public Dictionary<string, List<(string? Component, string Key)>> ScreensByFile { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Las pantallas desde las que se hace algo en <paramref name="file"/> dentro de la declaración de primer nivel
    /// <paramref name="enclosing"/>:
    /// <list type="bullet">
    /// <item>la pantalla es el archivo entero (Next.js, <c>lazy</c>): todas las de ese archivo;</item>
    /// <item>el archivo tiene un solo componente de pantalla: ese, también desde sus componentes auxiliares del mismo
    /// archivo (se dibujan dentro de él);</item>
    /// <item>varios componentes de pantalla: solo el que contiene el código; en otro código del archivo no se adivina.</item>
    /// </list>
    /// El código suelto del módulo (fuera de toda declaración) no es de una pantalla: lo hace la app.
    /// </summary>
    public IReadOnlyList<string> ScreensAt(string file, string? enclosing)
    {
        if (!ScreensByFile.TryGetValue(file, out var screens))
        {
            return [];
        }

        static string[] Keys(IEnumerable<(string? Component, string Key)> list) => [.. list.Select(s => s.Key).Distinct().Order(StringComparer.Ordinal)];
        if (screens.All(s => s.Component is null))
        {
            return Keys(screens);
        }

        if (enclosing is null)
        {
            return [];
        }

        var components = screens.Select(s => s.Component).Where(c => c is not null).Distinct().ToList();
        return components.Count == 1 ? Keys(screens) : Keys(screens.Where(s => s.Component == enclosing || s.Component is null));
    }

    public List<ScreenRecord> Screens { get; } = [];

    /// <summary>Pantalla → APIs que llama (lo registra <c>frontend-http</c>; lo usa <c>frontend-features</c>).</summary>
    public Dictionary<string, SortedSet<string>> CallsByScreen { get; } = new(StringComparer.Ordinal);

    public static FrontendModel Of(AnalysisContext context) => context.Frontend ??= new FrontendModel(context);

    private FrontendSymbols? symbols;
    private readonly Dictionary<string, FrontendReach> reach = new(StringComparer.Ordinal);

    /// <summary>La evaluación entre archivos (envoltorios, funciones de rutas), compartida por los detectores del front.</summary>
    public FrontendSymbols Symbols => symbols ??= new FrontendSymbols(this, "frontend-http");

    /// <summary>Quién usa qué en una app. Se arma la primera vez que se pide, cuando sus pantallas ya están registradas.</summary>
    public FrontendReach ReachOf(FrontendApp app) =>
        reach.TryGetValue(app.Scope, out var built) ? built : reach[app.Scope] = FrontendReach.Build(this, Symbols, app, "frontend-http");

    public SourceFile? FileAt(string path) => byPath.GetValueOrDefault(path);

    private List<FrontendApp> FindApps()
    {
        var apps = new List<FrontendApp>();
        foreach (var file in context.Files.Where(f => f.Name == "package.json"))
        {
            if (context.Read(file, "package-json") is not { } text)
            {
                continue;
            }

            var dependencies = new HashSet<string>(StringComparer.Ordinal);
            string? name = null;
            try
            {
                using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 64 });
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (document.RootElement.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String)
                {
                    name = n.GetString();
                }

                foreach (var section in new[] { "dependencies", "devDependencies", "peerDependencies" })
                {
                    if (document.RootElement.TryGetProperty(section, out var deps) && deps.ValueKind == JsonValueKind.Object)
                    {
                        dependencies.UnionWith(deps.EnumerateObject().Select(p => p.Name));
                    }
                }
            }
            catch (JsonException)
            {
                continue; // package-json ya lo declara como limitación
            }

            if (!Frameworks.Any(dependencies.Contains))
            {
                continue;
            }

            var dir = Path.GetDirectoryName(file.Path)?.Replace('\\', '/') ?? "";
            var appName = string.IsNullOrWhiteSpace(name) ? (dir.Length == 0 ? "frontend" : Path.GetFileName(dir)) : name.Trim();
            var scope = context.AppScopes.TryGetValue(dir, out var chosen) ? chosen : AppScope.FromDirectory(dir);
            apps.Add(new FrontendApp(dir, Text.Truncate(appName, 120), file.Path, dependencies, scope));
        }

        // Un ámbito elegido que repite el de otra app juntaría dos apps en una: mejor parar y decirlo.
        if (apps.GroupBy(a => a.Scope, StringComparer.Ordinal).FirstOrDefault(g => g.Count() > 1) is { } repeated)
        {
            throw new AnalyzerException("invalid-source-file",
                $"{SourceIdentity.FilePath}: el ámbito «{repeated.Key}» quedó para varias apps ({string.Join(", ", repeated.Select(a => a.Dir.Length == 0 ? "." : a.Dir))}); cada app necesita uno propio.");
        }

        return [.. apps.OrderBy(a => a.Dir, StringComparer.Ordinal)];
    }

    /// <summary>La app más cercana que contiene el archivo (en un monorepo, la más interna).</summary>
    public FrontendApp? AppOf(string path) =>
        Apps.Where(a => path.StartsWith(a.Prefix, StringComparison.Ordinal)).MaxBy(a => a.Prefix.Length);

    /// <summary>Archivos de código de la app, sin pruebas, historias, declaraciones de tipos ni los de otra app anidada.</summary>
    public IEnumerable<SourceFile> ScriptsOf(FrontendApp app) =>
        context.Files.Where(f => ScriptExtensions.Contains(f.Extension, StringComparer.OrdinalIgnoreCase) && !IsTestOrGenerated(f.Path) && AppOf(f.Path) == app);

    public static bool IsTestOrGenerated(string path)
    {
        var name = Path.GetFileName(path);
        return name.EndsWith(".d.ts", StringComparison.Ordinal)
            || name.Contains(".spec.", StringComparison.Ordinal)
            || name.Contains(".test.", StringComparison.Ordinal)
            || name.Contains(".stories.", StringComparison.Ordinal)
            || path.Contains("/__tests__/", StringComparison.Ordinal) || path.StartsWith("__tests__/", StringComparison.Ordinal)
            || path.Contains("/e2e/", StringComparison.Ordinal) || path.StartsWith("e2e/", StringComparison.Ordinal)
            || path.Contains("/cypress/", StringComparison.Ordinal) || path.Contains("/test/", StringComparison.Ordinal)
            || path.Contains("/tests/", StringComparison.Ordinal);
    }

    /// <summary>Los hechos de un archivo, escaneado una sola vez. Un archivo que no cierra queda como limitación del detector.</summary>
    public ScriptFacts? Facts(SourceFile file, string detector)
    {
        if (facts.TryGetValue(file.Path, out var cached))
        {
            return cached;
        }

        ScriptFacts? result = null;
        if (context.Read(file, detector) is { } text)
        {
            var jsx = !file.Extension.Equals(".ts", StringComparison.OrdinalIgnoreCase) && !file.Extension.Equals(".mts", StringComparison.OrdinalIgnoreCase);
            result = ScriptFacts.Read(text, jsx);
            lineStarts[file.Path] = LineStarts(text);
            if (result.HasErrors)
            {
                context.Findings.Limitation("unparsed-file",
                    "El escáner de TypeScript no pudo leer todo el archivo (sintaxis rota o no soportada): lo que siguió al error puede faltar.",
                    detector, file.Path);
            }
        }

        facts[file.Path] = result;
        return result;
    }

    /// <summary>Línea (desde 1) de una posición de un archivo ya escaneado.</summary>
    public int Line(string path, int offset)
    {
        if (!lineStarts.TryGetValue(path, out var starts))
        {
            return 1;
        }

        var index = Array.BinarySearch(starts, offset);
        return (index >= 0 ? index : ~index - 1) + 1;
    }

    public static int[] LineStarts(string text)
    {
        var starts = new List<int> { 0 };
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                starts.Add(i + 1);
            }
        }

        return [.. starts];
    }

    /// <summary>
    /// El archivo de un módulo relativo (<c>./x</c>, <c>../x</c>) importado desde <paramref name="from"/>: con o sin
    /// extensión, o su <c>index</c>. Los alias (<c>@/x</c>) y los paquetes no se resuelven.
    /// </summary>
    public SourceFile? Resolve(string from, string spec)
    {
        if (!spec.StartsWith("./", StringComparison.Ordinal) && !spec.StartsWith("../", StringComparison.Ordinal))
        {
            return null;
        }

        var dir = Path.GetDirectoryName(from)?.Replace('\\', '/') ?? "";
        var parts = new List<string>(dir.Length == 0 ? [] : dir.Split('/'));
        foreach (var segment in spec.Split('/'))
        {
            if (segment == "..")
            {
                if (parts.Count == 0)
                {
                    return null; // fuera de la raíz
                }

                parts.RemoveAt(parts.Count - 1);
            }
            else if (segment is not ("." or ""))
            {
                parts.Add(segment);
            }
        }

        var target = string.Join('/', parts);
        if (byPath.TryGetValue(target, out var exact) && ScriptExtensions.Contains(exact.Extension) || target.EndsWith(".html", StringComparison.Ordinal) && byPath.TryGetValue(target, out exact))
        {
            return exact;
        }

        foreach (var candidate in ScriptExtensions.Select(e => target + e).Concat(ScriptExtensions.Select(e => target + "/index" + e)))
        {
            if (byPath.TryGetValue(candidate, out var file))
            {
                return file;
            }
        }

        return null;
    }

    /// <summary>
    /// El archivo que declara <paramref name="name"/> visto desde <paramref name="from"/>: el mismo archivo, el que lo
    /// importa o, si es un índice, el que lo reexporta (un nivel).
    /// </summary>
    public SourceFile? ComponentFile(SourceFile from, ScriptFacts facts, string name, string detector)
    {
        if (facts.Exports.Contains(name))
        {
            return from;
        }

        if (!facts.Imports.TryGetValue(name, out var spec) || Resolve(from.Path, spec) is not { } file)
        {
            return null;
        }

        if (Facts(file, detector) is not { } target || target.Exports.Contains(name) || target.Exports.Contains("default"))
        {
            return file;
        }

        foreach (var (exported, next) in target.ReExports)
        {
            if ((exported is null || exported == name) && Resolve(file.Path, next) is { } reexported)
            {
                return reexported;
            }
        }

        return file;
    }

    /// <summary>
    /// Una constante literal importada (<c>import { APPS_PATH } from './paths'</c> con <c>export const APPS_PATH = '/apps'</c>),
    /// siguiendo un índice un nivel; null si no es literal o no se encuentra.
    /// </summary>
    public string? ImportedConstant(SourceFile from, ScriptFacts facts, string name, string detector)
    {
        if (!facts.Imports.TryGetValue(name, out var spec) || Resolve(from.Path, spec) is not { } file || Facts(file, detector) is not { } target)
        {
            return null;
        }

        if (target.Exports.Contains(name) && target.Constants.TryGetValue(name, out var value))
        {
            return value;
        }

        foreach (var (exported, next) in target.ReExports)
        {
            if ((exported is null || exported == name) && Resolve(file.Path, next) is { } reexported && Facts(reexported, detector) is { } inner
                && inner.Exports.Contains(name) && inner.Constants.TryGetValue(name, out var reexportedValue))
            {
                return reexportedValue;
            }
        }

        return null;
    }

    /// <summary>Resuelve las rutas que son una constante importada: dejan de ser dinámicas.</summary>
    public void ResolveImportedPaths(SourceFile file, ScriptFacts facts, string detector)
    {
        foreach (var route in facts.Routes.Where(r => r.DynamicName is not null))
        {
            if (ImportedConstant(file, facts, route.DynamicName!, detector) is { } path)
            {
                route.Path = path;
                route.Dynamic = null;
                route.DynamicName = null;
            }
        }
    }

    /// <summary>
    /// Registra una pantalla y su componente. Varias rutas con la misma clave suman evidencia (la misma pantalla). La
    /// misma ruta en otra app es otra pantalla: la clave lleva el ámbito de la app (ADR-0014, formatVersion 1).
    /// </summary>
    public void AddScreen(ScreenRecord screen, string? componentFile, string? componentName)
    {
        Screens.Add(screen);
        if (componentFile is not null)
        {
            if (!ScreensByFile.TryGetValue(componentFile, out var screens))
            {
                ScreensByFile[componentFile] = screens = [];
            }

            if (!screens.Contains((componentName, screen.Key)))
            {
                screens.Add((componentName, screen.Key));
            }
        }
    }

    /// <summary>Título legible de un componente: sin el sufijo técnico y con espacios (<c>PedidoDetalleComponent</c> → <c>Pedido detalle</c>).</summary>
    public static string Title(string? component, string route)
    {
        if (string.IsNullOrWhiteSpace(component))
        {
            return route;
        }

        var name = component;
        foreach (var suffix in new[] { "Component", "Page", "Screen", "View", "Route" })
        {
            if (name.Length > suffix.Length && name.EndsWith(suffix, StringComparison.Ordinal))
            {
                name = name[..^suffix.Length];
                break;
            }
        }

        var builder = new System.Text.StringBuilder();
        for (var i = 0; i < name.Length; i++)
        {
            if (i > 0 && char.IsUpper(name[i]) && !char.IsUpper(name[i - 1]))
            {
                builder.Append(' ').Append(char.ToLowerInvariant(name[i]));
            }
            else
            {
                builder.Append(name[i]);
            }
        }

        return builder.ToString();
    }

    /// <summary>Une una ruta hija a la del padre: absoluta si empieza por <c>/</c>; vacía o índice es la del padre.</summary>
    public static string Join(string parent, string child)
    {
        if (child.StartsWith('/'))
        {
            return child;
        }

        if (child.Length == 0)
        {
            return parent.Length == 0 ? "/" : parent;
        }

        return parent.TrimEnd('/') + "/" + child;
    }
}
