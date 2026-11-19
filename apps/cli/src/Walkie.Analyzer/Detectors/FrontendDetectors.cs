using System.Text.RegularExpressions;
using Walkie.Analyzer.Frontend;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// React Router (ADR-0013, tarea 8): rutas de <c>createBrowserRouter</c>/<c>createHashRouter</c>/<c>useRoutes</c> (objetos
/// con <c>path</c>, <c>element</c>, <c>Component</c>, <c>lazy</c>, <c>index</c> y <c>children</c>) y de
/// <c>&lt;Route path element&gt;</c> anidados, en los archivos que importan <c>react-router</c> o <c>react-router-dom</c>.
/// Cada ruta con componente y ruta literal es una <c>screen</c>; los <c>Link</c>, <c>NavLink</c>, <c>Navigate</c> y
/// <c>navigate()</c> hacia otra pantalla, <c>navigates</c>. No cuenta como pantalla cualquier componente: solo los que
/// una ruta muestra. Lo lee el escáner propio (confianza media).
/// </summary>
public sealed class ReactRouterDetector : IDetector
{
    private static readonly string[] OtherRouters = ["@tanstack/react-router", "wouter", "@reach/router", "react-navigation", "@react-navigation/native"];

    public string Id => "react-router";

    public IReadOnlyList<string> Entities { get; } = ["screen"];

    public IReadOnlyList<string> Relations { get; } = ["navigates"];

    public string? NotApplicable(AnalysisContext context) =>
        FrontendModel.Of(context).Apps.Any(a => a.React && !a.Next) ? null : "No hay apps React (sin Next.js) en el alcance.";

    public void Run(AnalysisContext context)
    {
        var model = FrontendModel.Of(context);
        foreach (var app in model.Apps.Where(a => a.React && !a.Next))
        {
            var depth = new Dictionary<string, int>(StringComparer.Ordinal);
            var screens = 0;
            var links = new List<(string, string, int, string?)>();
            foreach (var file in model.ScriptsOf(app))
            {
                if (model.Facts(file, Id) is not { } facts)
                {
                    continue;
                }

                if (facts.RouterImport && facts.Routes.Count > 0)
                {
                    model.ResolveImportedPaths(file, facts, Id);
                    screens += RouteScreens.AddScreens(context, model, app, file, facts, RouteScreens.Resolve(facts.Routes, "/", lazyMount: null), Id, "react", depth);
                }

                links.AddRange(facts.Navigations.Select(n => (file.Path, n.Path, model.Line(file.Path, n.Offset), facts.EnclosingDeclaration(n.Offset))));
            }

            RouteScreens.AddNavigation(context, model, app, Id, links);
            foreach (var other in OtherRouters.Where(app.Dependencies.Contains))
            {
                context.Findings.Limitation("frontend-semantics-not-analyzed",
                    $"{app.Name} usa {other}: sus rutas y pantallas no se analizan (solo React Router y Next.js).", Id, app.PackagePath);
            }

            if (screens == 0 && app.Dependencies.Any(d => d is "react-router" or "react-router-dom"))
            {
                context.Findings.Limitation("frontend-routes-not-found",
                    $"{app.Name} declara React Router, pero no se encontraron rutas literales: pueden armarse en tiempo de ejecución o en archivos que el escáner no reconoce.",
                    Id, app.PackagePath);
            }
        }
    }
}

/// <summary>
/// Angular Router (ADR-0013, tarea 8): arrays <c>Routes</c> de <c>provideRouter</c>, <c>RouterModule.forRoot</c> y
/// <c>forChild</c>, con <c>component</c>, <c>loadComponent</c>, <c>loadChildren</c> (se sigue el archivo importado y,
/// si es un NgModule, sus módulos de rutas) y <c>children</c>. Cada ruta con componente es una <c>screen</c>. La
/// navegación sale de <c>routerLink</c> (plantillas <c>templateUrl</c> o en línea) y de <c>router.navigate</c>. Un
/// NgModule es una pieza técnica: no se propone como módulo de Walkie.
/// </summary>
public sealed partial class AngularRouterDetector : IDetector
{
    public string Id => "angular-router";

