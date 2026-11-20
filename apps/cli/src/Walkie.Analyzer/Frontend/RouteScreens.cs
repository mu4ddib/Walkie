using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Frontend;

/// <summary>Una ruta con su ruta completa (la del padre unida) y si cruzó una carga diferida.</summary>
internal sealed record ResolvedRoute(RouteDecl Decl, string? FullPath, string? LazyMount, int Depth)
{
    public bool Lazy => LazyMount is not null;
}

/// <summary>
/// Reglas comunes de React Router y Angular para pasar de rutas declaradas a pantallas (spec walkie-live, tarea 8):
/// una pantalla es una ruta con componente (o carga diferida de un componente) y una ruta completa literal. No son
/// pantallas: las redirecciones, los comodines (<c>*</c>, <c>**</c>), las rutas que solo agrupan hijos y las que tienen
/// alguna parte calculada (quedan como limitación <c>dynamic-route</c>).
/// </summary>
internal static partial class RouteScreens
{
    /// <summary>La ruta completa de cada declaración; null si alguna parte de la cadena no es literal.</summary>
    public static List<ResolvedRoute> Resolve(IEnumerable<RouteDecl> routes, string prefix, string? lazyMount)
    {
        var resolved = new List<ResolvedRoute>();
        foreach (var route in routes)
        {
            var chain = new List<RouteDecl>();
            for (var r = route; r is not null; r = r.Parent)
            {
                chain.Insert(0, r);
            }

            string? path = prefix;
            foreach (var r in chain)
            {
                if (r.Dynamic is not null)
                {
                    path = null;
                    break;
                }

                path = r.Index ? path : FrontendModel.Join(path!, r.Path ?? "");
            }

            resolved.Add(new ResolvedRoute(route, path is null ? null : FrontendModel.Join("/", path.TrimStart('/')), lazyMount, chain.Count));
        }

        return resolved;
    }

    public static bool IsWildcard(string path) => path.EndsWith("/*", StringComparison.Ordinal) || path.EndsWith("/**", StringComparison.Ordinal) || path is "*" or "**";

    /// <summary>
    /// Suma las pantallas de un archivo de rutas. Varias rutas con la misma ruta completa (un layout y su índice) son la
    /// misma pantalla: el título es el del componente más interno. Devuelve cuántas pantallas sumó.
    /// </summary>
    public static int AddScreens(
        AnalysisContext context, FrontendModel model, FrontendApp app, SourceFile file, ScriptFacts facts, IEnumerable<ResolvedRoute> routes,
        string detector, string technology, Dictionary<string, int> depthByKey)
    {
        var added = 0;
        foreach (var route in routes)
        {
            var decl = route.Decl;
            var line = model.Line(file.Path, decl.Offset);
            if (route.FullPath is null)
            {
                context.Findings.Limitation("dynamic-route",
                    $"Una ruta usa una expresión que no se puede resolver sin ejecutar ({Text.Truncate(Chain(decl), 80)}): sus pantallas no se proponen.",
                    detector, file.Path);
                continue;
            }

            if (decl.Redirect || IsWildcard(route.FullPath) || (decl.Component is null && decl.LoadComponent is null))
            {
                continue;
            }

            SourceFile? componentFile = null;
            if (decl.Component is { } component)
            {
                componentFile = model.ComponentFile(file, facts, component, detector);
            }
            else if (decl.LoadComponent is { } load)
            {
                componentFile = model.Resolve(file.Path, load.Spec);
            }

            var name = decl.Component ?? decl.LoadComponent?.Member ?? (componentFile is null ? null : Pascal(Path.GetFileNameWithoutExtension(componentFile.Path)));
            var key = app.ScreenKey(route.FullPath);
            var confidence = Confidence.Medium;
            var evidence = context.Findings.Evidence(detector, file.Path, confidence, name ?? "ruta", new Lines(line, line),
                route.Lazy ? "Ruta dentro de una carga diferida" : null);
            if (context.Findings.Entity(key, "screen", FrontendModel.Title(name, route.FullPath), Basis.Observed, confidence, evidence) is not { } screen)
            {
                continue;
            }

            screen.Route ??= Text.Truncate(route.FullPath, 500);
            screen.App ??= app.Scope;
            if (context.Findings.HasTechnology(technology))
            {
                screen.Technology ??= technology;
            }

            if (!depthByKey.TryGetValue(key, out var depth) || route.Depth > depth)
            {
                depthByKey[key] = route.Depth;
                screen.PreferTitle(FrontendModel.Title(name, route.FullPath));
            }

            // El componente en su archivo: el nombre declarado, o null si la ruta trae el archivo entero (lazy sin miembro).
            var declared = decl.Component ?? decl.LoadComponent?.Member;
            model.AddScreen(new ScreenRecord(app, key, route.FullPath, route.LazyMount, file.Path, line), componentFile?.Path, declared);
            added++;
        }

        return added;
    }

