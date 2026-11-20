using Walkie.Shared.Discovery;

// Las utilidades de tokens reciben listas del lexer y porciones armadas aquí: IReadOnlyList a propósito.
#pragma warning disable CA1859

namespace Walkie.Analyzer.Frontend;

/// <summary>Una parte de una URL o ruta evaluada sin ejecutar (ADR-0016).</summary>
internal abstract record Part;

/// <summary>Texto literal.</summary>
internal sealed record Lit(string Text) : Part;

/// <summary>Un parámetro de la función que se resume: lo decide quien la llama.</summary>
internal sealed record Param(string Name) : Part;

/// <summary>Un valor que no se conoce sin ejecutar (una variable, <c>pedido.id</c>): ocupa un segmento <c>{nombre}</c>.</summary>
internal sealed record Hole(string Name) : Part;

/// <summary>La base configurable de una URL (una constante del módulo que no es literal, <c>this.apiUrl</c>, <c>environment.apiUrl</c>).</summary>
internal sealed record BaseUrl(string Name) : Part;

/// <summary>Un parámetro opcional que quien llama no pasó.</summary>
internal sealed record Missing : Part;

/// <summary>Un salto de una cadena de evidencia: archivo, línea y qué se vio ahí.</summary>
internal sealed record Hop(string Path, int Line, string Note);

internal enum MethodSource
{
    Literal,
    /// <summary>Un parámetro de la función con el método (<c>request(method, path)</c>).</summary>
    Param,
    /// <summary>Las opciones llegan en un parámetro (<c>send(path, init)</c> → <c>init.method</c>); sin <c>method</c>, <see cref="MethodSpec.Default"/>.</summary>
    Options,
    Unknown,
}

internal sealed record MethodSpec(MethodSource Source, string Value, string Default = "GET")
{
    public static MethodSpec Of(string method) => new(MethodSource.Literal, method);
}

/// <summary>Una llamada que todavía depende de los parámetros de su función (un envoltorio): la resuelve quien la llama.</summary>
internal sealed record HttpTemplate(IReadOnlyList<Part> Url, MethodSpec Method, IReadOnlyList<Hop> Chain, int Depth);

/// <summary>Una llamada HTTP resuelta en una función: método, ruta, si llevaba base y por cuántos envoltorios pasó.</summary>
internal sealed record ResolvedCall(string Method, string Path, bool ViaBase, IReadOnlyList<Hop> Chain, int Depth, int Offset);

/// <summary>Una navegación que todavía depende de un parámetro de su función.</summary>
internal sealed record NavigationTemplate(IReadOnlyList<Part> Target, IReadOnlyList<Hop> Chain, int Depth);

/// <summary>Una navegación resuelta en una función.</summary>
internal sealed record ResolvedNavigation(string Path, IReadOnlyList<Hop> Chain, int Depth);

/// <summary>Algo que no se pudo resolver, con el archivo y la línea donde está.</summary>
internal sealed record SymbolProblem(string Code, string Path, int Line, string Message);

/// <summary>Lo que se sabe de una función: lo que se resolvió ahí, lo que depende de sus parámetros y lo que no se pudo resolver.</summary>
internal sealed class FunctionSummary
{
    public List<HttpTemplate> OpenCalls { get; } = [];

    public List<ResolvedCall> Calls { get; } = [];

    public List<NavigationTemplate> OpenNavigations { get; } = [];

    public List<ResolvedNavigation> Navigations { get; } = [];

    public List<SymbolProblem> Problems { get; } = [];
}

/// <summary>Una función ubicada: su archivo, sus hechos y su declaración.</summary>
internal sealed record FunctionRef(SourceFile File, ScriptFacts Facts, FunctionInfo Function)
{
    public string Key => File.Path + "#" + Function.FullName;

    /// <summary>El nombre de primer nivel que la contiene (la clase de un método, el objeto de una función).</summary>
    public string TopLevel => Function.Container ?? Function.Name;
}

/// <summary>
/// Evaluación estática acotada entre archivos del front (ADR-0016): funciones que arman rutas (<c>appPath(id)</c>),
/// envoltorios HTTP (<c>getApp</c> → <c>request</c> → <c>send</c> → <c>fetch</c>) y quién los usa (pantalla → hook →
/// función del cliente). Nunca ejecuta nada: lo que no encaja en las formas conocidas queda como problema con su
/// archivo y línea. Los límites (<see cref="MaxDepth"/>, <see cref="MaxAlternatives"/>) cortan cualquier cadena larga.
/// </summary>
internal sealed class FrontendSymbols
{
    /// <summary>Saltos como mucho, hacia adentro (envoltorios y funciones de rutas) y hacia afuera (consumidores), por separado.</summary>
    public const int MaxDepth = 3;

    /// <summary>Componentes dibujados como mucho entre la pantalla y el código que hace algo.</summary>
    public const int MaxJsxDepth = 2;

    /// <summary>Un componente que dibujan más pantallas que esto es compartido: lo que hace queda en la app.</summary>
    public const int SharedComponentScreens = 3;

    private const int MaxAlternatives = 4;

    private static readonly HashSet<string> HttpMethods = ["get", "post", "put", "patch", "delete"];
    private static readonly HashSet<string> Transparent = ["encodeURIComponent", "encodeURI", "String", "decodeURIComponent"];
    private static readonly string[] NonApiSources = ["createObjectURL", "toDataURL", "readAsDataURL", "toSvg", "toPng", "toJpeg", "toBlob", "exec", "match"];

    private readonly FrontendModel model;
    private readonly string detector;
    private readonly Dictionary<string, FunctionSummary> summaries = new(StringComparer.Ordinal);
    private readonly HashSet<string> inProgress = new(StringComparer.Ordinal);

