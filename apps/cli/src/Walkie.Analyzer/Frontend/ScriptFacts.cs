using System.Text.RegularExpressions;

namespace Walkie.Analyzer.Frontend;

/// <summary>
/// Una ruta declarada en el código: un objeto <c>{ path, component… }</c> (React Router, Angular) o un
/// <c>&lt;Route path element&gt;</c>. <see cref="Path"/> es el literal tal como está escrito (relativo al padre);
/// <see cref="Dynamic"/>, la expresión cuando no es literal (no se adivina).
/// </summary>
internal sealed class RouteDecl
{
    public string? Path { get; set; }

    public string? Dynamic { get; set; }

    /// <summary>Si la ruta es un identificador solo (<c>path: APPS_PATH</c>): se puede resolver si es una constante literal importada.</summary>
    public string? DynamicName { get; set; }

    public bool Index { get; set; }

    public bool Redirect { get; set; }

    /// <summary>Componente de la ruta: <c>component</c>/<c>Component</c>, o la etiqueta de <c>element</c>.</summary>
    public string? Component { get; set; }

    /// <summary><c>loadComponent</c> o <c>lazy</c>: el módulo importado y el miembro (<c>m.X</c>), si se ve.</summary>
    public (string Spec, string? Member)? LoadComponent { get; set; }

    /// <summary><c>loadChildren</c>: el módulo importado y el miembro.</summary>
    public (string Spec, string? Member)? LoadChildren { get; set; }

    public bool HasChildren { get; set; }

    public RouteDecl? Parent { get; set; }

    public int Offset { get; set; }

    /// <summary><c>object</c> o <c>jsx</c>.</summary>
    public required string Origin { get; init; }

    /// <summary>Tiene algo más que <c>path</c>: así un objeto cualquiera con <c>path</c> no pasa por ruta.</summary>
    public bool HasPayload => Component is not null || LoadComponent is not null || LoadChildren is not null || HasChildren || Redirect || Index;
}

/// <summary>
/// Una llamada HTTP: método, ruta (con <c>{nombre}</c> por cada parte variable) o por qué no se pudo resolver. Con la
/// URL sin resolver, <see cref="Url"/> y <see cref="Options"/> guardan las expresiones tal como están escritas, para que
/// <see cref="FrontendSymbols"/> las evalúe con los parámetros de la función que la contiene (envoltorios, ADR-0016).
/// </summary>
internal sealed record HttpCall(string Method, string? Path, string? Unresolved, bool External, bool Relative, int Offset)
{
    /// <summary>Posición del token de la llamada.</summary>
    public int Index { get; init; }

    public IReadOnlyList<Token>? Url { get; init; }

    public IReadOnlyList<Token>? Options { get; init; }

    /// <summary><c>fetch</c>: el método sale de <see cref="Options"/>; si no, es el del nombre (<c>axios.post</c>, <c>http.get</c>).</summary>
    public bool MethodFromOptions { get; init; }

    /// <summary>Prefijo de la instancia de axios (<c>baseURL</c>); vacío si no hay.</summary>
    public string BaseUrl { get; init; } = "";
}

/// <summary>Una navegación a otra pantalla (<c>Link to</c>, <c>navigate()</c>, <c>routerLink</c>…), con la ruta destino.</summary>
internal sealed record NavigationTarget(string Path, int Offset)
{
    /// <summary>Posición del token (para saber en qué función está); -1 en una plantilla HTML de Angular.</summary>
    public int Index { get; init; } = -1;
}

/// <summary>Una navegación cuyo destino no es literal en ese lugar (<c>navigate(appPath(id))</c>): se evalúa después con <see cref="FrontendSymbols"/>.</summary>
internal sealed record NavigationSite(IReadOnlyList<Token> Expression, int Offset, int Index);

/// <summary>
/// Una función con nombre: de primer nivel (<c>function X</c>, <c>const X = (…) =&gt;</c>), un método de una clase o una
/// función de un objeto de primer nivel (<c>const api = { listar: () =&gt; … }</c>), con <see cref="Container"/> = la
/// clase o el objeto. <see cref="Params"/> lleva null en un parámetro desestructurado. El cuerpo va de
/// <see cref="BodyStart"/> a <see cref="BodyEnd"/> (posiciones de token, sin incluir el final); con
/// <see cref="Expression"/>, es la expresión que devuelve.
/// </summary>
internal sealed record FunctionInfo(string Name, string? Container, IReadOnlyList<string?> Params, int BodyStart, int BodyEnd, bool Expression, int Offset)
{
    public string FullName => Container is null ? Name : Container + "." + Name;
}

/// <summary>Una llamada por nombre (<c>f(…)</c>) o a un miembro (<c>obj.m(…)</c>, <c>this.servicio.m(…)</c>, con <see cref="Receiver"/>).</summary>
internal sealed record CallSite(string Callee, string? Receiver, int Index, int Open, int Offset);

/// <summary>Un componente que el código dibuja (<c>&lt;FeatureCard … /&gt;</c>).</summary>
internal sealed record JsxUse(string Name, int Offset, int Index);

/// <summary>
/// Lo que el escáner ve en un archivo de TypeScript o JavaScript (ADR-0013, opción a): importaciones, exportaciones,
/// rutas declaradas, llamadas HTTP con URL verificable y navegación. Patrones sobre tokens, no un árbol completo: lo
/// que no encaja (una URL que llega como variable, una ruta calculada) queda como no resuelto, nunca se inventa.
/// </summary>
internal sealed partial class ScriptFacts
{
    private static readonly string[] HttpMethods = ["get", "post", "put", "patch", "delete"];
    private static readonly HashSet<string> TypeNames = ["string", "String", "any", "unknown", "number", "never"];
    private static readonly HashSet<string> RouteKeys = ["path", "component", "Component", "element", "redirectTo", "index", "loadComponent", "loadChildren", "lazy", "children"];

    private readonly IReadOnlyList<Token> tokens;

    private ScriptFacts(IReadOnlyList<Token> tokens, bool hasErrors)
    {
        this.tokens = tokens;
        HasErrors = hasErrors;
    }

    public bool HasErrors { get; }

    /// <summary>Nombre local importado → módulo (<c>import { A as B } from 'x'</c> da B → x).</summary>
    public Dictionary<string, string> Imports { get; } = new(StringComparer.Ordinal);

    /// <summary>Nombre local → nombre que exporta el módulo, cuando difieren (<c>import { A as B }</c> da B → A).</summary>
    public Dictionary<string, string> ImportAliases { get; } = new(StringComparer.Ordinal);

    /// <summary>Todos los módulos importados (también <c>export … from</c> e <c>import('x')</c>).</summary>
    public List<string> ImportSpecs { get; } = [];

    public HashSet<string> Exports { get; } = new(StringComparer.Ordinal);