    /// <summary>
    /// Relaciones <c>navigates</c> de una app (ADR-0016). Del código TypeScript, con <see cref="FrontendSymbols"/>: cada
    /// navegación resuelta en una función (literal, constante importada, función de rutas, condicional) va desde cada
    /// pantalla que alcanza esa función (la suya, por un hook o por un componente que dibuja) hacia la pantalla de
    /// destino de la misma app. De las plantillas de Angular (<paramref name="templateLinks"/>), desde el componente.
    /// Lo que no se resuelve se declara: <c>dynamic-navigation</c> (destino calculado), <c>navigation-target-unknown</c>
    /// (ninguna pantalla con esa ruta) y <c>navigation-unattributed</c> (código que ninguna pantalla alcanza, o un
    /// componente compartido).
    /// </summary>
    public static void AddNavigation(
        AnalysisContext context, FrontendModel model, FrontendApp app, string detector, IEnumerable<(string File, string Target, int Line, string? Component)> templateLinks)
    {
        var screens = model.Screens.Where(s => s.App == app).Select(s => s.Key).Distinct().ToList();
        var reach = model.ReachOf(app);
        var problems = new List<SymbolProblem>();
        foreach (var file in model.ScriptsOf(app))
        {
            if (model.Facts(file, detector) is not { } facts)
            {
                continue;
            }

            var unattributed = new List<int>();
            foreach (var function in facts.Functions)
            {
                var reference = new FunctionRef(file, facts, function);
                var summary = model.Symbols.Summary(reference);
                problems.AddRange(summary.Problems.Where(p => p.Code == "dynamic-navigation" && p.Path == file.Path));
                var consumers = reach.Reaching(reference).GroupBy(c => c.Screen).Select(g => g.OrderBy(c => c.Jsx).ThenBy(c => c.Calls).First())
                    .OrderBy(c => c.Screen, StringComparer.Ordinal).ToList();
                foreach (var navigation in summary.Navigations)
                {
                    var site = navigation.Chain[^1];
                    var target = navigation.Path.Split('?', '#')[0];
                    var (to, matchConfidence) = Target(app, screens, target);
                    if (to is null)
                    {
                        problems.Add(new SymbolProblem("navigation-target-unknown", site.Path, site.Line,
                            $"Una navegación en la línea {site.Line} va a {Text.Truncate(target, 120)} y ninguna pantalla de {app.Name} tiene esa ruta: no se relaciona."));
                        continue;
                    }

                    if (consumers.Count == 0)
                    {
                        unattributed.Add(site.Line);
                        continue;
                    }

                    var siteEvidence = context.Findings.Evidence(detector, site.Path, matchConfidence, "→ " + target, new Lines(site.Line, site.Line));
                    foreach (var consumer in consumers)
                    {
                        var (basis, confidence) = consumer.Direct && navigation.Depth == 0 ? (Basis.Observed, matchConfidence)
                            : consumer.Jsx > 0 ? (Basis.Inferred, Confidence.Low)
                            : (Basis.Inferred, matchConfidence == Confidence.Low ? Confidence.Low : Confidence.Medium);
                        context.Findings.Relation("navigates", consumer.Screen, to, basis, confidence, siteEvidence);
                        foreach (var hop in navigation.Chain.Take(navigation.Chain.Count - 1).Concat(consumer.Path))
                        {
                            context.Findings.Relation("navigates", consumer.Screen, to, basis, confidence,
                                context.Findings.Evidence(detector, hop.Path, Confidence.Medium, hop.Note, new Lines(hop.Line, hop.Line)));
                        }
                    }
                }
            }

            if (unattributed.Count > 0)
            {
                context.Findings.Limitation("navigation-unattributed",
                    Text.Truncate($"{unattributed.Count} navegación(es) (líneas {string.Join(", ", unattributed.Distinct().Order())}) están en código que ninguna pantalla alcanza de forma demostrable (o en un componente que muchas comparten): se conoce el destino, pero no desde qué pantalla.", 1000),
                    detector, file.Path, incomplete: false);
            }
        }

        foreach (var group in problems.Distinct().GroupBy(p => (p.Code, p.Path)).OrderBy(g => g.Key.Path, StringComparer.Ordinal).ThenBy(g => g.Key.Code, StringComparer.Ordinal))
        {
            var list = group.OrderBy(p => p.Line).ToList();
            var message = list.Count == 1 ? list[0].Message : $"{list.Count} navegaciones (líneas {string.Join(", ", list.Select(p => p.Line).Distinct())}): {string.Join(" · ", list.Select(p => p.Message).Distinct())}";
            context.Findings.Limitation(group.Key.Code, Text.Truncate(message, 1000), detector, group.Key.Path);
        }

        // Plantillas de Angular: desde el componente que las declara.
        foreach (var (file, target, line, component) in templateLinks)
        {
            var from = model.ScreensAt(file, component);
            var (to, confidence) = Target(app, screens, target.Split('?', '#')[0]);
            if (from.Count == 0 || to is null)
            {
                continue;
            }

            var evidence = context.Findings.Evidence(detector, file, confidence, "→ " + target, new Lines(line, line));
            foreach (var source in from)
            {
                context.Findings.Relation("navigates", source, to, Basis.Observed, confidence, evidence);
            }
        }
    }