    public IReadOnlyList<string> Entities { get; } = ["screen"];

    public IReadOnlyList<string> Relations { get; } = ["navigates"];

    public string? NotApplicable(AnalysisContext context) =>
        FrontendModel.Of(context).Apps.Any(a => a.Angular) ? null : "No hay apps Angular en el alcance.";

    public void Run(AnalysisContext context)
    {
        var model = FrontendModel.Of(context);
        foreach (var app in model.Apps.Where(a => a.Angular))
        {
            var files = model.ScriptsOf(app).ToList();
            var routeFiles = new Dictionary<string, (SourceFile File, ScriptFacts Facts)>(StringComparer.Ordinal);
            foreach (var file in files)
            {
                if (model.Facts(file, Id) is { RouterImport: true, Routes.Count: > 0 } facts)
                {
                    model.ResolveImportedPaths(file, facts, Id);
                    routeFiles[file.Path] = (file, facts);
                }
            }

            // Archivos que otra ruta carga en diferido: sus rutas cuelgan de la ruta que los carga.
            var lazyTargets = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (file, facts) in routeFiles.Values)
            {
                foreach (var route in facts.Routes.Where(r => r.LoadChildren is not null))
                {
                    foreach (var target in Targets(model, file, route.LoadChildren!.Value.Spec, routeFiles))
                    {
                        lazyTargets.Add(target);
                    }
                }
            }

            var depth = new Dictionary<string, int>(StringComparer.Ordinal);
            var screens = 0;
            // Raíz: las rutas de forRoot o provideRouter. Las de forChild solo cuelgan de donde las monta un loadChildren
            // que se pudo seguir (un NgModule importado sin carga diferida no se ve sin seguir los imports del AppModule).
            var queue = new Queue<(string Path, string Prefix, string? Lazy)>(
                routeFiles.Where(r => !lazyTargets.Contains(r.Key) && !r.Value.Facts.ForChild).Select(r => r.Key).Order(StringComparer.Ordinal).Select(p => (p, "/", (string?)null)));
            var seen = new HashSet<(string, string)>();
            while (queue.Count > 0)
            {
                var (path, prefix, lazy) = queue.Dequeue();
                if (!seen.Add((path, prefix)) || seen.Count > 500)
                {
                    continue;
                }

                var (file, facts) = routeFiles[path];
                var resolved = RouteScreens.Resolve(facts.Routes, prefix, lazy);
                screens += RouteScreens.AddScreens(context, model, app, file, facts, resolved, Id, "angular", depth);
                foreach (var route in resolved.Where(r => r.Decl.LoadChildren is not null && r.FullPath is not null))
                {
                    var targets = Targets(model, file, route.Decl.LoadChildren!.Value.Spec, routeFiles).ToList();
                    if (targets.Count == 0)
                    {
                        context.Findings.Limitation("lazy-routes-unresolved",
                            $"loadChildren de «{route.FullPath}» importa {route.Decl.LoadChildren.Value.Spec}, y no se encontraron sus rutas: esas pantallas no se proponen.",
                            Id, file.Path);
                    }

                    foreach (var target in targets)
                    {
                        queue.Enqueue((target, route.FullPath!, route.FullPath));
                    }
                }
            }

            foreach (var unmounted in routeFiles.Where(r => r.Value.Facts.ForChild && !seen.Any(s => s.Item1 == r.Key)).Select(r => r.Key).Order(StringComparer.Ordinal))
            {
                context.Findings.Limitation("lazy-routes-unresolved",
                    "Rutas de RouterModule.forChild que ningún loadChildren monta: no se sabe bajo qué ruta quedan, así que sus pantallas no se proponen.",
                    Id, unmounted);
            }

            // Navegación: router.navigate en el componente y routerLink en su plantilla.
            var links = new List<(string, string, int, string?)>();
            foreach (var file in files)
            {
                if (model.Facts(file, Id) is not { } facts)
                {
                    continue;
                }

                links.AddRange(facts.Navigations.Select(n => (file.Path, n.Path, model.Line(file.Path, n.Offset), facts.EnclosingDeclaration(n.Offset))));
                foreach (var url in facts.TemplateUrls)
                {
                    if (model.Resolve(file.Path, url) is { } html && context.Read(html, Id) is { } markup)
                    {
                        var starts = FrontendModel.LineStarts(markup);
                        string? owner = facts.Declarations.FirstOrDefault(d => d.Name.EndsWith("Component", StringComparison.Ordinal)).Name;
                        links.AddRange(RouterLinks(markup).Select(l => (file.Path, l.Path, LineOf(starts, l.Offset), (string?)owner)));
                    }
                }

                foreach (var (inline, offset) in facts.InlineTemplates)
                {
                    links.AddRange(RouterLinks(inline).Select(l => (file.Path, l.Path, model.Line(file.Path, offset), facts.EnclosingDeclaration(offset))));
                }
            }

            RouteScreens.AddNavigation(context, model, app, Id, links);
            if (screens == 0 && app.Dependencies.Contains("@angular/router"))
            {
                context.Findings.Limitation("frontend-routes-not-found",
                    $"{app.Name} declara @angular/router, pero no se encontraron rutas literales.", Id, app.PackagePath);
            }
        }
    }

    /// <summary>
    /// Los archivos de rutas que trae un <c>loadChildren</c>: el archivo importado si declara rutas, o (NgModule) los
    /// módulos de rutas con <c>forChild</c> que ese archivo importa.
    /// </summary>
    private static IEnumerable<string> Targets(
        FrontendModel model, SourceFile from, string spec, Dictionary<string, (SourceFile File, ScriptFacts Facts)> routeFiles)
    {
        if (model.Resolve(from.Path, spec) is not { } target)
        {
            yield break;
        }

        if (routeFiles.ContainsKey(target.Path))
        {
            yield return target.Path;
            yield break;
        }

        if (model.Facts(target, "angular-router") is not { } module)
        {
            yield break;
        }

        foreach (var imported in module.ImportSpecs)
        {
            if (model.Resolve(target.Path, imported) is { } child && routeFiles.TryGetValue(child.Path, out var routes) && routes.Facts.ForChild)
            {
                yield return child.Path;
            }
        }
    }

    /// <summary><c>routerLink="/x"</c>, <c>[routerLink]="'/x'"</c> y <c>[routerLink]="['/x', id]"</c> (cada parte variable es un parámetro).</summary>
    internal static IEnumerable<(string Path, int Offset)> RouterLinks(string html)
    {
        foreach (Match m in RouterLinkRegex().Matches(html))
        {
            if (m.Groups["literal"].Success && !m.Groups["literal"].Value.Contains("{{", StringComparison.Ordinal))
            {
                yield return (m.Groups["literal"].Value, m.Index);
            }
            else if (m.Groups["quoted"].Success)
            {
                yield return (m.Groups["quoted"].Value, m.Index);
            }
            else if (m.Groups["array"].Success)
            {
                var parts = m.Groups["array"].Value.Split(',').Select(p => p.Trim()).ToList();
                if (parts.Count > 0 && parts[0].StartsWith("'/", StringComparison.Ordinal))
                {
                    yield return (string.Join('/', parts.Select(p => p.StartsWith('\'') && p.EndsWith('\'') ? p.Trim('\'').Trim('/') : "{}")).Insert(0, "/"), m.Index);
                }
            }
        }
    }

    private static int LineOf(int[] starts, int offset)
    {
        var index = Array.BinarySearch(starts, offset);
        return (index >= 0 ? index : ~index - 1) + 1;
    }

    [GeneratedRegex("""(?:\brouterLink\s*=\s*"(?<literal>/[^"]*)")|(?:\[routerLink\]\s*=\s*"'(?<quoted>/[^']*)'")|(?:\[routerLink\]\s*=\s*"\[(?<array>[^\]"]*)\]")""")]
    private static partial Regex RouterLinkRegex();
}