    /// <summary><c>export { A } from './a'</c> (nombre) y <c>export * from './b'</c> (null): para seguir un archivo índice.</summary>
    public List<(string? Name, string Spec)> ReExports { get; } = [];

    public Dictionary<string, string> Constants { get; } = new(StringComparer.Ordinal);

    public List<RouteDecl> Routes { get; } = [];

    public List<HttpCall> Http { get; } = [];

    public List<NavigationTarget> Navigations { get; } = [];

    /// <summary>Navegaciones con un destino que no se resolvió en el archivo (funciones de rutas, variables).</summary>
    public List<NavigationSite> NavigationSites { get; } = [];

    /// <summary>Funciones con nombre (de primer nivel, métodos y funciones de objetos), en orden.</summary>
    public List<FunctionInfo> Functions { get; } = [];

    /// <summary>Todas las llamadas con nombre del archivo, en orden.</summary>
    public List<CallSite> Calls { get; } = [];

    public List<JsxUse> JsxUses { get; } = [];

    /// <summary>Campos con tipo de cada clase (<c>private pedidos: PedidosService</c>, <c>http = inject(HttpClient)</c>): clase → campo → tipo.</summary>
    public Dictionary<string, Dictionary<string, string>> Fields { get; } = new(StringComparer.Ordinal);

    /// <summary>Constantes de primer nivel con valor no literal (<c>const baseUrl = import.meta.env.X ?? '…'</c>): sirven de base de una URL.</summary>
    public HashSet<string> ModuleBindings { get; } = new(StringComparer.Ordinal);

    /// <summary>Instancias de <c>axios.create</c> del archivo: nombre → <c>baseURL</c> literal (vacío sin él; null si no es literal).</summary>
    public IReadOnlyDictionary<string, string?> AxiosInstances => axiosInstances;

    public IReadOnlyList<Token> Tokens => tokens;

    /// <summary>La función con nombre más interna que contiene la posición de token <paramref name="index"/>, o null.</summary>
    public FunctionInfo? FunctionAt(int index) =>
        Functions.Where(f => f.BodyStart <= index && index < f.BodyEnd).MaxBy(f => f.BodyStart);

    /// <summary>
    /// Declaraciones de primer nivel (<c>function X</c>, <c>const X =</c>, <c>class X</c>) con dónde empiezan y hasta
    /// dónde llegan (la siguiente de primer nivel): para saber qué componente hace una llamada cuando un archivo tiene varios.
    /// </summary>
    public List<(string Name, int Start, int End)> Declarations { get; } = [];

    /// <summary>La declaración de primer nivel que contiene esa posición, o null (código suelto del módulo).</summary>
    public string? EnclosingDeclaration(int offset) =>
        Declarations.LastOrDefault(d => d.Start <= offset && offset < d.End).Name;

    /// <summary><c>templateUrl</c> de un componente de Angular.</summary>
    public List<string> TemplateUrls { get; } = [];

    /// <summary>Plantillas en línea (<c>template: `…`</c>) con su posición.</summary>
    public List<(string Html, int Offset)> InlineTemplates { get; } = [];

    /// <summary>Importa un enrutador (<c>react-router</c>, <c>react-router-dom</c>, <c>@angular/router</c>).</summary>
    public bool RouterImport { get; private set; }

    /// <summary>Llama a <c>RouterModule.forChild</c> (rutas de un módulo de Angular que se monta en otra ruta).</summary>
    public bool ForChild { get; private set; }

    /// <summary>Decorado con <c>@Injectable</c> o <c>@Component</c> (Angular).</summary>
    public bool Injectable { get; private set; }

    public bool Component { get; private set; }

    public static ScriptFacts Read(string text, bool jsx)
    {
        var (tokens, hasErrors) = TsLexer.Lex(text, jsx);
        var facts = new ScriptFacts(tokens, hasErrors);
        facts.ReadDeclarations();
        facts.ReadTopLevel(text.Length);
        facts.ReadFunctions();
        if (facts.RouterImport)
        {
            facts.ReadRouteObjects();
        }

        facts.ReadJsxRoutes();
        facts.ReadCallsAndNavigation();
        return facts;
    }

    private Token? At(int i) => i >= 0 && i < tokens.Count ? tokens[i] : null;

    // ---------- Declaraciones ----------

    private readonly HashSet<string> httpFields = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string?> axiosInstances = new(StringComparer.Ordinal);
    private readonly HashSet<string> navigateFunctions = new(StringComparer.Ordinal);
    private readonly HashSet<string> routerObjects = new(StringComparer.Ordinal);

    private void ReadDeclarations()
    {
        var httpClient = false;
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t.Kind != TokenKind.Identifier)
            {
                continue;
            }