    public FrontendSymbols(FrontendModel model, string detector)
    {
        this.model = model;
        this.detector = detector;
    }

    public int Line(string path, int offset) => model.Line(path, offset);

    // ---------- Resolver nombres ----------

    /// <summary>
    /// La función a la que se refiere una llamada desde <paramref name="from"/>: del mismo archivo, importada (también
    /// por defecto y desde un índice, un nivel), un método de un campo con tipo (<c>this.pedidos.listar()</c>), de un
    /// objeto de funciones (<c>pedidosApi.listar()</c>) o de un <c>import * as api</c>.
    /// </summary>
    public FunctionRef? Resolve(SourceFile from, ScriptFacts facts, string name, string? receiver, FunctionInfo? enclosing)
    {
        if (receiver is null)
        {
            if (facts.Functions.FirstOrDefault(f => f.Container is null && f.Name == name) is { } local)
            {
                return new FunctionRef(from, facts, local);
            }

            return Imported(from, facts, name, null);
        }

        var parts = receiver.Split('.');
        if (parts[0] == "this" && parts.Length == 2 && enclosing?.Container is { } klass
            && facts.Fields.TryGetValue(klass, out var fields) && fields.TryGetValue(parts[1], out var type))
        {
            // Un servicio inyectado: su clase, en este archivo o importada.
            return Member(from, facts, type, name);
        }

        if (parts.Length == 1)
        {
            return Member(from, facts, parts[0], name);
        }

        return null;
    }

    private FunctionRef? Member(SourceFile from, ScriptFacts facts, string container, string name)
    {
        if (facts.Functions.FirstOrDefault(f => f.Container == container && f.Name == name) is { } local)
        {
            return new FunctionRef(from, facts, local);
        }

        // import * as api from './api' → api.listar(): la función listar del módulo.
        return Imported(from, facts, container, name);
    }

    /// <summary>Lo importado como <paramref name="local"/>: la función con ese nombre, o <paramref name="member"/> de su clase u objeto.</summary>
    private FunctionRef? Imported(SourceFile from, ScriptFacts facts, string local, string? member)
    {
        if (!facts.Imports.TryGetValue(local, out var spec) || model.Resolve(from.Path, spec) is not { } file)
        {
            return null;
        }

        var exported = facts.ImportAliases.GetValueOrDefault(local, local);
        foreach (var (target, targetFacts) in WithReExports(file, exported))
        {
            FunctionInfo? found = member is null
                ? targetFacts.Functions.FirstOrDefault(f => f.Container is null && f.Name == exported)
                  ?? (targetFacts.Exports.Contains("default") ? DefaultFunction(targetFacts) : null)
                : targetFacts.Functions.FirstOrDefault(f => f.Container == exported && f.Name == member)
                  ?? targetFacts.Functions.FirstOrDefault(f => f.Container is null && f.Name == member && targetFacts.Exports.Contains(member));
            if (found is not null)
            {
                return new FunctionRef(target, targetFacts, found);
            }
        }

        return null;
    }

    private static FunctionInfo? DefaultFunction(ScriptFacts facts) =>
        facts.Functions.FirstOrDefault(f => f.Container is null && facts.Exports.Contains(f.Name));

    private IEnumerable<(SourceFile File, ScriptFacts Facts)> WithReExports(SourceFile file, string name)
    {
        if (model.Facts(file, detector) is not { } facts)
        {
            yield break;
        }

        yield return (file, facts);
        foreach (var (exported, next) in facts.ReExports)
        {
            if ((exported is null || exported == name) && model.Resolve(file.Path, next) is { } reexported && model.Facts(reexported, detector) is { } inner)
            {
                yield return (reexported, inner);
            }
        }
    }

    /// <summary>El componente que dibuja <c>&lt;Nombre /&gt;</c>: la función de ese nombre aquí o en el archivo importado.</summary>
    public FunctionRef? Component(SourceFile from, ScriptFacts facts, string name)
    {
        if (facts.Functions.FirstOrDefault(f => f.Container is null && f.Name == name) is { } local)
        {
            return new FunctionRef(from, facts, local);
        }

        if (model.ComponentFile(from, facts, name, detector) is not { } file || file.Path == from.Path || model.Facts(file, detector) is not { } target)
        {
            return null;
        }

        var function = target.Functions.FirstOrDefault(f => f.Container is null && f.Name == name) ?? DefaultFunction(target);
        return function is null ? null : new FunctionRef(file, target, function);
    }

    /// <summary>Si <paramref name="receiver"/> es una instancia de <c>axios.create</c> importada: su <c>baseURL</c> (vacío sin él), o null.</summary>
    private string? ImportedAxios(SourceFile from, ScriptFacts facts, string receiver, out bool dynamicBase)
    {
        dynamicBase = false;
        if (!facts.Imports.TryGetValue(receiver, out var spec) || model.Resolve(from.Path, spec) is not { } file)
        {
            return null;
        }

        foreach (var (_, target) in WithReExports(file, receiver))
        {
            var instance = target.AxiosInstances.ContainsKey(receiver) ? receiver
                : target.Exports.Contains("default") && target.AxiosInstances.Count == 1 ? target.AxiosInstances.Keys.First() : null;
            if (instance is not null)
            {
                dynamicBase = target.AxiosInstances[instance] is null;
                return target.AxiosInstances[instance] ?? "";
            }
        }

        return null;
    }

    // ---------- Resumen de una función ----------