/// <summary>
/// Next.js (ADR-0013, tarea 8): pantallas por carpetas, sin leer el código. App Router: cada <c>page.*</c> bajo
/// <c>app/</c> (los grupos <c>(x)</c> no cuentan en la ruta; las carpetas privadas <c>_x</c>, los slots <c>@x</c> y las
/// rutas interceptadas se omiten). Pages Router: cada archivo bajo <c>pages/</c> (sin <c>_app</c>, <c>_document</c>,
/// <c>_error</c>, <c>404</c> ni <c>500</c>). Los <c>route.*</c> de App Router que exportan <c>GET</c>, <c>POST</c>… son
/// APIs de la propia app (<c>exposes</c>). Confianza alta: la ruta es la carpeta.
/// </summary>
public sealed class NextJsDetector : IDetector
{
    private static readonly string[] Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    private static readonly string[] Pages = [".tsx", ".jsx", ".ts", ".js"];

    public string Id => "nextjs";

    public IReadOnlyList<string> Entities { get; } = ["screen", "api"];

    public IReadOnlyList<string> Relations { get; } = ["exposes", "navigates"];

    public string? NotApplicable(AnalysisContext context) =>
        FrontendModel.Of(context).Apps.Any(a => a.Next) ? null : "No hay apps Next.js en el alcance.";

