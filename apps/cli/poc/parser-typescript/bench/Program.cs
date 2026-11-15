// Prueba de concepto de ADR-0013 (tarea 8): mismo corpus, mismas reglas de extracción, tres lectores de TS/TSX.
// Uso: bench <treesitter|jint|scanner> <corpus> <salida.json> [máximo de archivos]
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

var mode = args[0];
var corpus = Path.GetFullPath(args[1]);
var output = args[2];
var max = args.Length > 3 ? int.Parse(args[3]) : int.MaxValue;
var exts = new[] { ".ts", ".tsx", ".js", ".jsx" };
var files = Directory.EnumerateFiles(corpus, "*", SearchOption.AllDirectories)
    .Where(f => exts.Contains(Path.GetExtension(f)))
    .Select(f => Path.GetRelativePath(corpus, f).Replace('\\', '/'))
    .Order(StringComparer.Ordinal).Take(max).ToList();

var results = new List<FileResult>();
var setup = Stopwatch.StartNew();
IExtractor extractor = mode switch
{
    "treesitter" => new TreeSitterExtractor(),
    "jint" => new JintExtractor(args.Length > 4 ? args[4] : throw new ArgumentException("ruta de typescript.js")),
    "scanner" => new ScannerExtractor(),
    _ => throw new ArgumentException(mode),
};
setup.Stop();
var run = Stopwatch.StartNew();
foreach (var file in files)
{
    var text = File.ReadAllText(Path.Combine(corpus, file));
    try
    {
        results.Add(extractor.Extract(file, text));
    }
    catch (Exception ex)
    {
        results.Add(new FileResult(file, [], [], [], true, ex.GetType().Name + ": " + ex.Message));
    }
}
run.Stop();
var report = new
{
    mode,
    files = files.Count,
    setupMs = setup.ElapsedMilliseconds,
    runMs = run.ElapsedMilliseconds,
    peakWorkingSetMb = Process.GetCurrentProcess().PeakWorkingSet64 / 1024 / 1024,
    filesWithErrors = results.Count(r => r.HasError),
    results = results.Where(r => r.Routes.Count + r.Http.Count + r.Dynamic.Count > 0 || r.HasError).ToList(),
};
File.WriteAllText(output, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"{mode}: {files.Count} archivos, preparación {setup.ElapsedMilliseconds} ms, análisis {run.ElapsedMilliseconds} ms, memoria pico {report.peakWorkingSetMb} MB, con errores {report.filesWithErrors}");

public sealed record Call(string Method, string Url);

public sealed record FileResult(string File, List<string> Routes, List<Call> Http, List<string> Dynamic, bool HasError, string? Error = null);

public interface IExtractor
{
    FileResult Extract(string file, string text);
}

/// <summary>Reglas comunes: qué archivo es de rutas y cómo se arma una URL de una plantilla.</summary>
public static class Rules
{
    public static readonly Regex RouterImport = new(@"from\s+['""](react-router(-dom)?|@angular/router)['""]", RegexOptions.Compiled);
    public static readonly string[] HttpMethods = ["get", "post", "put", "patch", "delete"];

    /// <summary>Plantilla: cabeza literal y, por cada sustitución, su valor si es una constante del archivo o <c>{}</c>.</summary>
    public static string? Template(string head, List<(string? Const, string Tail)> spans)
    {
        var url = head;
        for (var i = 0; i < spans.Count; i++)
        {
            var (constant, tail) = spans[i];
            if (url.Length == 0)
            {
                if (constant is null) return null; // empieza por algo que no se puede resolver
                url = constant;
            }
            else
            {
                url += "{}";
            }

            url += tail;
        }

        return url.StartsWith('/') ? url : null;
    }
}

public sealed class TreeSitterExtractor : IExtractor
{
    private readonly TreeSitter.Parser ts = new(new TreeSitter.Language("TypeScript"));
    private readonly TreeSitter.Parser tsx = new(new TreeSitter.Language("Tsx"));