    /// <summary>Lo que hace <paramref name="function"/>: llamadas y navegaciones resueltas, abiertas (envoltorio) y problemas.</summary>
    public FunctionSummary Summary(FunctionRef function)
    {
        if (summaries.TryGetValue(function.Key, out var cached))
        {
            return cached;
        }

        var summary = new FunctionSummary();
        if (!inProgress.Add(function.Key))
        {
            return summary; // recursión: no se sigue
        }

        try
        {
            Summarize(function, summary);
        }
        finally
        {
            inProgress.Remove(function.Key);
        }

        summaries[function.Key] = summary;
        return summary;
    }

    private void Summarize(FunctionRef function, FunctionSummary summary)
    {
        var (file, facts, info) = function;
        var own = new Dictionary<string, IReadOnlyList<IReadOnlyList<Part>>>(StringComparer.Ordinal);
        foreach (var name in info.Params.OfType<string>())
        {
            own.TryAdd(name, [[new Param(name)]]);
        }

        var scope = new Scope(file, facts, info, own, 0);
        var sinks = new HashSet<int>();

        // fetch, axios y HttpClient escritos en esta función.
        foreach (var call in facts.In(info).Http)
        {
            sinks.Add(call.Index);
            if (call.External || call.Url is null)
            {
                continue; // otro dominio o baseURL no literal: lo cuenta el detector
            }

            var line = model.Line(file.Path, call.Offset);
            var hop = new Hop(file.Path, line, call.MethodFromOptions ? "fetch" : $"{call.Method.ToUpperInvariant()} del cliente HTTP");
            if (call.MethodFromOptions && NonApi(scope, call.Url))
            {
                summary.Problems.Add(new SymbolProblem("non-api-fetch", file.Path, line,
                    $"Un fetch en la línea {line} pide algo que el mismo código arma (una imagen, una hoja de estilos o un texto extraído): no es una llamada a una API."));
                continue;
            }

            var method = call.MethodFromOptions ? OptionsMethod(scope, call.Options, "GET") : MethodSpec.Of(call.Method);
            var prefix = call.BaseUrl.Length > 0 ? [new Lit(call.BaseUrl)] : Array.Empty<Part>();
            foreach (var url in Eval(scope, call.Url))
            {
                Add(summary, file.Path, line, [.. prefix, .. url], method, [hop], 0, call.Offset);
            }
        }

        foreach (var call in facts.In(info).Calls)
        {
            if (sinks.Contains(call.Index))
            {
                continue;
            }

            var line = model.Line(file.Path, call.Offset);
            var args = Arguments(facts, call.Open);

            // api.get('/x') con api de axios.create en otro archivo.
            if (call.Receiver is { } receiver && !receiver.Contains('.', StringComparison.Ordinal) && HttpMethods.Contains(call.Callee)
                && ImportedAxios(file, facts, receiver, out var dynamicBase) is { } baseUrl)
            {
                if (args.Count == 0)
                {
                    continue;
                }

                var hop = new Hop(file.Path, line, $"{call.Callee.ToUpperInvariant()} con la instancia {receiver} de axios");
                if (dynamicBase)
                {
                    summary.Problems.Add(new SymbolProblem("dynamic-http-url", file.Path, line,
                        $"La instancia {receiver} de axios tiene una baseURL que no es literal (línea {line}): la llamada no se relaciona con ninguna API."));
                    continue;
                }

                foreach (var url in Eval(scope, args[0]))
                {
                    Add(summary, file.Path, line, baseUrl.Length > 0 ? [new Lit(baseUrl), .. url] : url, MethodSpec.Of(call.Callee.ToUpperInvariant()), [hop], 0, call.Offset);
                }

                continue;
            }

            if (Resolve(file, facts, call.Callee, call.Receiver, info) is not { } target || target.Key == function.Key)
            {
                continue;
            }

            var inner = Summary(target);
            if (inner.OpenCalls.Count == 0 && inner.OpenNavigations.Count == 0)
            {
                continue;
            }

            var bindings = Bind(scope, target.Function, args);
            var callHop = new Hop(file.Path, line, $"llama a {target.Function.FullName}");
            foreach (var template in inner.OpenCalls)
            {
                if (template.Depth >= MaxDepth)
                {
                    summary.Problems.Add(new SymbolProblem("http-wrapper-unresolved", file.Path, line,
                        $"La llamada a {target.Function.FullName} (línea {line}) pasa por más de {MaxDepth} envoltorios: no se sigue."));
                    continue;
                }

                var method = Substitute(scope, template.Method, target.Function, args);
                foreach (var url in Substitute(template.Url, bindings))
                {
                    Add(summary, file.Path, line, url, method, [callHop, .. template.Chain], template.Depth + 1, call.Offset, target.Function.FullName);
                }
            }

            foreach (var template in inner.OpenNavigations.Where(t => t.Depth < MaxDepth))
            {
                foreach (var path in Substitute(template.Target, bindings))
                {
                    AddNavigation(summary, file.Path, line, path, [callHop, .. template.Chain], template.Depth + 1);
                }
            }
        }

        // Navegaciones de esta función: las literales, y las que dependen de una función de rutas o de un parámetro.
        foreach (var navigation in facts.In(info).Navigations)
        {
            var line = model.Line(file.Path, navigation.Offset);
            summary.Navigations.Add(new ResolvedNavigation(navigation.Path, [new Hop(file.Path, line, "→ " + navigation.Path)], 0));
        }

        foreach (var site in facts.In(info).Sites)
        {
            var line = model.Line(file.Path, site.Offset);
            foreach (var target in Eval(scope, site.Expression))
            {
                AddNavigation(summary, file.Path, line, target, [new Hop(file.Path, line, "navegación")], 0);
            }
        }
    }