    public void Run(AnalysisContext context)
    {
        var model = FrontendModel.Of(context);
        foreach (var app in model.Apps.Where(a => a.Next))
        {
            var links = new List<(string, string, int, string?)>();
            foreach (var file in context.Files.Where(f => model.AppOf(f.Path) == app && Pages.Contains(f.Extension)).Where(f => !FrontendModel.IsTestOrGenerated(f.Path)))
            {
                var local = file.Path[app.Prefix.Length..];
                var (kind, route) = Classify(local);
                if (kind is null)
                {
                    if (local.StartsWith("pages/api/", StringComparison.Ordinal) || local.StartsWith("src/pages/api/", StringComparison.Ordinal))
                    {
                        context.Findings.Limitation("next-pages-api",
                            "Una API de Pages Router (pages/api) atiende cualquier método: no se propone como API porque el método no se ve en la ruta.",
                            Id, file.Path);
                    }

                    continue;
                }

                if (kind == "page")
                {
                    var evidence = context.Findings.Evidence(Id, file.Path, Confidence.High, "página " + route, new Lines(1, 1));
                    if (context.Findings.Entity(app.ScreenKey(route), "screen", route, Basis.Observed, Confidence.High, evidence) is { } screen)
                    {
                        screen.Route ??= route;
                        screen.App ??= app.Scope;
                        screen.Technology ??= context.Findings.HasTechnology("nextjs") ? "nextjs" : null;
                        model.AddScreen(new ScreenRecord(app, screen.Key, route, null, file.Path, 1), file.Path, null);
                    }

                    if (model.Facts(file, Id) is { } facts)
                    {
                        links.AddRange(facts.Navigations.Select(n => (file.Path, n.Path, model.Line(file.Path, n.Offset), facts.EnclosingDeclaration(n.Offset))));
                    }
                }
                else if (model.Facts(file, Id) is { } handler)
                {
                    foreach (var method in Methods.Where(handler.Exports.Contains))
                    {
                        var evidence = context.Findings.Evidence(Id, file.Path, Confidence.High, $"export {method}", new Lines(1, 1));
                        var key = DiscoveryKeys.Api(method, route);
                        if (context.Findings.Entity(key, "api", $"{method} {route}", Basis.Observed, Confidence.High, evidence) is { } api)
                        {
                            api.Http ??= RouteScreens.Http(method, route);
                            api.Technology ??= context.Findings.HasTechnology("nextjs") ? "nextjs" : null;
                            context.Findings.Relation("exposes", app.ServiceKey, key, Basis.Observed, Confidence.High, evidence);
                        }
                    }
                }
            }

            RouteScreens.AddNavigation(context, model, app, Id, links);
        }
    }