            switch (t.Text)
            {
                case "import" when At(i + 1)?.Is("(") == true && At(i + 2) is { Kind: TokenKind.String } dynamic:
                    ImportSpecs.Add(dynamic.Text);
                    break;
                case "import" or "export":
                    ReadImport(i);
                    break;
                case "const" or "let" or "var" when At(i + 1) is { Kind: TokenKind.Identifier } name && At(i + 2)?.Is("=") == true:
                    ReadConstant(name.Text, i + 3);
                    break;
                case "HttpClient":
                    httpClient = true;
                    // private http: HttpClient · http = inject(HttpClient)
                    if (At(i - 1)?.Is(":") == true && At(i - 2) is { Kind: TokenKind.Identifier } field)
                    {
                        httpFields.Add(field.Text);
                    }
                    else if (At(i - 1)?.Is("(") == true && At(i - 2)?.IsIdentifier("inject") == true && At(i - 3)?.Is("=") == true
                             && At(i - 4) is { Kind: TokenKind.Identifier } injected)
                    {
                        httpFields.Add(injected.Text);
                    }

                    break;
                case "Router" when At(i - 1)?.Is(":") == true && At(i - 2) is { Kind: TokenKind.Identifier } routerField:
                    routerObjects.Add(routerField.Text);
                    break;
                case "Router" when At(i - 1)?.Is("(") == true && At(i - 2)?.IsIdentifier("inject") == true && At(i - 4) is { Kind: TokenKind.Identifier } injectedRouter:
                    routerObjects.Add(injectedRouter.Text);
                    break;
                case "forChild" when At(i - 1)?.Is(".") == true:
                    ForChild = true;
                    break;
                case "@Injectable":
                    Injectable = true;
                    break;
                case "@Component":
                    Component = true;
                    break;
                case "templateUrl" when At(i + 1)?.Is(":") == true && At(i + 2) is { Kind: TokenKind.String } url:
                    TemplateUrls.Add(url.Text);
                    break;
                case "template" when At(i + 1)?.Is(":") == true && At(i + 2) is { Kind: TokenKind.Template or TokenKind.String } inline:
                    InlineTemplates.Add((inline.Kind == TokenKind.String ? inline.Text : inline.Template!.Head, inline.Offset));
                    break;
            }
        }

        if (!httpClient)
        {
            httpFields.Clear(); // sin HttpClient, «http.get» es otra cosa
        }
    }

    private void ReadTopLevel(int length)
    {
        var depth = 0;
        var starts = new List<(string Name, int Start)>();
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t.Kind == TokenKind.Punct && t.Text is "{" or "(" or "[")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is "}" or ")" or "]")
            {
                depth = Math.Max(0, depth - 1);
            }
            else if (depth == 0 && t.Kind == TokenKind.Identifier && t.Text is "function" or "class" or "const" or "let" or "var"
                     && At(i + 1) is { Kind: TokenKind.Identifier } name)
            {
                // export default function X / export const X / class X: empieza en la palabra clave (o en «export»).
                var start = At(i - 1)?.IsIdentifier("export") == true ? tokens[i - 1].Offset
                    : At(i - 1)?.IsIdentifier("default") == true && At(i - 2)?.IsIdentifier("export") == true ? tokens[i - 2].Offset
                    : t.Offset;
                starts.Add((name.Text, start));
            }
            else if (depth == 0 && t.Kind == TokenKind.Identifier && t.Text.StartsWith('@'))
            {
                // Un decorador (@Component) pertenece a la clase que sigue: lo que hay en él es de esa clase.
                var next = tokens.Skip(i + 1).Select((x, k) => (x, k)).FirstOrDefault(p => p.x.IsIdentifier("class"));
                if (next.x is not null && At(i + 1 + next.k + 1) is { Kind: TokenKind.Identifier } cls)
                {
                    starts.Add((cls.Text, t.Offset));
                    i += next.k + 1;
                }
            }
        }

        for (var k = 0; k < starts.Count; k++)
        {
            Declarations.Add((starts[k].Name, starts[k].Start, k + 1 < starts.Count ? starts[k + 1].Start : length));
        }
    }

    // ---------- Funciones con nombre (ADR-0016) ----------

    private static readonly HashSet<string> Modifiers =
        ["public", "private", "protected", "static", "async", "readonly", "override", "abstract", "get", "set", "declare"];

    private static readonly HashSet<string> NotCallees =
        ["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "new", "super", "import", "delete", "void", "in", "of", "instanceof", "yield", "case", "do", "else", "throw"];

    /// <summary>
    /// Funciones de primer nivel, métodos de clases y funciones de objetos de primer nivel, con sus parámetros y su
    /// cuerpo; y los campos con tipo de cada clase. Solo la forma: lo que no encaja no es una función.
    /// </summary>
    private void ReadFunctions()
    {
        var depth = 0;
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t.Kind == TokenKind.Punct && t.Text is "{" or "(" or "[")
            {
                depth++;
                continue;
            }

            if (t.Kind == TokenKind.Punct && t.Text is "}" or ")" or "]")
            {
                depth = Math.Max(0, depth - 1);
                continue;
            }

            if (depth != 0 || t.Kind != TokenKind.Identifier)
            {
                continue;
            }

            if (t.Text == "function" && At(i + 1) is { Kind: TokenKind.Identifier } fname && At(i - 1)?.Is(".") != true)
            {
                if (ParseFunction(fname.Text, null, SkipGeneric(i + 2), fname.Offset) is { } f)
                {
                    Functions.Add(f);
                }
            }
            else if (t.Text is "const" or "let" or "var" && At(i + 1) is { Kind: TokenKind.Identifier } cname)
            {
                // const X: Tipo = valor: el valor empieza después del primer «=» de primer nivel.
                var eq = i + 2;
                var d = 0;
                while (At(eq) is { } e && !(d == 0 && e.Is("=")) && !(d == 0 && (e.Is(";") || e.Is(","))))
                {
                    if (e.Kind == TokenKind.Punct && e.Text is "(" or "[" or "{" or "<")
                    {
                        d++;
                    }
                    else if (e.Kind == TokenKind.Punct && e.Text is ")" or "]" or "}" or ">")
                    {
                        d--;
                    }

                    eq++;
                }

                if (At(eq)?.Is("=") != true)
                {
                    continue;
                }

                var value = eq + 1;
                if (At(value)?.IsIdentifier("async") == true)
                {
                    value++;
                }

                if (At(value)?.IsIdentifier("function") == true)
                {
                    var open = At(value + 1) is { Kind: TokenKind.Identifier } ? value + 2 : value + 1;
                    if (ParseFunction(cname.Text, null, SkipGeneric(open), cname.Offset) is { } f)
                    {
                        Functions.Add(f);
                    }
                }
                else if (ArrowAt(SkipGeneric(value)) is { } arrow)
                {
                    Functions.Add(arrow with { Name = cname.Text, Offset = cname.Offset });
                }
                else if (At(value)?.Is("{") == true)
                {
                    ReadObjectFunctions(cname.Text, value);
                }
                else if (!Constants.ContainsKey(cname.Text))
                {
                    ModuleBindings.Add(cname.Text);
                }
            }
            else if (t.Text == "class" && At(i + 1) is { Kind: TokenKind.Identifier } klass)
            {
                var open = i + 2;
                while (At(open) is { } o && !o.Is("{"))
                {
                    open++;
                }

                if (At(open) is not null)
                {
                    ReadClass(klass.Text, open);
                }
            }
        }
    }

    /// <summary><c>function X(params) [: tipo] { … }</c> desde el paréntesis que abre.</summary>
    private FunctionInfo? ParseFunction(string name, string? container, int open, int offset)
    {
        if (At(open)?.Is("(") != true)
        {
            return null;
        }

        var close = Matching(open);
        if (close < 0)
        {
            return null;
        }

        var body = BodyBrace(close + 1);
        if (body < 0)
        {
            return null;
        }

        var end = Matching(body);
        return end < 0 ? null : new FunctionInfo(name, container, Params(open, close), body + 1, end, false, offset);
    }

    /// <summary><c>(params) [: tipo] =&gt; cuerpo</c> o <c>param =&gt; cuerpo</c> en <paramref name="start"/>.</summary>
    private FunctionInfo? ArrowAt(int start)
    {
        IReadOnlyList<string?> parameters;
        int after;
        if (At(start) is { Kind: TokenKind.Identifier } single && At(start + 1)?.Is("=>") == true)
        {
            parameters = [single.Text];
            after = start + 1;
        }
        else if (At(start)?.Is("(") == true && Matching(start) is var close and >= 0)
        {
            after = close + 1;
            if (At(after)?.Is(":") == true)
            {
                // Tipo de retorno: hasta la flecha de primer nivel.
                var d = 0;
                while (At(after) is { } a && !(d == 0 && a.Is("=>")))
                {
                    if (a.Kind == TokenKind.Punct && a.Text is "(" or "[" or "{" or "<")
                    {
                        d++;
                    }
                    else if (a.Kind == TokenKind.Punct && a.Text is ")" or "]" or "}" or ">")
                    {
                        d--;
                    }

                    after++;
                }
            }

            if (At(after)?.Is("=>") != true)
            {
                return null;
            }

            parameters = Params(start, close);
        }
        else
        {
            return null;
        }

        var bodyStart = after + 1;
        if (At(bodyStart)?.Is("{") == true)
        {
            var end = Matching(bodyStart);
            return end < 0 ? null : new FunctionInfo("", null, parameters, bodyStart + 1, end, false, tokens[start].Offset);
        }

        // Cuerpo de expresión: hasta «;», «,» o el cierre de primer nivel.
        var j = bodyStart;
        var depth = 0;
        while (At(j) is { } x)
        {
            if (x.Kind == TokenKind.Punct && x.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (x.Kind == TokenKind.Punct && x.Text is ")" or "]" or "}")
            {
                if (depth == 0)
                {
                    break;
                }

                depth--;
            }
            else if (depth == 0 && (x.Is(";") || x.Is(",")))
            {
                break;
            }
            else if (depth == 0 && j > bodyStart && x.Kind == TokenKind.Identifier && x.Text is "export" or "const" or "function" or "class" or "let" && tokens[j - 1].Kind != TokenKind.Punct)
            {
                break;
            }

            j++;
        }

        return j > bodyStart ? new FunctionInfo("", null, parameters, bodyStart, j, true, tokens[start].Offset) : null;
    }

    /// <summary>La llave del cuerpo después de los parámetros, saltando un tipo de retorno (también <c>: { … }</c>).</summary>
    private int BodyBrace(int from)
    {
        var j = from;
        var depth = 0;
        while (At(j) is { } t)
        {
            if (t.Is("{"))
            {
                // Un tipo objeto (`: { a: b }`, `Promise<{ a; b }>`) se salta entero; la primera llave fuera de un tipo es el cuerpo.
                var before = At(j - 1);
                if (depth > 0 || (before is not null && (before.Is(":") || before.Is("|") || before.Is("&") || before.Is(",") || before.Is("<"))))
                {
                    var end = Matching(j);
                    if (end < 0)
                    {
                        return -1;
                    }

                    j = end + 1;
                    continue;
                }

                return j;
            }

            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "<")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or ">")
            {
                depth--;
            }
            else if (t.Is(";") || t.Is("=>") || (depth == 0 && t.Is("=")))
            {
                return -1;
            }

            j++;
            if (j - from > 200)
            {
                return -1;
            }
        }

        return -1;
    }

    /// <summary>Nombres de los parámetros entre <paramref name="open"/> y <paramref name="close"/> (null si se desestructura).</summary>
    private List<string?> Params(int open, int close)
    {
        var result = new List<string?>();
        foreach (var part in Split(tokens, open + 1, close))
        {
            var k = 0;
            while (k < part.Count && (part[k].Kind == TokenKind.Identifier && Modifiers.Contains(part[k].Text) || part[k].Is("...") || part[k].Text.StartsWith('@')))
            {
                k++;
            }

            result.Add(k < part.Count && part[k].Kind == TokenKind.Identifier ? part[k].Text : null);
        }

        return result;
    }

    /// <summary>Funciones de un objeto de primer nivel: <c>listar: (…) =&gt; …</c>, <c>listar(…) { … }</c>, <c>listar: function (…) { … }</c>.</summary>
    private void ReadObjectFunctions(string container, int open)
    {
        var close = Matching(open);
        if (close < 0)
        {
            return;
        }

        for (var j = open + 1; j < close; j++)
        {
            // Solo las propiedades de primer nivel del objeto.
            if (tokens[j].Kind == TokenKind.Punct && tokens[j].Text is "(" or "[" or "{")
            {
                var end = Matching(j);
                if (end < 0)
                {
                    return;
                }

                if (tokens[j].Is("(") && At(j - 1) is { Kind: TokenKind.Identifier } method && (At(j - 2) is null || At(j - 2)!.Is(",") || At(j - 2)!.Is("{") || At(j - 2)!.IsIdentifier("async")))
                {
                    if (ParseFunction(method.Text, container, j, method.Offset) is { } f)
                    {
                        Functions.Add(f);
                    }
                }

                j = end;
                continue;
            }

            if (tokens[j].Kind is TokenKind.Identifier or TokenKind.String && At(j + 1)?.Is(":") == true && (At(j - 1)?.Is(",") == true || At(j - 1)?.Is("{") == true))
            {
                var value = j + 2;
                if (At(value)?.IsIdentifier("async") == true)
                {
                    value++;
                }

                if (At(value)?.IsIdentifier("function") == true && ParseFunction(tokens[j].Text, container, value + 1, tokens[j].Offset) is { } f)
                {
                    Functions.Add(f);
                }
                else if (ArrowAt(value) is { } arrow)
                {
                    Functions.Add(arrow with { Name = tokens[j].Text, Container = container, Offset = tokens[j].Offset });
                }
            }
        }
    }

    /// <summary>Métodos y campos con tipo de una clase (también los parámetros del constructor con modificador).</summary>
    private void ReadClass(string name, int open)
    {
        var close = Matching(open);
        if (close < 0)
        {
            return;
        }

        var fields = Fields.TryGetValue(name, out var existing) ? existing : Fields[name] = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var j = open + 1; j < close; j++)
        {
            var t = tokens[j];
            if (t.Is("(") && At(j - 1) is { Kind: TokenKind.Identifier } method && !NotCallees.Contains(method.Text) && !method.Text.StartsWith('@')
                && (At(j - 2) is not { } before || before.Is("{") || before.Is("}") || before.Is(";") || (before.Kind == TokenKind.Identifier && Modifiers.Contains(before.Text))))
            {
                var paramsClose = Matching(j);
                if (paramsClose < 0)
                {
                    return;
                }

                if (method.Text == "constructor")
                {
                    // constructor(private pedidos: PedidosService, readonly http: HttpClient)
                    foreach (var part in Split(tokens, j + 1, paramsClose))
                    {
                        if (part.Count >= 3 && part[0].Kind == TokenKind.Identifier && Modifiers.Contains(part[0].Text))
                        {
                            var k = 0;
                            while (k < part.Count && part[k].Kind == TokenKind.Identifier && Modifiers.Contains(part[k].Text))
                            {
                                k++;
                            }

                            if (k + 2 < part.Count && part[k].Kind == TokenKind.Identifier && part[k + 1].Is(":") && part[k + 2].Kind == TokenKind.Identifier)
                            {
                                fields[part[k].Text] = part[k + 2].Text;
                            }
                        }
                    }
                }

                var body = BodyBrace(paramsClose + 1);
                if (body >= 0 && Matching(body) is var end and >= 0)
                {
                    if (method.Text != "constructor")
                    {
                        Functions.Add(new FunctionInfo(method.Text, name, Params(j, paramsClose), body + 1, end, false, method.Offset));
                    }

                    j = end;
                }
                else
                {
                    j = paramsClose;
                }

                continue;
            }

            // campo: Tipo · campo = inject(Tipo) · campo = new Tipo(
            if (t.Kind == TokenKind.Identifier && (At(j - 1) is not { } prev || prev.Is(";") || prev.Is("{") || prev.Is("}") || (prev.Kind == TokenKind.Identifier && Modifiers.Contains(prev.Text))))
            {
                if (At(j + 1)?.Is(":") == true && At(j + 2) is { Kind: TokenKind.Identifier } type)
                {
                    fields[t.Text] = type.Text;
                }
                else if (At(j + 1)?.Is("=") == true && At(j + 2)?.IsIdentifier("inject") == true && At(j + 3)?.Is("(") == true && At(j + 4) is { Kind: TokenKind.Identifier } injected)
                {
                    fields[t.Text] = injected.Text;
                }
                else if (At(j + 1)?.Is("=") == true && At(j + 2)?.IsIdentifier("new") == true && At(j + 3) is { Kind: TokenKind.Identifier } created)
                {
                    fields[t.Text] = created.Text;
                }
            }

            if (t.Kind == TokenKind.Punct && t.Text is "{" or "[" && Matching(j) is var skip and >= 0)
            {
                j = skip;
            }
        }
    }

    /// <summary><c>import … from 'x'</c>, <c>export … from 'x'</c> y las exportaciones con nombre del archivo.</summary>
    private void ReadImport(int i)
    {
        var keyword = tokens[i].Text;
        if (keyword == "export")
        {
            var next = At(i + 1);
            var j = i + 1;
            if (next?.IsIdentifier("default") == true)
            {
                j++;
                if (At(j) is { Kind: TokenKind.Identifier } d && d.Text is not ("function" or "class" or "async"))
                {
                    Exports.Add(d.Text);
                    Exports.Add("default");
                    return;
                }

                Exports.Add("default");
            }

            while (At(j) is { Kind: TokenKind.Identifier } w && w.Text is "async" or "function" or "class" or "const" or "let" or "var" or "abstract")
            {
                j++;
            }

            if (j > i + 1 && At(j) is { Kind: TokenKind.Identifier } exported)
            {
                Exports.Add(exported.Text);
                return;
            }
        }

        // Nombres hasta «from 'x'» (o el módulo directo: import 'x').
        var names = new List<string>();
        var originals = new Dictionary<string, string>(StringComparer.Ordinal);
        var depth = 0;
        for (var j = i + 1; j < tokens.Count && j < i + 200; j++)
        {
            var t = tokens[j];
            if (t.Is("{"))
            {
                depth++;
            }
            else if (t.Is("}"))
            {
                depth--;
            }
            else if (t.Kind == TokenKind.String && (t.Offset > 0 && At(j - 1)?.IsIdentifier("from") == true || j == i + 1))
            {
                ImportSpecs.Add(t.Text);
                if (t.Text is "react-router" or "react-router-dom" or "@angular/router")
                {
                    RouterImport = true;
                }

                if (keyword == "import")
                {
                    foreach (var name in names)
                    {
                        Imports[name] = t.Text;
                        if (originals.TryGetValue(name, out var original))
                        {
                            ImportAliases[name] = original;
                        }
                    }
                }
                else if (names.Count == 0)
                {
                    ReExports.Add((null, t.Text));
                }
                else
                {
                    ReExports.AddRange(names.Select(n => ((string?)n, t.Text)));
                }

                return;
            }
            else if (t.Is(";") || (t.Kind == TokenKind.Identifier && t.Text is "import" or "export" or "const" or "function" or "class"))
            {
                return;
            }
            else if (t.Kind == TokenKind.Identifier && t.Text is not ("from" or "type" or "as" or "default"))
            {
                // import { A as B }: el nombre local es el que sigue a «as».
                if (At(j - 1)?.IsIdentifier("as") == true && names.Count > 0)
                {
                    if (depth > 0)
                    {
                        originals[t.Text] = names[^1];
                    }

                    names[^1] = t.Text;
                }
                else if (depth > 0 || At(j - 1) is { } before && (before.IsIdentifier("import") || before.Is(",") || before.Is("*") || before.IsIdentifier("as")))
                {
                    names.Add(t.Text);
                }
            }
        }
    }

    /// <summary><c>const X = 'literal'</c>, <c>const api = axios.create({ baseURL })</c>, <c>const navigate = useNavigate()</c>.</summary>
    private void ReadConstant(string name, int value)
    {
        var v = At(value);
        if (v is null)
        {
            return;
        }

        var after = At(value + 1);
        var ends = after is null || after.Is(";") || after.Is(",") || after.Is(")") || after.Kind is TokenKind.Identifier;
        if (v.Kind == TokenKind.String && ends)
        {
            Constants[name] = v.Text;
        }
        else if (v.Kind == TokenKind.Template && v.Template!.Spans.Count == 0 && ends)
        {
            Constants[name] = v.Template.Head;
        }
        else if (v.IsIdentifier("axios") && after?.Is(".") == true && At(value + 2)?.IsIdentifier("create") == true)
        {
            string? baseUrl = "";
            for (var j = value + 3; j < tokens.Count && !tokens[j].Is(")"); j++)
            {
                if (tokens[j].IsIdentifier("baseURL") && At(j + 1)?.Is(":") == true)
                {
                    baseUrl = At(j + 2) is { Kind: TokenKind.String } literal ? literal.Text : null;
                    break;
                }
            }

            axiosInstances[name] = baseUrl;
        }
        else if (v.IsIdentifier("useNavigate"))
        {
            navigateFunctions.Add(name);
        }
        else if (v.IsIdentifier("useRouter"))
        {
            routerObjects.Add(name);
        }
    }

    // ---------- Rutas en objetos ----------

    private sealed class Frame
    {
        public required string Kind { get; init; }

        public Frame? Parent { get; init; }

        public string? OpenedByKey { get; init; }

        public string? CurrentKey { get; set; }

        public bool ExpectKey { get; set; }

        public RouteDecl? Route { get; set; }
    }

    /// <summary>
    /// Objetos con <c>path</c> en un archivo que importa un enrutador: <c>createBrowserRouter([…])</c>,
    /// <c>const routes: Routes = […]</c>, <c>RouterModule.forRoot/forChild([…])</c>, <c>provideRouter</c>. Los hijos van por
    /// <c>children</c>. Un objeto cuenta como ruta si además de <c>path</c> tiene componente, carga diferida, hijos,
    /// redirección o <c>index</c>.
    /// </summary>
    private void ReadRouteObjects()
    {
        var stack = new Stack<Frame>();
        var candidates = new List<RouteDecl>();
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            var top = stack.Count > 0 ? stack.Peek() : null;
            if (t.Kind == TokenKind.Punct && t.Text is "{" or "[" or "(")
            {
                var frame = new Frame
                {
                    Kind = t.Text,
                    Parent = top,
                    OpenedByKey = top?.Kind == "{" ? top.CurrentKey : null,
                    ExpectKey = t.Text == "{",
                };
                if (t.Text == "{")
                {
                    // El padre de una ruta hija: el objeto que tiene «children: [ … ]».
                    var parent = top?.Kind == "[" && top.OpenedByKey == "children" ? top.Parent?.Route : null;
                    frame.Route = new RouteDecl { Origin = "object", Offset = t.Offset, Parent = parent };
                    candidates.Add(frame.Route);
                }

                stack.Push(frame);
                continue;
            }

            if (t.Kind == TokenKind.Punct && t.Text is "}" or "]" or ")")
            {
                if (stack.Count > 0)
                {
                    stack.Pop();
                }

                continue;
            }

            if (top is not { Kind: "{" })
            {
                continue;
            }

            if (t.Is(","))
            {
                top.ExpectKey = true;
                top.CurrentKey = null;
                continue;
            }

            if (!top.ExpectKey || t.Kind is not (TokenKind.Identifier or TokenKind.String) || At(i + 1)?.Is(":") != true)
            {
                continue;
            }

            top.ExpectKey = false;
            top.CurrentKey = t.Text;
            if (!RouteKeys.Contains(t.Text))
            {
                continue;
            }

            if (top.Route is not { } route)
            {
                continue;
            }

            var value = At(i + 2);
            switch (t.Text)
            {
                case "path":
                    route.Offset = t.Offset;
                    if (value is { Kind: TokenKind.String })
                    {
                        route.Path = value.Text;
                    }
                    else if (value is { Kind: TokenKind.Template } && value.Template!.Spans.Count == 0)
                    {
                        route.Path = value.Template.Head;
                    }
                    else if (value is { Kind: TokenKind.Identifier } && TypeNames.Contains(value.Text))
                    {
                        // { path: string, … } es un tipo de TypeScript, no una ruta.
                        top.Route = null;
                        candidates.Remove(route);
                    }
                    else if (value is { Kind: TokenKind.Identifier } && Constants.TryGetValue(value.Text, out var constant))
                    {
                        route.Path = constant;
                    }
                    else if (value is not null)
                    {
                        route.Dynamic = value.Kind == TokenKind.Template ? "`…`" : value.Text;
                        route.DynamicName = value.Kind == TokenKind.Identifier && At(i + 3) is { } next && (next.Is(",") || next.Is("}")) ? value.Text : null;
                    }

                    break;
                case "component" or "Component" when value is { Kind: TokenKind.Identifier }:
                    route.Component = value.Text;
                    break;
                case "element" when FirstJsx(i + 2) is { } element:
                    route.Component = element;
                    break;
                case "redirectTo":
                    route.Redirect = true;
                    break;
                case "index" when value?.IsIdentifier("true") == true:
                    route.Index = true;
                    break;
                case "children":
                    route.HasChildren = true;
                    break;
                case "loadComponent" or "lazy":
                    route.LoadComponent = LazyImport(i + 2);
                    break;
                case "loadChildren":
                    route.LoadChildren = LazyImport(i + 2);
                    break;
            }
        }

        // Un objeto con path y algo más, o hijo de una ruta. Los demás objetos del archivo no son rutas.
        foreach (var route in candidates)
        {
            if ((route.Path is not null || route.Dynamic is not null || route.Index) && (route.HasPayload || route.Parent is not null))
            {
                Routes.Add(route);
            }
        }
    }

    /// <summary>La primera etiqueta JSX del valor (<c>element: &lt;X /&gt;</c> o <c>element: (&lt;X&gt;…&lt;/X&gt;)</c>).</summary>
    private string? FirstJsx(int start)
    {
        for (var j = start; j < tokens.Count && j < start + 4; j++)
        {
            if (tokens[j].Kind == TokenKind.JsxOpen)
            {
                return tokens[j].Text;
            }

            if (!tokens[j].Is("("))
            {
                return null;
            }
        }

        return null;
    }

    /// <summary><c>() =&gt; import('./x').then((m) =&gt; m.X)</c>: el módulo y el miembro, leídos hasta la coma o llave que cierra el valor.</summary>
    private (string Spec, string? Member)? LazyImport(int start)
    {
        string? spec = null;
        string? member = null;
        var depth = 0;
        for (var j = start; j < tokens.Count && j < start + 80; j++)
        {
            var t = tokens[j];
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "{" or "[")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "}" or "]")
            {
                if (depth == 0)
                {
                    break;
                }

                depth--;
            }
            else if (t.Is(",") && depth == 0)
            {
                break;
            }
            else if (t.IsIdentifier("import") && At(j + 1)?.Is("(") == true && At(j + 2) is { Kind: TokenKind.String } module)
            {
                spec = module.Text;
            }
            else if (spec is not null && t.Is(".") && At(j + 1) is { Kind: TokenKind.Identifier } m && m.Text != "then")
            {
                member = m.Text;
            }
        }

        return spec is null ? null : (spec, member);
    }

    // ---------- Rutas en JSX ----------

    private void ReadJsxRoutes()
    {
        var open = new Stack<RouteDecl>();
        foreach (var t in tokens)
        {
            if (t.Kind == TokenKind.JsxClose && t.Text == "Route")
            {
                if (open.Count > 0)
                {
                    open.Pop();
                }

                continue;
            }

            if (t.Kind != TokenKind.JsxOpen || t.Text != "Route")
            {
                continue;
            }

            var route = new RouteDecl { Origin = "jsx", Offset = t.Offset, Parent = open.Count > 0 ? open.Peek() : null };
            foreach (var attribute in t.Attributes!)
            {
                switch (attribute.Name)
                {
                    case "path" when attribute.Literal is not null:
                        route.Path = attribute.Literal;
                        break;
                    case "path" when attribute.Expression is [{ Kind: TokenKind.String } literal]:
                        route.Path = literal.Text;
                        break;
                    case "path" when attribute.Expression is [{ Kind: TokenKind.Identifier } name] && Constants.TryGetValue(name.Text, out var constant):
                        route.Path = constant;
                        break;
                    case "path":
                        route.Dynamic = attribute.Expression is { Count: > 0 } e ? e[0].Text : "?";
                        route.DynamicName = attribute.Expression is [{ Kind: TokenKind.Identifier } single] ? single.Text : null;
                        break;
                    case "element" when attribute.Expression?.FirstOrDefault(x => x.Kind == TokenKind.JsxOpen) is { } element:
                        route.Component = element.Text;
                        break;
                    case "Component" or "component" when attribute.Expression is [{ Kind: TokenKind.Identifier } component]:
                        route.Component = component.Text;
                        break;
                    case "index":
                        route.Index = attribute.Expression is null or [{ Text: "true" }];
                        break;
                    case "lazy":
                        route.LoadComponent = attribute.Expression is { } lazy ? FindImport(lazy) : null;
                        break;
                }
            }

            if (route.Path is not null || route.Dynamic is not null || route.Index)
            {
                Routes.Add(route);
            }

            if (!t.SelfClosing)
            {
                route.HasChildren = true;
                open.Push(route);
            }
        }
    }

    private static (string, string?)? FindImport(IReadOnlyList<Token> expression)
    {
        for (var j = 0; j + 2 < expression.Count; j++)
        {
            if (expression[j].IsIdentifier("import") && expression[j + 1].Is("(") && expression[j + 2].Kind == TokenKind.String)
            {
                return (expression[j + 2].Text, null);
            }
        }

        return null;
    }

    // ---------- Llamadas HTTP y navegación ----------

    private void ReadCallsAndNavigation()
    {
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t.Kind == TokenKind.JsxOpen && t.Text is "Link" or "NavLink" or "Navigate")
            {
                foreach (var attribute in t.Attributes!.Where(a => a.Name is "to" or "href"))
                {
                    var target = attribute.Literal ?? (attribute.Expression is { } e ? Url(e).Path : null);
                    if (target?.StartsWith('/') == true)
                    {
                        Navigations.Add(new NavigationTarget(target, t.Offset) { Index = i });
                    }
                    else if (attribute.Literal is null && attribute.Expression is { Count: > 0 } expression)
                    {
                        NavigationSites.Add(new NavigationSite(expression, t.Offset, i));
                    }
                }

                continue;
            }

            if (t.Kind == TokenKind.JsxOpen && t.Text.Length > 0 && char.IsUpper(t.Text[0]))
            {
                JsxUses.Add(new JsxUse(t.Text.Split('.')[0], t.Offset, i));
                continue;
            }

            if (t.Kind != TokenKind.Identifier || At(i - 1)?.Is(".") == true && !IsMemberCallee(i))
            {
                continue;
            }

            RecordCall(i);

            // fetch('/api/x', { method: 'POST' })
            if (t.Text == "fetch" && At(i - 1)?.Is(".") != true && At(i + 1)?.Is("(") == true)
            {
                var args = Arguments(i + 1);
                if (args.Count > 0)
                {
                    var method = args.Count > 1 ? FetchMethod(args[1]) : "GET";
                    AddCall(method, args, i, t.Offset, "", fromOptions: true);
                }

                continue;
            }

            // navigate('/x') de useNavigate
            if (navigateFunctions.Contains(t.Text) && At(i - 1)?.Is(".") != true && At(i + 1)?.Is("(") == true)
            {
                AddNavigation(Arguments(i + 1), t.Offset, i);
                continue;
            }

            if (At(i - 1)?.Is(".") != true || !IsMemberCallee(i))
            {
                continue;
            }

            var owner = Owner(i - 1);
            var callStart = SkipGeneric(i + 1);
            if (At(callStart)?.Is("(") != true)
            {
                continue;
            }

            // axios.get · api.get (axios.create) · this.http.get (HttpClient)
            if (HttpMethods.Contains(t.Text))
            {
                string? baseUrl = null;
                var client = owner == "axios"
                    || (axiosInstances.TryGetValue(owner, out baseUrl))
                    || httpFields.Contains(owner.StartsWith("this.", StringComparison.Ordinal) ? owner[5..] : owner);
                if (client)
                {
                    var args = Arguments(callStart);
                    if (args.Count > 0)
                    {
                        AddCall(t.Text.ToUpperInvariant(), args, i, t.Offset, owner == "axios" ? "" : baseUrl ?? (axiosInstances.ContainsKey(owner) ? null : ""), fromOptions: false);
                    }
                }

                continue;
            }

            var routerOwner = owner.StartsWith("this.", StringComparison.Ordinal) ? owner[5..] : owner;
            if (routerObjects.Contains(routerOwner) && t.Text is "push" or "replace" or "navigateByUrl")
            {
                AddNavigation(Arguments(callStart), t.Offset, i);
            }
            else if (routerObjects.Contains(routerOwner) && t.Text == "navigate" && Arguments(callStart) is [var commands, ..]
                     && commands is [{ } open, ..] && open.Is("["))
            {
                // this.router.navigate(['/pedidos', id]) → /pedidos/{}
                var parts = Split(commands, 1, commands.Count - 1);
                var path = string.Join('/', parts.Select(p => p is [{ Kind: TokenKind.String } s] ? s.Text.Trim('/') : "{}"));
                if (parts.Count > 0 && parts[0] is [{ Kind: TokenKind.String } first] && first.Text.StartsWith('/'))
                {
                    Navigations.Add(new NavigationTarget("/" + path, t.Offset) { Index = i });
                }
            }
        }
    }

    private bool IsMemberCallee(int i) => At(i - 1)?.Is(".") == true && At(i - 2) is { Kind: TokenKind.Identifier };

    /// <summary>El objeto de una llamada <c>a.b.c(…)</c>: <c>a.b</c>.</summary>
    private string Owner(int dot)
    {
        var parts = new List<string>();
        var j = dot - 1;
        while (At(j) is { Kind: TokenKind.Identifier } part)
        {
            parts.Insert(0, part.Text);
            if (At(j - 1)?.Is(".") != true)
            {
                break;
            }

            j -= 2;
        }

        return string.Join('.', parts);
    }

    /// <summary>Salta un genérico <c>&lt;Pedido[]&gt;</c> entre el método y el paréntesis.</summary>
    private int SkipGeneric(int i)
    {
        if (At(i)?.Is("<") != true)
        {
            return i;
        }

        var depth = 0;
        for (var j = i; j < tokens.Count && j < i + 60; j++)
        {
            if (tokens[j].Is("<"))
            {
                depth++;
            }
            else if (tokens[j].Is(">"))
            {
                depth--;
                if (depth == 0)
                {
                    return j + 1;
                }
            }
            else if (tokens[j].Kind == TokenKind.Punct && tokens[j].Text is ">>" or ">>>")
            {
                // Array<Map<string, Array<number>>>: el escáner los lee como un solo operador.
                depth -= tokens[j].Text.Length;
                if (depth <= 0)
                {
                    return j + 1;
                }
            }
        }

        return i;
    }

    /// <summary>Los argumentos de la llamada que abre en <paramref name="open"/>, separados por las comas de primer nivel.</summary>
    private List<List<Token>> Arguments(int open)
    {
        var end = Matching(open);
        return end < 0 ? [] : Split(tokens, open + 1, end);
    }

    private int Matching(int open)
    {
        var depth = 0;
        for (var j = open; j < tokens.Count; j++)
        {
            if (tokens[j].Kind == TokenKind.Punct && tokens[j].Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (tokens[j].Kind == TokenKind.Punct && tokens[j].Text is ")" or "]" or "}")
            {
                depth--;
                if (depth == 0)
                {
                    return j;
                }
            }
        }

        return -1;
    }

    private static List<List<Token>> Split(IReadOnlyList<Token> source, int from, int to)
    {
        var parts = new List<List<Token>>();
        var current = new List<Token>();
        var depth = 0;
        for (var j = from; j < to && j < source.Count; j++)
        {
            var t = source[j];
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
            }

            if (t.Is(",") && depth == 0)
            {
                parts.Add(current);
                current = [];
                continue;
            }

            current.Add(t);
        }

        if (current.Count > 0)
        {
            parts.Add(current);
        }

        return parts;
    }

    private static string FetchMethod(List<Token> options)
    {
        for (var j = 0; j + 2 < options.Count; j++)
        {
            if (options[j].IsIdentifier("method") && options[j + 1].Is(":") && options[j + 2].Kind == TokenKind.String)
            {
                return options[j + 2].Text.ToUpperInvariant();
            }
        }

        return "GET";
    }

    /// <summary>Una llamada con nombre (<c>f(…)</c>, <c>obj.m(…)</c>); no la declaración de un método (<c>m(…) {</c>).</summary>
    private void RecordCall(int i)
    {
        var name = tokens[i];
        if (NotCallees.Contains(name.Text) || name.Text.StartsWith('@') || At(i - 1)?.IsIdentifier("function") == true)
        {
            return;
        }

        var open = SkipGeneric(i + 1);
        if (At(open)?.Is("(") != true)
        {
            return;
        }

        // m(…) { … } o m(…): Tipo { … } (un método que se declara) no es una llamada.
        var close = Matching(open);
        var before = At(i - 1);
        var statementStart = before is null || before.Is("{") || before.Is("}") || before.Is(";") || (before.Kind == TokenKind.Identifier && Modifiers.Contains(before.Text));
        if (close >= 0 && before?.Is(".") != true && At(close + 1) is { } after && (after.Is("{") || (after.Is(":") && statementStart)))
        {
            return;
        }

        var receiver = At(i - 1)?.Is(".") == true ? Owner(i - 1) : null;
        Calls.Add(new CallSite(name.Text, receiver is { Length: > 0 } ? receiver : null, i, open, name.Offset));
    }

    private void AddCall(string method, List<List<Token>> args, int index, int offset, string? baseUrl, bool fromOptions)
    {
        var argument = args[0];
        var options = fromOptions && args.Count > 1 ? args[1] : null;
        if (baseUrl is null)
        {
            Http.Add(new HttpCall(method, null, "baseURL de axios.create no literal", false, false, offset) { Index = index });
            return;
        }

        var (path, unresolved) = Url(argument);
        if (path is null)
        {
            Http.Add(new HttpCall(method, null, unresolved, false, false, offset)
            {
                Index = index, Url = argument, Options = options, MethodFromOptions = fromOptions, BaseUrl = baseUrl,
            });
            return;
        }

        path = baseUrl.Length > 0 && !path.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? baseUrl.TrimEnd('/') + "/" + path.TrimStart('/') : path;
        if (path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("//", StringComparison.Ordinal))
        {
            Http.Add(new HttpCall(method, path, null, true, false, offset));
            return;
        }

        var relative = !path.StartsWith('/');
        if (relative && (path.StartsWith('.') || path.Contains(':', StringComparison.Ordinal) || path.Length == 0))
        {
            Http.Add(new HttpCall(method, null, path, false, false, offset));
            return;
        }

        Http.Add(new HttpCall(method, relative ? "/" + path : path, null, false, relative, offset)
        {
            Index = index, Url = argument, Options = options, MethodFromOptions = fromOptions, BaseUrl = baseUrl,
        });
    }

    private void AddNavigation(List<List<Token>> args, int offset, int index)
    {
        if (args.Count == 0)
        {
            return;
        }

        if (Url(args[0]).Path is { } target && target.StartsWith('/'))
        {
            Navigations.Add(new NavigationTarget(target, offset) { Index = index });
        }
        else if (args[0].Count > 0 && args[0][0].Kind != TokenKind.Number)
        {
            NavigationSites.Add(new NavigationSite(args[0], offset, index));
        }
    }

    /// <summary>
    /// La URL de una expresión: un literal, una constante del archivo, una plantilla o una suma de partes. Lo que empieza
    /// por algo que no se puede resolver no tiene URL (se devuelve qué era); una parte variable después de lo literal es
    /// un parámetro <c>{nombre}</c> (el nombre sale del código: <c>${pedido.id}</c> da <c>{id}</c>).
    /// </summary>
    private (string? Path, string? Unresolved) Url(IReadOnlyList<Token> expression)
    {
        var url = "";
        var operands = Split(expression, 0, expression.Count).SelectMany(part => SplitPlus(part)).ToList();
        if (operands.Count == 0)
        {
            return (null, "?");
        }

        foreach (var operand in operands)
        {
            if (operand is [{ Kind: TokenKind.String } s])
            {
                url += s.Text;
            }
            else if (operand is [{ Kind: TokenKind.Template } template])
            {
                var parts = template.Template!;
                url += parts.Head;
                foreach (var (inner, tail) in parts.Spans)
                {
                    if (url.Length == 0)
                    {
                        if (inner is [{ Kind: TokenKind.Identifier } c] && Constants.TryGetValue(c.Text, out var constant))
                        {
                            url = constant;
                        }
                        else
                        {
                            return (null, Describe(inner));
                        }
                    }
                    else
                    {
                        url += "{" + ParameterName(inner) + "}";
                    }

                    url += tail;
                }
            }
            else if (operand is [{ Kind: TokenKind.Identifier } id] && Constants.TryGetValue(id.Text, out var value))
            {
                url += value;
            }
            else if (url.Length == 0)
            {
                return (null, Describe(operand));
            }
            else
            {
                url += "{" + ParameterName(operand) + "}";
            }
        }

        return (url, null);
    }

    private static IEnumerable<List<Token>> SplitPlus(List<Token> expression)
    {
        var current = new List<Token>();
        var depth = 0;
        foreach (var t in expression)
        {
            if (t.Kind == TokenKind.Punct && t.Text is "(" or "[" or "{")
            {
                depth++;
            }
            else if (t.Kind == TokenKind.Punct && t.Text is ")" or "]" or "}")
            {
                depth--;
            }

            if (t.Is("+") && depth == 0)
            {
                yield return current;
                current = [];
                continue;
            }

            current.Add(t);
        }

        if (current.Count > 0)
        {
            yield return current;
        }
    }

    private static string ParameterName(IReadOnlyList<Token> expression) =>
        expression.LastOrDefault(t => t.Kind == TokenKind.Identifier) is { } name && ParameterRegex().IsMatch(name.Text) ? name.Text : "param";

    private static string Describe(IReadOnlyList<Token> expression) =>
        Text.Truncate(string.Join("", expression.Take(6).Select(t => t.Kind == TokenKind.Template ? "`…`" : t.Text)), 80);

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]{0,40}$")]
    private static partial Regex ParameterRegex();
}