    /// <summary>Navegaciones escritas fuera de toda función con nombre (código suelto del módulo): solo las literales.</summary>
    public static IEnumerable<NavigationSite> LooseNavigationSites(ScriptFacts facts) =>
        facts.NavigationSites.Where(n => facts.FunctionAt(n.Index) is null);

    private static void Add(FunctionSummary summary, string path, int line, IReadOnlyList<Part> url, MethodSpec method, IReadOnlyList<Hop> chain, int depth, int offset, string? through = null)
    {
        var (shape, text, viaBase, reason) = Classify(url);
        if (method.Source == MethodSource.Unknown)
        {
            summary.Problems.Add(new SymbolProblem("http-wrapper-unresolved", path, line,
                $"La llamada de la línea {line}{(through is null ? "" : " a " + through)} usa un método que no es literal: no se relaciona con ninguna API."));
            return;
        }

        switch (shape)
        {
            case Shape.Closed when method.Source == MethodSource.Literal:
                summary.Calls.Add(new ResolvedCall(method.Value, text!, viaBase, chain, depth, offset));
                break;
            case Shape.Closed or Shape.Open:
                summary.OpenCalls.Add(new HttpTemplate(url, method, chain, depth));
                break;
            case Shape.External:
                break; // otro dominio: no es de este proyecto
            default:
                summary.Problems.Add(new SymbolProblem(through is null ? "dynamic-http-url" : "http-wrapper-unresolved", path, line,
                    through is null
                        ? $"Una llamada en la línea {line} usa una URL que no se puede resolver sin ejecutar ({reason}): no se relaciona con ninguna API."
                        : $"La llamada a {through} en la línea {line} le pasa una ruta que no se puede leer ({reason}): no se relaciona con ninguna API."));
                break;
        }
    }

    private static void AddNavigation(FunctionSummary summary, string path, int line, IReadOnlyList<Part> target, IReadOnlyList<Hop> chain, int depth)
    {
        var (shape, text, _, reason) = Classify(target);
        switch (shape)
        {
            case Shape.Closed:
                summary.Navigations.Add(new ResolvedNavigation(text!, chain, depth));
                break;
            case Shape.Open:
                summary.OpenNavigations.Add(new NavigationTemplate(target, chain, depth));
                break;
            case Shape.External:
                break;
            default:
                summary.Problems.Add(new SymbolProblem("dynamic-navigation", path, line,
                    $"Una navegación en la línea {line} va a una ruta que no se puede resolver sin ejecutar ({reason}): su destino no se adivina."));
                break;
        }
    }

    private enum Shape
    {
        Closed,
        Open,
        External,
        Invalid,
    }

    /// <summary>
    /// Qué es una URL evaluada. Cerrada: empieza (después de la base) por una ruta literal y cada parte variable ocupa un
    /// segmento entero (<c>/api/apps/{appId}</c>) o va en la query. Abierta: un parámetro de la función está al principio
    /// o pegado a un literal (<c>/v1{path}</c>), así que la decide quien llama. Inválida: un valor desconocido en esa
    /// posición. Las partes no pasadas (<see cref="Missing"/>) se omiten.
    /// </summary>
    private static (Shape Shape, string? Text, bool ViaBase, string Reason) Classify(IReadOnlyList<Part> url)
    {
        var parts = url.Where(p => p is not Missing && p is not Lit { Text.Length: 0 }).ToList();
        var viaBase = false;
        while (parts.Count > 0 && parts[0] is BaseUrl)
        {
            viaBase = true;
            parts.RemoveAt(0);
        }

        if (parts.Count == 0)
        {
            return (Shape.Invalid, null, viaBase, viaBase ? "solo la base" : "vacía");
        }

        if (parts.Any(p => p is BaseUrl))
        {
            return (Shape.Invalid, null, viaBase, ((BaseUrl)parts.First(p => p is BaseUrl)).Name);
        }

        if (parts[0] is Param)
        {
            return (Shape.Open, null, viaBase, "");
        }

        if (parts[0] is Hole hole)
        {
            return (Shape.Invalid, null, viaBase, hole.Name);
        }

        var builder = new System.Text.StringBuilder();
        var open = false;
        for (var k = 0; k < parts.Count; k++)
        {
            switch (parts[k])
            {
                case Lit lit:
                    builder.Append(lit.Text);
                    break;
                case Param or Hole:
                    var before = builder.ToString();
                    var next = parts.Skip(k + 1).OfType<Lit>().Select(l => l.Text).FirstOrDefault(t => t.Length > 0) ?? "";
                    var inQuery = before.Contains('?', StringComparison.Ordinal);
                    var whole = inQuery || ((before.EndsWith('/') || before.Length == 0) && (next.Length == 0 || next[0] is '/' or '?' or '#' or '&'));
                    var name = parts[k] is Param p ? p.Name : ((Hole)parts[k]).Name;
                    if (!whole)
                    {
                        if (parts[k] is Param)
                        {
                            open = true;
                        }
                        else
                        {
                            return (Shape.Invalid, null, viaBase, name);
                        }
                    }

                    if (parts[k] is Param && k + 1 < parts.Count && parts[k + 1] is Param or Hole && !inQuery)
                    {
                        open = true;
                    }

                    builder.Append('{').Append(name).Append('}');
                    break;
            }
        }

        var text = builder.ToString();
        if (text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || text.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || text.StartsWith("//", StringComparison.Ordinal))
        {
            return (Shape.External, text, viaBase, "");
        }

        if (open || parts.OfType<Param>().Any() && !text.StartsWith('/'))
        {
            return (Shape.Open, null, viaBase, "");
        }

        if (!text.StartsWith('/'))
        {
            // Relativa: como frontend-http, se asume la raíz del sitio si parece una ruta.
            if (text.StartsWith('.') || text.Contains(':', StringComparison.Ordinal) || text.StartsWith('{'))
            {
                return (Shape.Invalid, null, viaBase, Text.Truncate(text, 60));
            }

            text = "/" + text;
        }

        return (Shape.Closed, text, viaBase, "");
    }