    /// <summary>Si el archivo es una página o un manejador de ruta, y su ruta: <c>app/(x)/pedidos/[id]/page.tsx</c> → <c>/pedidos/[id]</c>.</summary>
    internal static (string? Kind, string Route) Classify(string local)
    {
        foreach (var root in new[] { "app/", "src/app/" })
        {
            if (!local.StartsWith(root, StringComparison.Ordinal))
            {
                continue;
            }

            var segments = local[root.Length..].Split('/');
            var name = Path.GetFileNameWithoutExtension(segments[^1]);
            var kind = name switch { "page" => "page", "route" => "route", _ => null };
            var folders = segments[..^1];
            if (kind is null || folders.Any(f => f.StartsWith('_') || f.StartsWith('@') || f.StartsWith("(.", StringComparison.Ordinal)))
            {
                return (null, "");
            }

            var route = "/" + string.Join('/', folders.Where(f => !(f.StartsWith('(') && f.EndsWith(')'))));
            return (kind, route.Length > 1 ? route : "/");
        }

        foreach (var root in new[] { "pages/", "src/pages/" })
        {
            if (!local.StartsWith(root, StringComparison.Ordinal))
            {
                continue;
            }

            var rest = local[root.Length..];
            var name = Path.GetFileNameWithoutExtension(rest);
            if (rest.StartsWith("api/", StringComparison.Ordinal) || name.StartsWith('_') || name is "404" or "500")
            {
                return (null, "");
            }

            var withoutExtension = rest[..^Path.GetExtension(rest).Length];
            var route = "/" + (withoutExtension == "index" ? "" : withoutExtension.EndsWith("/index", StringComparison.Ordinal) ? withoutExtension[..^6] : withoutExtension);
            return ("page", route);
        }

        return (null, "");
    }
}

/// <summary>
/// Llamadas HTTP del front (ADR-0013, tarea 8): <c>fetch</c>, <c>axios.get/post/…</c> (también instancias de
/// <c>axios.create</c> con <c>baseURL</c> literal) y <c>HttpClient.get/post/…</c> de Angular, con una URL que se puede
/// leer: un literal, una constante del archivo, una plantilla o una suma que empieza por algo literal. Cada llamada es
/// una relación <c>calls</c> desde la pantalla cuyo componente la hace (o desde la app, si la hace un servicio) hacia la
/// <c>api</c> con la clave normalizada: si el backend ya la descubrió (OpenAPI, ASP.NET Core), es la misma; si no, se
/// propone inferida. Las URL que no se pueden leer y las de otros dominios quedan como limitación; no se adivinan.
/// </summary>
public sealed class FrontendHttpDetector : IDetector
{
    public string Id => "frontend-http";

    public IReadOnlyList<string> Entities { get; } = ["api"];

    public IReadOnlyList<string> Relations { get; } = ["calls"];

    public string? NotApplicable(AnalysisContext context) =>
        FrontendModel.Of(context).Apps.Count > 0 ? null : "No hay apps React, Angular ni Next.js en el alcance.";

