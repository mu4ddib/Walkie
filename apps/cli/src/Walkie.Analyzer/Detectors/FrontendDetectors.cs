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
            var reach = model.ReachOf(app);
            foreach (var file in model.ScriptsOf(app))
            {
                if (model.Facts(file, Id) is not { } facts)
                {
                    continue;
                }

                var external = facts.Http.Count(h => h.External);
                var problems = new List<SymbolProblem>();

                // Código suelto del módulo (fuera de toda función con nombre): como siempre, desde la app.
                foreach (var call in facts.Http.Where(h => !h.External && facts.FunctionAt(h.Index) is null))
                {
                    var line = model.Line(file.Path, call.Offset);
                    if (call.Path is null)
                    {
                        problems.Add(new SymbolProblem("dynamic-http-url", file.Path, line,
                            $"Una llamada {call.Method} en la línea {line} usa una URL que no se puede resolver sin ejecutar ({call.Unresolved}): no se relaciona con ninguna API."));
                        continue;
                    }

                    var resolved = new ResolvedCall(call.Method, call.Path, false, [new Hop(file.Path, line, $"{call.Method} {call.Path}")], 0, call.Offset);
                    Relate(context, model, app, resolved, [], call.Relative);
                }

                foreach (var function in facts.Functions)
                {
                    var reference = new FunctionRef(file, facts, function);
                    var summary = model.Symbols.Summary(reference);
                    problems.AddRange(summary.Problems.Where(p => p.Code is "dynamic-http-url" or "http-wrapper-unresolved" or "non-api-fetch" && p.Path == file.Path));
                    foreach (var call in summary.Calls)
                    {
                        Relate(context, model, app, call, reach.Reaching(reference), relative: false);
                    }
                }

                foreach (var group in problems.Distinct().GroupBy(p => p.Code).OrderBy(g => g.Key, StringComparer.Ordinal))
                {
                    var list = group.OrderBy(p => p.Line).ToList();
                    var messages = string.Join(" · ", list.Select(p => p.Message).Distinct());
                    var message = list.Count == 1 ? list[0].Message : $"{list.Count} llamadas (líneas {string.Join(", ", list.Select(p => p.Line))}): {messages}";
                    context.Findings.Limitation(group.Key, Text.Truncate(message, 1000), Id, file.Path, incomplete: group.Key != "non-api-fetch");
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

    /// <summary>
    /// La relación <c>calls</c> de una llamada resuelta, desde cada pantalla que alcanza su función (o desde la app si
    /// ninguna). Confianza (ADR-0016): escrita en la pantalla y sin envoltorio, observada media; a través de un
    /// envoltorio, un hook o un servicio, inferida media; a través de un componente dibujado, inferida baja. La
    /// evidencia es la cadena entera, cada salto con su archivo y línea.
    /// </summary>
    private void Relate(AnalysisContext context, FrontendModel model, FrontendApp app, ResolvedCall call, IReadOnlyList<Reach> consumers, bool relative)
    {
        var key = DiscoveryKeys.Api(call.Method, call.Path);
        var site = call.Chain[0];
        var siteConfidence = relative ? Confidence.Low : Confidence.Medium;
        var siteEvidence = context.Findings.Evidence(Id, site.Path, siteConfidence, $"{call.Method} {call.Path}", new Lines(site.Line, site.Line),
            relative ? "URL relativa: se asumió que cuelga de la raíz del sitio"
            : call.ViaBase ? "Ruta literal sobre una base configurable (una constante que no es literal)" : null);
        if (context.Findings.Entity(key, "api", $"{call.Method} {DiscoveryKeys.NormalizePath(call.Path)}", Basis.Inferred, siteConfidence, siteEvidence) is not { } api)
        {
            return;
        }

        api.Http ??= RouteScreens.Http(call.Method, Text.Truncate(call.Path.Split('?', '#')[0], 500));
        var chain = call.Chain.Skip(1).Select(h => context.Findings.Evidence(Id, h.Path, Confidence.Medium, h.Note, new Lines(h.Line, h.Line))).ToList();
        var bestByScreen = consumers.GroupBy(c => c.Screen).Select(g => g.OrderBy(c => c.Jsx).ThenBy(c => c.Calls).First()).OrderBy(c => c.Screen, StringComparer.Ordinal).ToList();
        if (bestByScreen.Count == 0)
        {
            var (basis, confidence) = call.Depth == 0 ? (Basis.Observed, siteConfidence) : (Basis.Inferred, Confidence.Medium);
            api.AddDerivedFrom(app.ServiceKey);
            context.Findings.Relation("calls", app.ServiceKey, key, basis, confidence, siteEvidence);
            foreach (var hop in chain)
            {
                context.Findings.Relation("calls", app.ServiceKey, key, basis, confidence, hop);
            }

            return;
        }

        foreach (var consumer in bestByScreen)
        {
            var (basis, confidence) = consumer.Direct && call.Depth == 0 ? (Basis.Observed, siteConfidence)
                : consumer.Jsx > 0 ? (Basis.Inferred, Confidence.Low)
                : (Basis.Inferred, Confidence.Medium);
            api.AddDerivedFrom(consumer.Screen);
            context.Findings.Relation("calls", consumer.Screen, key, basis, confidence, siteEvidence);
            foreach (var hop in chain.Concat(consumer.Path.Select(h => context.Findings.Evidence(Id, h.Path, Confidence.Medium, h.Note, new Lines(h.Line, h.Line)))))
            {
                context.Findings.Relation("calls", consumer.Screen, key, basis, confidence, hop);
            }

            if (!model.CallsByScreen.TryGetValue(consumer.Screen, out var calls))
            {
                model.CallsByScreen[consumer.Screen] = calls = new SortedSet<string>(StringComparer.Ordinal);
            }

            calls.Add(key);
        }
    }
}

/// <summary>
/// Candidatos a feature (ADR-0013 y ADR-0016). Una feature es una decisión de una persona; esto solo la propone, con
/// reglas conservadoras, deterministas y explicables, y con sus pantallas y las APIs que llaman como miembros:
/// <list type="number">
/// <item><b>Carga diferida</b> (Angular <c>loadChildren</c>): las pantallas que se cargan juntas bajo una ruta.</item>
/// <item><b>Familia de rutas:</b> la ruta sin parámetros (<c>/apps/:appId/catalog/:itemId</c> → <c>apps/catalog</c>),
/// dentro de una app técnica; una familia con dos o más pantallas es candidata. Dos familias no se juntan por compartir
/// un segmento: <c>/s/:token/modules/:id</c> y <c>/apps/:appId/modules/:id</c> no son la misma.</item>
/// <item><b>Una pantalla de detalle</b> (una familia de una sola pantalla que cuelga de otra) se une a la familia de la
/// que cuelga solo si toda navegación que llega a ella sale de esa familia, vuelve a ella y comparten al menos una API.</item>
/// </list>
/// El puntaje (ADR-0016) suma evidencia fuerte (navegación observada entre sus pantallas, carga diferida común), media
/// (APIs en común, APIs de un mismo módulo del backend) y débil (solo la forma de la ruta): confianza media con al menos
/// una fuerte y una media; si no, baja. El nombre es el título de la pantalla con la ruta más corta. Inferida siempre.
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
        var navigation = context.Findings.RelationEnds.Where(r => r.Kind == "navigates").Select(r => (r.From, r.To)).ToHashSet();
        var moduleOf = context.Findings.RelationEnds.Where(r => r.Kind == "exposes" && r.From.StartsWith("module:", StringComparison.Ordinal))
            .GroupBy(r => r.To).ToDictionary(g => g.Key, g => g.Select(r => r.From).Order(StringComparer.Ordinal).First(), StringComparer.Ordinal);
        foreach (var app in model.Apps)
        {
            var records = model.Screens.Where(s => s.App == app).GroupBy(s => s.Key).Select(g => g.First()).OrderBy(s => s.Key, StringComparer.Ordinal).ToList();
            var groups = new List<(string Reason, List<ScreenRecord> Screens, bool Lazy)>();

            // 1. Carga diferida.
            foreach (var lazy in records.Where(s => s.LazyMount is not null).GroupBy(s => s.LazyMount!).OrderBy(g => g.Key, StringComparer.Ordinal))
            {
                groups.Add(($"se cargan juntas bajo {lazy.Key}", [.. lazy], true));
            }

            // 2. Familias de rutas (sin las de carga diferida ni la raíz).
            var families = records.Where(s => s.LazyMount is null).GroupBy(s => Family(s.Route)).Where(g => g.Key.Length > 0)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

            // 3. Una pantalla de detalle se une a la familia de la que cuelga si solo se llega desde ella, vuelve y comparten API.
            foreach (var (family, screens) in families.Where(f => f.Value.Count == 1).OrderBy(f => f.Key, StringComparer.Ordinal).ToList())
            {
                var detail = screens[0].Key;
                var parent = families.Keys.Where(k => k != family && families[k].Count > 0 && family.StartsWith(k + "/", StringComparison.Ordinal))
                    .OrderByDescending(k => k.Length).FirstOrDefault();
                if (parent is null)
                {
                    continue;
                }

                var parentKeys = families[parent].Select(s => s.Key).ToHashSet(StringComparer.Ordinal);
                var inbound = navigation.Where(n => n.To == detail && n.From != detail).Select(n => n.From).ToList();
                var calls = Calls(model, detail);
                if (inbound.Count > 0 && inbound.All(parentKeys.Contains) && navigation.Any(n => n.From == detail && parentKeys.Contains(n.To))
                    && families[parent].Any(p => Calls(model, p.Key).Overlaps(calls)))
                {
                    families[parent].Add(screens[0]);
                    families.Remove(family);
                }
            }

            foreach (var (family, screens) in families.Where(f => f.Value.Count >= 2).OrderBy(f => f.Key, StringComparer.Ordinal))
            {
                groups.Add(($"son de la familia de rutas /{family}", screens, false));
            }

            foreach (var (reason, screens, lazy) in groups)
            {
                Propose(context, model, navigation, moduleOf, reason, screens, lazy);
            }
        }
    }

    private static SortedSet<string> Calls(FrontendModel model, string screen) =>
        model.CallsByScreen.TryGetValue(screen, out var calls) ? calls : new SortedSet<string>(StringComparer.Ordinal);

    /// <summary>La familia de una ruta: sus segmentos fijos (<c>/apps/:appId/catalog/:itemId</c> → <c>apps/catalog</c>); la raíz, vacía.</summary>
    internal static string Family(string route) =>
        string.Join('/', DiscoveryKeys.NormalizePath(route).Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Where(s => s != "{}" && !s.Contains('*', StringComparison.Ordinal)));

    private void Propose(
        AnalysisContext context, FrontendModel model, HashSet<(string From, string To)> navigation, Dictionary<string, string> moduleOf,
        string reason, List<ScreenRecord> records, bool lazy)
    {
        var screens = records.GroupBy(s => s.Key).Select(s => s.First()).OrderBy(s => s.Route.Length).ThenBy(s => s.Key, StringComparer.Ordinal).ToList();
        if (screens.Count < 2)
        {
            return;
        }

        var keys = screens.Select(s => s.Key).ToHashSet(StringComparer.Ordinal);
        var links = navigation.Count(n => keys.Contains(n.From) && keys.Contains(n.To));
        var perScreen = screens.Select(s => Calls(model, s.Key)).ToList();
        var apis = perScreen.SelectMany(c => c).Distinct().Order(StringComparer.Ordinal).ToList();
        var shared = apis.Where(a => perScreen.Count(c => c.Contains(a)) >= 2).ToList();
        var modules = apis.Where(moduleOf.ContainsKey).Select(a => moduleOf[a]).GroupBy(m => m).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).ToList();
        var strong = links > 0 || lazy;
        var medium = shared.Count > 0 || (modules.Count > 0 && modules[0].Count() >= 2);
        var confidence = strong && medium ? Confidence.Medium : Confidence.Low;

        // El nombre: el título de la pantalla principal (la de ruta más corta), que es lo que una persona ya escribió.
        var main = context.Findings.Entities.TryGetValue(screens[0].Key, out var mainScreen) ? mainScreen.Title : Humanize(LastStatic(screens[0].Route) ?? screens[0].Route);
        var title = Text.Truncate(main, 120);
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
        var evidenceText = new List<string>();
        if (lazy)
        {
            evidenceText.Add("carga diferida común");
        }

        if (links > 0)
        {
            evidenceText.Add(links == 1 ? "1 navegación entre ellas" : $"{links} navegaciones entre ellas");
        }

        if (shared.Count > 0)
        {
            evidenceText.Add(shared.Count == 1 ? "1 API en común" : $"{shared.Count} APIs en común");
        }

        if (modules.Count > 0)
        {
            evidenceText.Add($"{modules[0].Count()} de sus APIs son de {modules[0].Key["module:".Length..]}");
        }

        feature.Description ??= Text.Truncate(
            $"Propuesta: {screens.Count} pantallas que {reason} ({string.Join(", ", screens.Select(s => s.Route))})"
            + (apis.Count switch { 0 => "", 1 => " y la API que llaman", _ => $" y las {apis.Count} APIs que llaman" })
            + ". Evidencia: " + (evidenceText.Count == 0 ? "solo la forma de las rutas (débil)" : string.Join(", ", evidenceText))
            + $". Confianza {(confidence == Confidence.Medium ? "media" : "baja")}. Es una sugerencia: el nombre y el alcance los decides tú.", 2000);
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