    public FileResult Extract(string file, string text)
    {
        var parser = file.EndsWith(".ts") ? ts : tsx;
        using var tree = parser.Parse(text);
        var root = tree.RootNode;
        var routerFile = Rules.RouterImport.IsMatch(text);
        var consts = new Dictionary<string, string>();
        var result = new FileResult(file, [], [], [], root.HasError);
        Collect(root);
        Walk(root);
        return result;

        void Collect(TreeSitter.Node node)
        {
            if (node.Type == "variable_declarator" && node.GetChildForField("name") is { Type: "identifier" } name
                && node.GetChildForField("value") is { Type: "string" } value)
            {
                consts[name.Text] = Unquote(value);
            }

            foreach (var child in node.NamedChildren) Collect(child);
        }

        void Walk(TreeSitter.Node node)
        {
            switch (node.Type)
            {
                case "jsx_opening_element" or "jsx_self_closing_element"
                    when node.GetChildForField("name")?.Text == "Route":
                    foreach (var attribute in node.NamedChildren.Where(c => c.Type == "jsx_attribute"))
                    {
                        if (attribute.NamedChildren.FirstOrDefault()?.Text != "path") continue;
                        var value = attribute.NamedChildren.Skip(1).FirstOrDefault();
                        if (value?.Type == "string") result.Routes.Add(Unquote(value));
                        else if (value is not null) result.Dynamic.Add("route:" + value.Text);
                    }

                    break;
                case "pair" when routerFile && node.GetChildForField("key")?.Text == "path":
                    var v = node.GetChildForField("value");
                    if (v?.Type == "string") result.Routes.Add(Unquote(v));
                    else if (v?.Type == "template_string" && !v.Children.Any(c => c.Type == "template_substitution"))
                        result.Routes.Add(string.Concat(v.Children.Where(c => c.Type == "string_fragment").Select(c => c.Text)));
                    break;
                case "call_expression":
                    Call(node);
                    break;
            }

            foreach (var child in node.NamedChildren) Walk(child);
        }

        void Call(TreeSitter.Node call)
        {
            var callee = call.GetChildForField("function");
            var args = call.GetChildForField("arguments");
            if (callee is null || args is null) return;
            string? method = null;
            if (callee.Type == "identifier" && callee.Text == "fetch")
            {
                method = "GET";
                var options = args.NamedChildren.Skip(1).FirstOrDefault();
                if (options?.Type == "object")
                {
                    foreach (var pair in options.NamedChildren.Where(p => p.Type == "pair"))
                    {
                        if (pair.GetChildForField("key")?.Text == "method" && pair.GetChildForField("value") is { Type: "string" } m)
                            method = Unquote(m).ToUpperInvariant();
                    }
                }
            }
            else if (callee.Type == "member_expression" && callee.GetChildForField("property")?.Text is { } prop
                     && Rules.HttpMethods.Contains(prop))
            {
                var obj = callee.GetChildForField("object")?.Text ?? "";
                if (obj == "axios" || obj == "this.http" || obj == "http" || obj == "this.httpClient") method = prop.ToUpperInvariant();
            }

            if (method is null) return;
            var first = args.NamedChildren.FirstOrDefault();
            if (first?.Type == "string") result.Http.Add(new(method, Unquote(first)));
            else if (first?.Type == "template_string")
            {
                var head = "";
                var spans = new List<(string?, string)>();
                var started = false;
                foreach (var part in first.Children)
                {
                    if (part.Type == "template_substitution")
                    {
                        var e = part.NamedChildren.FirstOrDefault();
                        spans.Add((e?.Type == "identifier" && consts.TryGetValue(e.Text, out var c) ? c : null, ""));
                        started = true;
                    }
                    else if (part.Type == "string_fragment")
                    {
                        if (!started) head += part.Text;
                        else spans[^1] = (spans[^1].Item1, spans[^1].Item2 + part.Text);
                    }
                }

                if (Rules.Template(head, spans) is { } url) result.Http.Add(new(method, url));
                else result.Dynamic.Add("http:" + first.Text);
            }
            else if (first is not null) result.Dynamic.Add("http:" + first.Text);
        }
    }