    /// <summary>La pantalla de destino: la de esa ruta (media), o la única que coincide con parámetros (baja).</summary>
    private static (string? Key, Confidence Confidence) Target(FrontendApp app, List<string> screens, string path)
    {
        var key = app.ScreenKey(path.Length == 0 ? "/" : path);
        return screens.Contains(key)
            ? (key, Confidence.Medium)
            : (screens.Where(s => Matches(s, key)).ToList() is [var only] ? only : null, Confidence.Low);
    }

    /// <summary><c>screen:web:/pedidos/{}</c> acepta <c>screen:web:/pedidos/nuevo</c>: mismo largo y cada parte igual o parámetro.</summary>
    private static bool Matches(string pattern, string key)
    {
        var p = pattern.Split('/');
        var k = key.Split('/');
        return p.Length == k.Length && p.Zip(k).All(x => x.First == x.Second || x.First == "{}" || x.Second == "{}");
    }

    private static string Chain(RouteDecl decl)
    {
        var parts = new List<string>();
        for (var r = decl; r is not null; r = r.Parent)
        {
            parts.Insert(0, r.Dynamic is null ? r.Path ?? "" : "{" + r.Dynamic + "}");
        }

        return string.Join('/', parts);
    }

    /// <summary><c>pedido-detalle.component</c> → <c>PedidoDetalleComponent</c> (nombre del componente por su archivo).</summary>
    private static string Pascal(string fileName) =>
        string.Concat(PascalSplit().Split(fileName).Where(p => p.Length > 0).Select(p => char.ToUpperInvariant(p[0]) + p[1..]));

    [GeneratedRegex("[^A-Za-z0-9]+")]
    private static partial Regex PascalSplit();

    /// <summary>El contrato <c>$defs/http</c> mínimo de una llamada: método y ruta.</summary>
    public static JsonObject Http(string method, string path) => new() { ["method"] = method, ["path"] = path };
}