    // ---------- Evaluación de expresiones ----------

    private sealed record Scope(SourceFile File, ScriptFacts Facts, FunctionInfo? Function, IReadOnlyDictionary<string, IReadOnlyList<IReadOnlyList<Part>>> Bindings, int Depth);

    /// <summary>Los parámetros de <paramref name="callee"/> con lo que les pasa la llamada (o <see cref="Missing"/>).</summary>
    private Dictionary<string, IReadOnlyList<IReadOnlyList<Part>>> Bind(Scope scope, FunctionInfo callee, List<List<Token>> args)
    {
        var bindings = new Dictionary<string, IReadOnlyList<IReadOnlyList<Part>>>(StringComparer.Ordinal);
        for (var i = 0; i < callee.Params.Count; i++)
        {
            if (callee.Params[i] is { } name)
            {
                bindings[name] = i < args.Count ? Eval(scope, args[i]) : [[new Missing()]];
            }
        }

        return bindings;
    }

    /// <summary>Reemplaza los parámetros de la función llamada por lo que le pasaron (alternativas acotadas).</summary>
    private static List<IReadOnlyList<Part>> Substitute(IReadOnlyList<Part> template, IReadOnlyDictionary<string, IReadOnlyList<IReadOnlyList<Part>>> bindings)
    {
        var results = new List<List<Part>> { new() };
        foreach (var part in template)
        {
            if (part is Param p && bindings.TryGetValue(p.Name, out var values))
            {
                results = [.. results.SelectMany(r => values.Select(v => (List<Part>)[.. r, .. v])).Take(MaxAlternatives)];
            }
            else
            {
                foreach (var r in results)
                {
                    r.Add(part);
                }
            }
        }

        return [.. results.Select(r => (IReadOnlyList<Part>)r)];
    }

    /// <summary>El método de una llamada a un envoltorio, con lo que le pasan sus argumentos.</summary>
    private static MethodSpec Substitute(Scope scope, MethodSpec spec, FunctionInfo callee, List<List<Token>> args)
    {
        if (spec.Source is MethodSource.Literal or MethodSource.Unknown)
        {
            return spec;
        }

        var index = callee.Params.ToList().IndexOf(spec.Value);
        if (index < 0)
        {
            return new MethodSpec(MethodSource.Unknown, "");
        }

        if (index >= args.Count)
        {
            return spec.Source == MethodSource.Options ? MethodSpec.Of(spec.Default) : new MethodSpec(MethodSource.Unknown, "");
        }

        var arg = Strip(args[index]);
        if (spec.Source == MethodSource.Param)
        {
            return arg switch
            {
                [{ Kind: TokenKind.String } s] => MethodSpec.Of(s.Text.ToUpperInvariant()),
                [{ Kind: TokenKind.Identifier } id] when IsParam(scope, id.Text) => new MethodSpec(MethodSource.Param, id.Text, spec.Default),
                _ => new MethodSpec(MethodSource.Unknown, ""),
            };
        }

        return OptionsMethod(scope, arg, spec.Default);
    }

    private static bool IsParam(Scope scope, string name) => scope.Function?.Params.Contains(name) == true;

    /// <summary>
    /// El método de unas opciones (<c>{ method: 'POST' }</c>): literal, de un parámetro (<c>{ method }</c> con un
    /// parámetro <c>method</c>), o de las opciones que llegan por parámetro (<c>init</c>, <c>{ ...rest }</c> con
    /// <c>const { …, ...rest } = init</c>). Sin <c>method</c>, <paramref name="fallback"/>.
    /// </summary>
    private static MethodSpec OptionsMethod(Scope scope, IReadOnlyList<Token>? options, string fallback)
    {
        if (options is null || options.Count == 0)
        {
            return MethodSpec.Of(fallback);
        }

        var tokens = Strip(options);
        if (tokens is [{ Kind: TokenKind.Identifier } single])
        {
            var source = OptionsParam(scope, single.Text);
            return source is null ? new MethodSpec(MethodSource.Unknown, "") : new MethodSpec(MethodSource.Options, source, fallback);
        }

        if (tokens.Count < 2 || !tokens[0].Is("{"))
        {
            return new MethodSpec(MethodSource.Unknown, "");
        }

        string? spread = null;
        var depth = 0;
        for (var j = 1; j < tokens.Count - 1; j++)
        {
            var t = tokens[j];
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
                continue;
            }

            if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
                continue;
            }

            if (depth != 0)
            {
                continue;
            }