    public void Run(AnalysisContext context)
    {
        var model = FrontendModel.Of(context);
        foreach (var app in model.Apps)
        {
            foreach (var file in model.ScriptsOf(app))
            {
                if (model.Facts(file, Id) is not { Http.Count: > 0 } facts)
                {
                    continue;
                }

                var external = 0;
                foreach (var call in facts.Http)
                {
                    // Desde la pantalla cuyo componente hace la llamada; si es otro código del archivo, desde la app.
                    var screens = model.ScreensAt(file.Path, facts.EnclosingDeclaration(call.Offset));
                    var callers = screens.Count > 0 ? screens : [app.ServiceKey];
                    var line = model.Line(file.Path, call.Offset);
                    if (call.External)
                    {
                        external++;
                        continue;
                    }

                    if (call.Path is null)
                    {
                        context.Findings.Limitation("dynamic-http-url",
                            $"Una llamada {call.Method} usa una URL que no se puede resolver sin ejecutar ({call.Unresolved}): no se relaciona con ninguna API.",
                            Id, file.Path);
                        continue;
                    }

                    var key = DiscoveryKeys.Api(call.Method, call.Path);
                    var confidence = call.Relative ? Confidence.Low : Confidence.Medium;
                    var evidence = context.Findings.Evidence(Id, file.Path, confidence, $"{call.Method} {call.Path}", new Lines(line, line),
                        call.Relative ? "URL relativa: se asumió que cuelga de la raíz del sitio" : null);
                    if (context.Findings.Entity(key, "api", $"{call.Method} {DiscoveryKeys.NormalizePath(call.Path)}", Basis.Inferred, confidence, evidence) is not { } api)
                    {
                        continue;
                    }

                    api.Http ??= RouteScreens.Http(call.Method, Text.Truncate(call.Path.Split('?', '#')[0], 500));
                    foreach (var caller in callers)
                    {
                        api.AddDerivedFrom(caller);
                        context.Findings.Relation("calls", caller, key, Basis.Observed, confidence, evidence);
                        if (screens.Count > 0)
                        {
                            if (!model.CallsByScreen.TryGetValue(caller, out var calls))
                            {
                                model.CallsByScreen[caller] = calls = new SortedSet<string>(StringComparer.Ordinal);
                            }

                            calls.Add(key);
                        }
                    }
                }

                if (external > 0)
                {
                    context.Findings.Limitation("external-http-url",
                        $"{external} llamada(s) a otro dominio (URL absoluta): no se relacionan con APIs de este proyecto.",
                        Id, file.Path, incomplete: false);
                }
            }
        }
    }
}

/// <summary>
/// Candidatos a feature (ADR-0013, tarea 8). Una feature es una decisión de una persona; esto solo la propone, con dos
/// reglas conservadoras y explicables, y siempre con sus pantallas y las APIs que llaman como miembros:
/// <list type="number">
/// <item><b>Carga diferida</b> (Angular <c>loadChildren</c>): las pantallas que se cargan juntas bajo una ruta son una
/// propuesta, de confianza media.</item>
/// <item><b>Recurso</b>: dos o más pantallas cuyo último segmento estático es el mismo (una lista y su detalle:
/// <c>/pedidos</c> y <c>/pedidos/{}</c>), de confianza baja.</item>
/// </list>
/// Una pantalla de una carga diferida no se vuelve a agrupar por recurso. Una pantalla sola o la raíz no proponen nada.
/// Inferida siempre.
/// </summary>
public sealed class FrontendFeaturesDetector : IDetector
{
    public string Id => "frontend-features";

    public IReadOnlyList<string> Entities { get; } = ["feature"];

    public IReadOnlyList<string> Relations { get; } = [];

    public string? NotApplicable(AnalysisContext context) =>
        FrontendModel.Of(context).Apps.Count > 0 ? null : "No hay apps React, Angular ni Next.js en el alcance.";

