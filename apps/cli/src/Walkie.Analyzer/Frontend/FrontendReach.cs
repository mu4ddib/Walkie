namespace Walkie.Analyzer.Frontend;

/// <summary>Una función que una pantalla alcanza: cuántas llamadas y cuántos componentes dibujados hay en el camino, y el camino.</summary>
internal sealed record Reach(string Screen, FunctionRef Function, int Calls, int Jsx, IReadOnlyList<Hop> Path)
{
    /// <summary>La función es la de la pantalla (o un auxiliar de su mismo archivo): lo que hace, lo hace la pantalla.</summary>
    public bool Direct => Calls == 0 && Jsx == 0;
}

/// <summary>
/// Quién usa qué en una app del front (ADR-0016): desde cada pantalla, las funciones que alcanza por llamadas por nombre
/// (como mucho <see cref="FrontendSymbols.MaxDepth"/>: pantalla → hook → función del cliente) y por componentes que
/// dibuja (como mucho <see cref="FrontendSymbols.MaxJsxDepth"/>). Un componente que dibujan más de
/// <see cref="FrontendSymbols.SharedComponentScreens"/> pantallas es compartido (una barra, un menú): no se entra en él,
/// y lo que hace queda en la app. Nunca se une una pantalla con algo por compartir carpeta o nombre.
/// </summary>
internal sealed class FrontendReach
{
    private readonly Dictionary<string, List<Reach>> byFunction = new(StringComparer.Ordinal);

    private FrontendReach()
    {
    }

    /// <summary>Componentes compartidos: clave de la función → cuántas pantallas lo dibujan.</summary>
    public Dictionary<string, int> Shared { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Funciones fuera de toda app de front que alcanzan sus pantallas (código compartido de un monorepo: <c>../shared</c>),
    /// en orden. Lo que hacen se atribuye a esas pantallas y nunca a la app.
    /// </summary>
    public IEnumerable<FunctionRef> Outside(FrontendModel model) =>
        byFunction.Values.Select(list => list[0].Function).Where(f => model.AppOf(f.File.Path) is null).OrderBy(f => f.Key, StringComparer.Ordinal);

    /// <summary>Las pantallas que alcanzan la función, con su mejor camino (el más corto), en orden de pantalla.</summary>
    public IReadOnlyList<Reach> Reaching(FunctionRef function) => byFunction.TryGetValue(function.Key, out var list) ? list : [];

    public static FrontendReach Build(FrontendModel model, FrontendSymbols symbols, FrontendApp app, string detector)
    {
        var reach = new FrontendReach();
        var screens = model.Screens.Where(s => s.App == app).Select(s => s.Key).Distinct().Order(StringComparer.Ordinal).ToList();
        var roots = new Dictionary<string, List<FunctionRef>>(StringComparer.Ordinal);
        foreach (var (path, _) in model.ScreensByFile.OrderBy(e => e.Key, StringComparer.Ordinal))
        {
            if (model.FileAt(path) is not { } file || model.AppOf(path) != app || model.Facts(file, detector) is not { } facts)
            {
                continue;
            }

            foreach (var function in facts.Functions)
            {
                var top = function.Container ?? function.Name;
                foreach (var screen in model.ScreensAt(path, top))
                {
                    if (!roots.TryGetValue(screen, out var list))
                    {
                        roots[screen] = list = [];
                    }

                    list.Add(new FunctionRef(file, facts, function));
                }
            }
        }

        // Primero, qué componentes dibuja cada pantalla (hasta el límite): los de más de N pantallas son compartidos.
        var drawnBy = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var screen in screens)
        {
            foreach (var (component, _) in Walk(symbols, roots.GetValueOrDefault(screen) ?? [], shared: null, jsxOnly: true))
            {
                if (!drawnBy.TryGetValue(component.Key, out var set))
                {
                    drawnBy[component.Key] = set = new HashSet<string>(StringComparer.Ordinal);
                }

                set.Add(screen);
            }
        }

        foreach (var (key, set) in drawnBy.Where(d => d.Value.Count > FrontendSymbols.SharedComponentScreens))
        {
            reach.Shared[key] = set.Count;
        }

        foreach (var screen in screens)
        {
            foreach (var (function, step) in Walk(symbols, roots.GetValueOrDefault(screen) ?? [], reach.Shared, jsxOnly: false))
            {
                if (!reach.byFunction.TryGetValue(function.Key, out var list))
                {
                    reach.byFunction[function.Key] = list = [];
                }

                list.Add(new Reach(screen, function, step.Calls, step.Jsx, step.Path));
            }
        }

        return reach;
    }

    private sealed record Step(int Calls, int Jsx, IReadOnlyList<Hop> Path);

    /// <summary>Recorrido en anchura desde las funciones raíz: cada función con el camino más corto que la alcanza.</summary>
    private static IEnumerable<(FunctionRef Function, Step Step)> Walk(FrontendSymbols symbols, List<FunctionRef> roots, Dictionary<string, int>? shared, bool jsxOnly)
    {
        var best = new Dictionary<string, (FunctionRef, Step)>(StringComparer.Ordinal);
        var queue = new Queue<(FunctionRef Function, Step Step)>();
        foreach (var root in roots)
        {
            if (best.TryAdd(root.Key, (root, new Step(0, 0, []))))
            {
                queue.Enqueue((root, new Step(0, 0, [])));
            }
        }

        while (queue.Count > 0)
        {
            var (function, step) = queue.Dequeue();
            var (file, facts, info) = function;
            foreach (var use in facts.In(info).Jsx)
            {
                if (step.Jsx >= FrontendSymbols.MaxJsxDepth || symbols.Component(file, facts, use.Name) is not { } component || shared?.ContainsKey(component.Key) == true)
                {
                    continue;
                }

                var next = new Step(step.Calls, step.Jsx + 1, [.. step.Path, new Hop(file.Path, symbols.Line(file.Path, use.Offset), $"dibuja <{use.Name}>", info.FullName)]);
                if (best.TryAdd(component.Key, (component, next)))
                {
                    queue.Enqueue((component, next));
                }
            }

            if (jsxOnly)
            {
                continue;
            }

            foreach (var call in facts.In(info).Calls)
            {
                if (step.Calls >= FrontendSymbols.MaxDepth || symbols.Resolve(file, facts, call.Callee, call.Receiver, info) is not { } target || shared?.ContainsKey(target.Key) == true)
                {
                    continue;
                }

                var next = new Step(step.Calls + 1, step.Jsx, [.. step.Path, new Hop(file.Path, symbols.Line(file.Path, call.Offset), $"llama a {target.Function.FullName}", info.FullName)]);
                if (best.TryAdd(target.Key, (target, next)))
                {
                    queue.Enqueue((target, next));
                }
            }
        }

        return best.Values.Where(v => !jsxOnly || v.Item2.Jsx > 0);
    }
}