    private static string Unquote(TreeSitter.Node s) => string.Concat(s.NamedChildren.Where(c => c.Type is "string_fragment" or "escape_sequence").Select(c => c.Text));
}

public sealed class JintExtractor : IExtractor
{
    private readonly Jint.Engine engine;

    public JintExtractor(string typescriptJs)
    {
        engine = new Jint.Engine();
        engine.Execute("var module = { exports: {} }; var exports = module.exports;");
        engine.Execute(File.ReadAllText(typescriptJs));
        engine.Execute("var ts = module.exports;");
        engine.Execute(Script);
    }

    public FileResult Extract(string file, string text)
    {
        var json = engine.Invoke("extract", file, text).ToString();
        var d = JsonSerializer.Deserialize<JsonElement>(json);
        return new FileResult(file,
            d.GetProperty("routes").EnumerateArray().Select(e => e.GetString()!).ToList(),
            d.GetProperty("http").EnumerateArray().Select(e => new Call(e.GetProperty("method").GetString()!, e.GetProperty("url").GetString()!)).ToList(),
            d.GetProperty("dynamic").EnumerateArray().Select(e => e.GetString()!).ToList(),
            d.GetProperty("errors").GetInt32() > 0);
    }

    private const string Script = """
        var routerRe = /from\s+['"](react-router(-dom)?|@angular\/router)['"]/;
        var methods = ['get', 'post', 'put', 'patch', 'delete'];
        function extract(file, text) {
          var kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : (/\.js$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
          var sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
          var routerFile = routerRe.test(text);
          var consts = {}; var out = { routes: [], http: [], dynamic: [], errors: sf.parseDiagnostics.length };
          function collect(n) {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isStringLiteral(n.initializer)) consts[n.name.text] = n.initializer.text;
            ts.forEachChild(n, collect);
          }
          function template(t) {
            var url = t.head.text;
            for (var i = 0; i < t.templateSpans.length; i++) {
              var e = t.templateSpans[i].expression;
              if (url.length === 0) { if (ts.isIdentifier(e) && consts[e.text] != null) url = consts[e.text]; else return null; }
              else url += '{}';
              url += t.templateSpans[i].literal.text;
            }
            return url.charAt(0) === '/' ? url : null;
          }
          function call(n) {
            var c = n.expression, method = null;
            if (ts.isIdentifier(c) && c.text === 'fetch') {
              method = 'GET';
              var o = n.arguments[1];
              if (o && ts.isObjectLiteralExpression(o)) o.properties.forEach(function (p) {
                if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'method' && ts.isStringLiteral(p.initializer)) method = p.initializer.text.toUpperCase();
              });
            } else if (ts.isPropertyAccessExpression(c) && methods.indexOf(c.name.text) >= 0) {
              var obj = c.expression.getText(sf);
              if (obj === 'axios' || obj === 'this.http' || obj === 'http' || obj === 'this.httpClient') method = c.name.text.toUpperCase();
            }
            if (!method) return;
            var a = n.arguments[0];
            if (!a) return;
            if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) out.http.push({ method: method, url: a.text });
            else if (ts.isTemplateExpression(a)) { var u = template(a); if (u) out.http.push({ method: method, url: u }); else out.dynamic.push('http:' + a.getText(sf)); }
            else out.dynamic.push('http:' + a.getText(sf));
          }
          function walk(n) {
            if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === 'Route') {
              n.attributes.properties.forEach(function (p) {
                if (ts.isJsxAttribute(p) && p.name.getText(sf) === 'path' && p.initializer) {
                  if (ts.isStringLiteral(p.initializer)) out.routes.push(p.initializer.text);
                  else out.dynamic.push('route:' + p.initializer.getText(sf));
                }
              });
            } else if (routerFile && ts.isPropertyAssignment(n) && n.name.getText(sf) === 'path'
                       && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) {
              out.routes.push(n.initializer.text);
            } else if (ts.isCallExpression(n)) call(n);
            ts.forEachChild(n, walk);
          }
          collect(sf); walk(sf);
          return JSON.stringify(out);
        }
        """;
}