    public void Run(AnalysisContext context)
    {
        var model = FrontendModel.Of(context);
        var lazy = model.Screens.Where(s => s.LazyMount is not null)
            .GroupBy(s => (s.App.Scope, Name: LastStatic(s.LazyMount!)))
            .Where(g => g.Key.Name is not null);
        var byResource = model.Screens.Where(s => s.LazyMount is null && model.Screens.All(o => o.Key != s.Key || o.LazyMount is null))
            .GroupBy(s => (s.App.Scope, Name: LastStatic(s.Route)))
            .Where(g => g.Key.Name is not null);
        foreach (var (group, isLazy) in lazy.Select(g => (g, true)).Concat(byResource.Select(g => (g, false)))
                     .OrderBy(x => x.g.Key.Scope, StringComparer.Ordinal).ThenBy(x => x.g.Key.Name, StringComparer.Ordinal))
        {
            Propose(context, model, group.Key.Name!, [.. group], isLazy);
        }
    }

    private void Propose(AnalysisContext context, FrontendModel model, string segment, List<ScreenRecord> records, bool lazy)
    {
        var screens = records.GroupBy(s => s.Key).Select(s => s.First()).OrderBy(s => s.Key, StringComparer.Ordinal).ToList();
        if (screens.Count < 2)
        {
            return;
        }

        var title = Humanize(segment);
        var confidence = lazy ? Confidence.Medium : Confidence.Low;
        var apis = screens.SelectMany(s => model.CallsByScreen.TryGetValue(s.Key, out var calls) ? calls : []).Distinct().Order(StringComparer.Ordinal).ToList();
        EntityDraft? feature = null;
        foreach (var screen in screens)
        {
            var evidence = context.Findings.Evidence(Id, screen.Path, confidence, "pantalla " + screen.Route, new Lines(screen.Line, screen.Line));
            // La clave lleva la app (ADR-0014): «Pedidos» de dos apps son dos candidatos.
            feature = context.Findings.Entity(DiscoveryKeys.Feature(screens[0].App.Scope, title), "feature", title, Basis.Inferred, confidence, evidence);
        }

        if (feature is null)
        {
            return;
        }

        feature.App ??= screens[0].App.Scope;

        var why = lazy ? $"se cargan juntas bajo /{segment}" : $"comparten el recurso «{segment}»";
        feature.Description ??= Text.Truncate(
            $"Propuesta: {screens.Count} pantallas que {why} ({string.Join(", ", screens.Select(s => s.Route))})"
            + (apis.Count switch { 0 => "", 1 => " y la API que llaman", _ => $" y las {apis.Count} APIs que llaman" })
            + ". Es una sugerencia: la feature la decides tú.", 2000);
        foreach (var screen in screens)
        {
            feature.AddMember(screen.Key);
            feature.AddDerivedFrom(screen.Key);
        }

        foreach (var api in apis)
        {
            feature.AddMember(api);
        }
    }

    /// <summary>Último segmento estático de una ruta: <c>/apps/:appId/catalog/:itemId</c> → <c>catalog</c>; la raíz, null.</summary>
    internal static string? LastStatic(string route) =>
        DiscoveryKeys.NormalizePath(route).Split('/', StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault(s => s != "{}" && !s.Contains('*', StringComparison.Ordinal));

    /// <summary><c>mis-pedidos</c> → <c>Mis pedidos</c>; <c>adminUsuarios</c> → <c>Admin usuarios</c>.</summary>
    internal static string Humanize(string segment)
    {
        var words = new List<string>();
        var current = new System.Text.StringBuilder();
        foreach (var c in segment)
        {
            if (c is '-' or '_' or '.' || (char.IsUpper(c) && current.Length > 0))
            {
                if (current.Length > 0)
                {
                    words.Add(current.ToString());
                    current.Clear();
                }

                if (c is '-' or '_' or '.')
                {
                    continue;
                }
            }

            current.Append(c);
        }

        if (current.Length > 0)
        {
            words.Add(current.ToString());
        }

#pragma warning disable CA1308 // título en español: solo la primera letra en mayúscula
        var text = string.Join(' ', words.Select(w => w.ToLowerInvariant()));
#pragma warning restore CA1308
        return text.Length == 0 ? segment : char.ToUpperInvariant(text[0]) + text[1..];
    }
}