            var keyStart = tokens[j - 1].Is("{") || tokens[j - 1].Is(",");
            if (t.Is("...") && tokens[j + 1] is { Kind: TokenKind.Identifier } spreadName)
            {
                spread = OptionsParam(scope, spreadName.Text) ?? spread;
            }
            else if (keyStart && t.IsIdentifier("method"))
            {
                var next = tokens[j + 1];
                if (next.Is(":"))
                {
                    return tokens[j + 2] switch
                    {
                        { Kind: TokenKind.String } s => MethodSpec.Of(s.Text.ToUpperInvariant()),
                        { Kind: TokenKind.Identifier } id when IsParam(scope, id.Text) => new MethodSpec(MethodSource.Param, id.Text, fallback),
                        _ => new MethodSpec(MethodSource.Unknown, ""),
                    };
                }

                return IsParam(scope, "method") ? new MethodSpec(MethodSource.Param, "method", fallback) : new MethodSpec(MethodSource.Unknown, "");
            }
        }

        return spread is null ? MethodSpec.Of(fallback) : new MethodSpec(MethodSource.Options, spread, fallback);
    }

    /// <summary>El parámetro del que salen unas opciones: el mismo, o el que se desestructura en <c>const { …, ...rest } = init</c>.</summary>
    private static string? OptionsParam(Scope scope, string name)
    {
        if (IsParam(scope, name))
        {
            return name;
        }

        if (scope.Function is not { } function)
        {
            return null;
        }

        var tokens = scope.Facts.Tokens;
        for (var j = function.BodyStart; j < function.BodyEnd - 2; j++)
        {
            // const { token, headers, ...rest } = init · const opciones = init
            if (tokens[j].Is("...") && tokens[j + 1].IsIdentifier(name))
            {
                var k = j + 2;
                while (k < function.BodyEnd && !tokens[k].Is("}"))
                {
                    k++;
                }

                if (k + 2 < function.BodyEnd && tokens[k + 1].Is("=") && tokens[k + 2] is { Kind: TokenKind.Identifier } source && IsParam(scope, source.Text))
                {
                    return source.Text;
                }
            }
            else if (tokens[j].IsIdentifier(name) && tokens[j + 1].Is("=") && j + 2 < function.BodyEnd && tokens[j + 2] is { Kind: TokenKind.Identifier } alias
                     && IsParam(scope, alias.Text) && j > 0 && tokens[j - 1].Kind == TokenKind.Identifier && tokens[j - 1].Text is "const" or "let")
            {
                return alias.Text;
            }
        }

        return null;
    }

    /// <summary>Un <c>fetch</c> de algo que el propio código arma: <c>x.href</c>, <c>x.src</c> o una variable que sale de <c>createObjectURL</c>, <c>toDataURL</c>, una expresión regular…</summary>
    private static bool NonApi(Scope scope, IReadOnlyList<Token> url)
    {
        var tokens = Strip(url);
        if (tokens.Count >= 3 && tokens[^2].Is(".") && tokens[^1].Kind == TokenKind.Identifier && tokens[^1].Text is "href" or "src")
        {
            return true;
        }

        if (tokens is [{ Kind: TokenKind.String } s] && (s.Text.StartsWith("data:", StringComparison.Ordinal) || s.Text.StartsWith("blob:", StringComparison.Ordinal)))
        {
            return true;
        }

        if (tokens is not [{ Kind: TokenKind.Identifier } variable] || scope.Function is not { } function)
        {
            return false;
        }

        var all = scope.Facts.Tokens;
        var start = Math.Max(0, function.BodyStart - 400);
        for (var j = start; j < function.BodyEnd - 2; j++)
        {
            if (all[j].IsIdentifier(variable.Text) && all[j + 1].Is("=") && j > 0 && all[j - 1].Kind == TokenKind.Identifier && all[j - 1].Text is "const" or "let")
            {
                for (var k = j + 2; k < Math.Min(all.Count, j + 40) && !all[k].Is(";"); k++)
                {
                    if (all[k].Kind == TokenKind.Identifier && NonApiSources.Contains(all[k].Text) || all[k].Kind == TokenKind.Regex)
                    {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /// <summary>Las alternativas de una expresión de URL o ruta (como mucho <see cref="MaxAlternatives"/>).</summary>
    private List<IReadOnlyList<Part>> Eval(Scope scope, IReadOnlyList<Token> expression)
    {
        var tokens = Strip(expression);
        if (tokens.Count == 0)
        {
            return [[new Hole("valor")]];
        }

        // c ? a : b
        if (TopLevel(tokens, "?") is var q and >= 0 && Colon(tokens, q) is var colon and >= 0)
        {
            var condition = Strip(tokens.Take(q).ToList());
            var yes = tokens.Skip(q + 1).Take(colon - q - 1).ToList();
            var no = tokens.Skip(colon + 1).ToList();
            if (condition is [{ Kind: TokenKind.Identifier } flag] && scope.Bindings.TryGetValue(flag.Text, out var bound) && bound is [[var only]])
            {
                if (only is Missing)
                {
                    return Eval(scope, no);
                }

                if (only is not Param)
                {
                    return Eval(scope, yes);
                }
            }

            return [.. Eval(scope, yes).Concat(Eval(scope, no)).Take(MaxAlternatives)];
        }

        // a ?? b · a || b: lo de la izquierda (b es un respaldo)
        foreach (var op in new[] { "??", "||" })
        {
            if (TopLevel(tokens, op) is var at and >= 0)
            {
                return Eval(scope, tokens.Take(at).ToList());
            }
        }

        var operands = SplitTop(tokens, "+");
        if (operands.Count > 1)
        {
            var results = new List<List<Part>> { new() };
            foreach (var operand in operands)
            {
                var values = Eval(scope, operand);
                results = [.. results.SelectMany(r => values.Select(v => (List<Part>)[.. r, .. v])).Take(MaxAlternatives)];
            }

            return [.. results.Select(r => (IReadOnlyList<Part>)r)];
        }

        return Operand(scope, tokens);
    }

    private List<IReadOnlyList<Part>> Operand(Scope scope, IReadOnlyList<Token> tokens)
    {
        var first = tokens[0];
        if (tokens.Count == 1)
        {
            switch (first.Kind)
            {
                case TokenKind.String:
                    return [[new Lit(first.Text)]];
                case TokenKind.Number:
                    return [[new Lit(first.Text)]];
                case TokenKind.Template:
                    return Template(scope, first.Template!);
                case TokenKind.Identifier:
                    return Identifier(scope, first.Text);
            }
        }

        // a.b.c (sin llamada): this.apiUrl o environment.apiUrl son una base; pedido.id es un valor.
        if (tokens.All(t => t.Kind == TokenKind.Identifier || t.Is(".") || t.Is("?.")))
        {
            var root = first.Text;
            var last = tokens[^1].Text;
            if (root == "this" || scope.Facts.Imports.ContainsKey(root) && !scope.Bindings.ContainsKey(root) || scope.Facts.ModuleBindings.Contains(root))
            {
                return [[new BaseUrl(string.Join("", tokens.Select(t => t.Text)))]];
            }

            if (scope.Bindings.TryGetValue(root, out var rootValue) && rootValue is [[Param]])
            {
                return [[new Hole(last)]];
            }

            return [[new Hole(last)]];
        }

        // f(args) · x.f(args)
        if (tokens[^1].Is(")") && CallParts(tokens) is { } call)
        {
            var (name, receiver, args) = call;
            if (receiver is null && Transparent.Contains(name) && args.Count > 0)
            {
                return [.. Eval(scope, args[0]).Select(alt => (IReadOnlyList<Part>)[.. alt.Select(p => p is Lit or Param or Missing ? p : new Hole(Name(p)))])];
            }

            if (scope.Depth < MaxDepth && Resolve(scope.File, scope.Facts, name, receiver, scope.Function) is { } target && ReturnExpressions(target) is { Count: > 0 } returns)
            {
                var bindings = Bind(scope, target.Function, args);
                var inner = new Scope(target.File, target.Facts, target.Function, bindings, scope.Depth + 1);
                return [.. returns.SelectMany(r => Eval(inner, r)).Take(MaxAlternatives)];
            }

            return [[new Hole(name)]];
        }

        return [[new Hole(Describe(tokens))]];
    }

    private List<IReadOnlyList<Part>> Template(Scope scope, TemplateParts template)
    {
        var results = new List<List<Part>> { new() { new Lit(template.Head) } };
        foreach (var (expression, tail) in template.Spans)
        {
            var values = Eval(scope, expression);
            results = [.. results.SelectMany(r => values.Select(v => (List<Part>)[.. r, .. v, new Lit(tail)])).Take(MaxAlternatives)];
        }

        return [.. results.Select(r => (IReadOnlyList<Part>)r)];
    }

    private List<IReadOnlyList<Part>> Identifier(Scope scope, string name)
    {
        if (scope.Bindings.TryGetValue(name, out var bound))
        {
            return [.. bound];
        }

        if (scope.Facts.Constants.TryGetValue(name, out var constant))
        {
            return [[new Lit(constant)]];
        }

        if (model.ImportedConstant(scope.File, scope.Facts, name, detector) is { } imported)
        {
            return [[new Lit(imported)]];
        }

        if (LocalConstant(scope, name) is { } local && scope.Depth < MaxDepth)
        {
            return Eval(scope with { Depth = scope.Depth + 1 }, local);
        }

        if (scope.Facts.ModuleBindings.Contains(name) || scope.Facts.Imports.ContainsKey(name))
        {
            return [[new BaseUrl(name)]];
        }

        return [[new Hole(name)]];
    }

    /// <summary>El valor de <c>const nombre = …</c> dentro de la función (antes de usarse), si es único.</summary>
    private static List<Token>? LocalConstant(Scope scope, string name)
    {
        if (scope.Function is not { } function)
        {
            return null;
        }

        var tokens = scope.Facts.Tokens;
        List<Token>? found = null;
        for (var j = function.BodyStart; j < function.BodyEnd - 2; j++)
        {
            if (tokens[j].IsIdentifier(name) && tokens[j + 1].Is("=") && j > 0 && tokens[j - 1].IsIdentifier("const"))
            {
                if (found is not null)
                {
                    return null; // dos declaraciones: no se sabe cuál
                }

                var value = new List<Token>();
                var depth = 0;
                for (var k = j + 2; k < function.BodyEnd; k++)
                {
                    var t = tokens[k];
                    if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
                    {
                        depth++;
                    }
                    else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
                    {
                        if (depth == 0)
                        {
                            break;
                        }

                        depth--;
                    }
                    else if (depth == 0 && (t.Is(";") || t.Is(",")))
                    {
                        break;
                    }

                    value.Add(t);
                }

                found = value;
            }
        }

        return found;
    }

    /// <summary>Lo que devuelve una función que arma una ruta: su expresión, o cada <c>return</c> de primer nivel de su cuerpo.</summary>
    private static List<List<Token>> ReturnExpressions(FunctionRef target)
    {
        var tokens = target.Facts.Tokens;
        var function = target.Function;
        if (function.Expression)
        {
            return [[.. tokens.Skip(function.BodyStart).Take(function.BodyEnd - function.BodyStart)]];
        }

        var returns = new List<List<Token>>();
        var depth = 0;
        for (var j = function.BodyStart; j < function.BodyEnd; j++)
        {
            var t = tokens[j];
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
            }
            else if (t.IsIdentifier("return") && depth <= 1)
            {
                var value = new List<Token>();
                var d = 0;
                for (var k = j + 1; k < function.BodyEnd; k++)
                {
                    var x = tokens[k];
                    if (x.Kind == TokenKind.Punct && x.Text is "(" or "[" or "{")
                    {
                        d++;
                    }
                    else if (x.Kind == TokenKind.Punct && x.Text is ")" or "]" or "}")
                    {
                        if (d == 0)
                        {
                            break;
                        }

                        d--;
                    }
                    else if (d == 0 && x.Is(";"))
                    {
                        break;
                    }

                    value.Add(x);
                }

                if (value.Count == 0)
                {
                    return []; // return vacío: no arma una ruta
                }

                returns.Add(value);
            }
        }

        return returns.Count <= MaxAlternatives ? returns : [];
    }

    // ---------- Utilidades de tokens ----------

    /// <summary>Sin <c>await</c>, paréntesis que envuelven todo, <c>as Tipo</c> ni <c>!</c> final.</summary>
    private static List<Token> Strip(IReadOnlyList<Token> expression)
    {
        var tokens = expression.ToList();
        var changed = true;
        while (changed && tokens.Count > 0)
        {
            changed = false;
            if (tokens[0].IsIdentifier("await"))
            {
                tokens.RemoveAt(0);
                changed = true;
            }
            else if (tokens.Count >= 2 && tokens[0].Is("(") && Close(tokens, 0) == tokens.Count - 1)
            {
                tokens = tokens.GetRange(1, tokens.Count - 2);
                changed = true;
            }
            else if (tokens.Count >= 2 && tokens[^1].Is("!"))
            {
                tokens.RemoveAt(tokens.Count - 1);
                changed = true;
            }
            else if (TopLevel(tokens, "as", identifier: true) is var at and > 0)
            {
                tokens = tokens.GetRange(0, at);
                changed = true;
            }
        }

        return tokens;
    }

    private static int Close(IReadOnlyList<Token> tokens, int open)
    {
        var depth = 0;
        for (var j = open; j < tokens.Count; j++)
        {
            if (tokens[j].Kind == TokenKind.Punct && tokens[j].Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (tokens[j].Kind == TokenKind.Punct && tokens[j].Text is ")" or "]" or "}" && --depth == 0)
            {
                return j;
            }
        }

        return -1;
    }

    private static int TopLevel(IReadOnlyList<Token> tokens, string op, bool identifier = false)
    {
        var depth = 0;
        for (var j = 0; j < tokens.Count; j++)
        {
            var t = tokens[j];
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
            }
            else if (depth == 0 && (identifier ? t.IsIdentifier(op) : t.Is(op)))
            {
                return j;
            }
        }

        return -1;
    }

    /// <summary>El <c>:</c> de un ternario que empieza en <paramref name="question"/>, contando ternarios anidados.</summary>
    private static int Colon(IReadOnlyList<Token> tokens, int question)
    {
        var depth = 0;
        var nested = 0;
        for (var j = question + 1; j < tokens.Count; j++)
        {
            var t = tokens[j];
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
            }
            else if (depth == 0 && t.Is("?"))
            {
                nested++;
            }
            else if (depth == 0 && t.Is(":"))
            {
                if (nested == 0)
                {
                    return j;
                }

                nested--;
            }
        }

        return -1;
    }

    private static List<List<Token>> SplitTop(IReadOnlyList<Token> tokens, string op)
    {
        var parts = new List<List<Token>>();
        var current = new List<Token>();
        var depth = 0;
        foreach (var t in tokens)
        {
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
            }

            if (depth == 0 && t.Is(op))
            {
                parts.Add(current);
                current = [];
                continue;
            }

            current.Add(t);
        }

        parts.Add(current);
        return parts;
    }

    /// <summary><c>f(a, b)</c> o <c>x.y.f(a, b)</c> (con genérico opcional): nombre, receptor y argumentos.</summary>
    private static (string Name, string? Receiver, List<List<Token>> Args)? CallParts(IReadOnlyList<Token> tokens)
    {
        var open = -1;
        for (var j = 0; j < tokens.Count; j++)
        {
            if (tokens[j].Is("("))
            {
                open = j;
                break;
            }

            if (!(tokens[j].Kind == TokenKind.Identifier || tokens[j].Is(".") || tokens[j].Is("?.") || tokens[j].Is("<") || tokens[j].Is(">") || tokens[j].Is(",")))
            {
                return null;
            }
        }

        if (open <= 0 || Close(tokens, open) != tokens.Count - 1)
        {
            return null;
        }

        var head = tokens.Take(open).ToList();
        var lt = head.FindIndex(t => t.Is("<"));
        if (lt >= 0)
        {
            head = head.Take(lt).ToList();
        }

        if (head.Count == 0 || head[^1].Kind != TokenKind.Identifier)
        {
            return null;
        }

        var name = head[^1].Text;
        var receiver = head.Count > 2 ? string.Join("", head.Take(head.Count - 2).Select(t => t.Text)) : null;
        return (name, receiver, SplitTop(tokens.Skip(open + 1).Take(tokens.Count - open - 2).ToList(), ","));
    }

    private static List<List<Token>> Arguments(ScriptFacts facts, int open)
    {
        var tokens = facts.Tokens;
        var close = Close(tokens, open);
        if (close < 0)
        {
            return [];
        }

        var inner = tokens.Skip(open + 1).Take(close - open - 1).ToList();
        return inner.Count == 0 ? [] : SplitTop(inner, ",");
    }

    private static string Name(Part part) => part switch
    {
        Param p => p.Name,
        Hole h => h.Name,
        BaseUrl b => b.Name,
        _ => "valor",
    };

    private static string Describe(IReadOnlyList<Token> tokens) =>
        Text.Truncate(string.Join("", tokens.Take(6).Select(t => t.Kind == TokenKind.Template ? "`…`" : t.Text)), 80);

    /// <summary>Convierte una ruta con <c>{nombre}</c> en la clave de una pantalla o API, igual que el resto del analizador.</summary>
    public static string Normalize(string path) => DiscoveryKeys.NormalizePath(path);
}
