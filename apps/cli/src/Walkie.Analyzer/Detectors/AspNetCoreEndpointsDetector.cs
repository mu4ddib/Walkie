using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// Endpoints de ASP.NET Core con Roslyn solo sintáctico (ADR-0013):
/// <list type="bullet">
/// <item>Minimal APIs: <c>MapGet/MapPost/MapPut/MapPatch/MapDelete("ruta literal")</c> sobre la aplicación o sobre
/// grupos <c>MapGroup("prefijo")</c> asignados a variables locales del mismo método (también encadenados y con
/// <c>WithTags</c>, <c>RequireAuthorization</c>…).</item>
/// <item>Controllers con rutas por atributo: <c>[Route]</c> en la clase y <c>[HttpGet("…")]</c> en la acción, con
/// <c>[controller]</c> y <c>[action]</c> reemplazados.</item>
/// </list>
/// Lo que no se puede resolver sin ejecutar (ruta no literal, prefijo que llega como parámetro, rutas por convención)
/// queda en <c>limitations</c> o baja la confianza; no se adivina. El dueño del endpoint es el proyecto que lo
/// contiene: un servicio lo expone; una biblioteca pasa a ser un candidato a módulo con el endpoint como interfaz.
/// </summary>
public sealed class AspNetCoreEndpointsDetector : IDetector
{
    private static readonly Dictionary<string, string> MapMethods = new(StringComparer.Ordinal)
    {
        ["MapGet"] = "GET", ["MapPost"] = "POST", ["MapPut"] = "PUT", ["MapPatch"] = "PATCH", ["MapDelete"] = "DELETE",
    };

    private static readonly Dictionary<string, string> HttpAttributes = new(StringComparer.Ordinal)
    {
        ["HttpGet"] = "GET", ["HttpPost"] = "POST", ["HttpPut"] = "PUT", ["HttpPatch"] = "PATCH", ["HttpDelete"] = "DELETE",
    };

    private static readonly string[] FluentPrefixes =
        ["With", "Require", "Allow", "Add", "Disable", "Produces", "Accepts", "Exclude", "Cache", "ShortCircuit"];

    public string Id => "aspnetcore-endpoints";

    public IReadOnlyList<string> Entities { get; } = ["api", "module"];

    public IReadOnlyList<string> Relations { get; } = ["exposes"];

    public void Run(AnalysisContext context)
    {
        foreach (var file in context.Files.Where(f => f.Extension.Equals(".cs", StringComparison.OrdinalIgnoreCase)))
        {
            var owner = context.ProjectOf(file.Path);
            if (owner?.Role is DotnetProjectRole.Test or DotnetProjectRole.Tool)
            {
                continue;
            }

            if (context.Read(file, Id) is not { } text
                || !(text.Contains(".Map", StringComparison.Ordinal) || text.Contains("[Http", StringComparison.Ordinal)))
            {
                continue;
            }

            if (context.CSharp(file, Id)?.GetRoot() is not { } root)
            {
                continue;
            }

            foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                if (invocation.Expression is MemberAccessExpressionSyntax member
                    && MapMethods.TryGetValue(member.Name.Identifier.Text, out var method))
                {
                    MinimalApi(context, file, owner, invocation, member, method);
                }
            }

            foreach (var type in root.DescendantNodes().OfType<ClassDeclarationSyntax>().Where(IsController))
            {
                Controller(context, file, owner, type);
            }
        }
    }

    private void MinimalApi(AnalysisContext context, SourceFile file, DotnetProject? owner, InvocationExpressionSyntax invocation,
        MemberAccessExpressionSyntax member, string method)
    {
        var lines = Roslyn.LinesOf(invocation);
        if (invocation.ArgumentList.Arguments.Count == 0
            || Roslyn.StringLiteral(invocation.ArgumentList.Arguments[0].Expression) is not { } pattern)
        {
            context.Findings.Limitation("dynamic-route",
                $"{member.Name.Identifier.Text} en la línea {lines.Start} usa una ruta que no es un texto literal: no se puede saber sin ejecutar.", Id, file.Path);
            return;
        }

        var (prefix, resolved) = Prefix(member.Expression, 0);
        if (prefix is null)
        {
            context.Findings.Limitation("dynamic-route",
                $"{member.Name.Identifier.Text}(\"{pattern}\") en la línea {lines.Start}: el prefijo de su grupo no es un texto literal.", Id, file.Path);
            return;
        }

        var note = resolved
            ? $"{member.Name.Identifier.Text} con ruta literal"
            : $"{member.Name.Identifier.Text} con ruta literal; el prefijo del receptor no se conoce (llega como parámetro u otra variable)";
        Endpoint(context, file, owner, method, Combine(prefix, pattern), Roslyn.SymbolOf(invocation), lines,
            resolved ? Confidence.High : Confidence.Medium, note);
    }

    private void Controller(AnalysisContext context, SourceFile file, DotnetProject? owner, ClassDeclarationSyntax type)
    {
        var name = type.Identifier.Text;
        var controller = name.EndsWith("Controller", StringComparison.Ordinal) ? name[..^"Controller".Length] : name;
        var classRoute = Attributes(type.AttributeLists).Where(a => a.Name == "Route").Select(a => a.Template).FirstOrDefault();
        var found = false;
        foreach (var action in type.Members.OfType<MethodDeclarationSyntax>())
        {
            var attributes = Attributes(action.AttributeLists).ToList();
            var methodRoute = attributes.Where(a => a.Name == "Route").Select(a => a.Template).FirstOrDefault();
            foreach (var (verb, template) in attributes.Where(a => HttpAttributes.ContainsKey(a.Name)).Select(a => (HttpAttributes[a.Name], a.Template)))
            {
                var local = template ?? methodRoute ?? "";
                if (classRoute is null && local.Length == 0)
                {
                    continue;
                }

                found = true;
                var route = local.StartsWith('/') || local.StartsWith("~/", StringComparison.Ordinal)
                    ? local.TrimStart('~')
                    : Combine(classRoute ?? "", local);
                route = route.Replace("[controller]", controller, StringComparison.OrdinalIgnoreCase)
                    .Replace("[action]", action.Identifier.Text, StringComparison.OrdinalIgnoreCase);
                Endpoint(context, file, owner, verb, route, $"{name}.{action.Identifier.Text}", Roslyn.LinesOf(action),
                    Confidence.High, $"Controller con [{verb switch { "GET" => "HttpGet", "POST" => "HttpPost", "PUT" => "HttpPut", "PATCH" => "HttpPatch", _ => "HttpDelete" }}] y ruta por atributo");
            }
        }

        if (!found && type.Members.OfType<MethodDeclarationSyntax>().Any(m => m.Modifiers.Any(t => t.Text == "public")))
        {
            context.Findings.Limitation("conventional-routing",
                $"{name} no declara rutas por atributo: sus rutas por convención solo se conocen al ejecutar.", Id, file.Path);
        }
    }

    private void Endpoint(AnalysisContext context, SourceFile file, DotnetProject? owner, string method, string rawPath,
        string symbol, Lines lines, Confidence confidence, string note)
    {
        var path = CleanPath(rawPath);
        var evidence = context.Findings.Evidence(Id, file.Path, confidence, symbol, lines, note);
        context.Findings.Technology("aspnetcore", "ASP.NET Core", null, evidence);
        var key = DiscoveryKeys.Api(method, path);
        var api = context.Findings.Entity(key, "api", $"{method} {path}", Basis.Observed, confidence, evidence);
        if (api is null)
        {
            return;
        }

        api.Technology ??= "aspnetcore";
        api.Http ??= Http(method, path);

        switch (owner?.Role)
        {
            case DotnetProjectRole.Service when context.Findings.Entities.ContainsKey(owner.ServiceKey):
                context.Findings.Relation("exposes", owner.ServiceKey, key, Basis.Observed, confidence, evidence);
                break;
            case DotnetProjectRole.Library:
                if (context.Findings.Entity(owner.ModuleKey, "module", owner.Name, Basis.Inferred, Confidence.Medium, owner.EvidenceId) is { } module)
                {
                    module.Technology ??= "aspnetcore";
                    module.AddMember(key);
                    module.AddInterface(key, api.Title, "provides");
                    context.Findings.Relation("exposes", owner.ModuleKey, key, Basis.Observed, confidence, evidence);
                }

                break;
        }
    }

    /// <summary>
    /// Prefijo de ruta del receptor de un <c>MapX</c>: <c>("", true)</c> para la aplicación, el de sus
    /// <c>MapGroup</c> si se puede seguir, <c>("", false)</c> si el receptor llega de fuera (no se sabe su prefijo) y
    /// <c>(null, false)</c> si un prefijo no es literal.
    /// </summary>
    private static (string? Prefix, bool Resolved) Prefix(ExpressionSyntax receiver, int depth)
    {
        if (depth > 12)
        {
            return ("", false);
        }

        switch (receiver)
        {
            case InvocationExpressionSyntax { Expression: MemberAccessExpressionSyntax member } invocation:
                var name = member.Name.Identifier.Text;
                if (name == "MapGroup")
                {
                    if (invocation.ArgumentList.Arguments.Count == 0
                        || Roslyn.StringLiteral(invocation.ArgumentList.Arguments[0].Expression) is not { } group)
                    {
                        return (null, false);
                    }

                    var (outer, resolved) = Prefix(member.Expression, depth + 1);
                    return outer is null ? (null, false) : (Combine(outer, group), resolved);
                }

                if (FluentPrefixes.Any(p => name.StartsWith(p, StringComparison.Ordinal)))
                {
                    return Prefix(member.Expression, depth + 1);
                }

                // builder.Build(), WebApplication.Create(args)…: la aplicación, sin prefijo.
                return name is "Build" or "Create" or "CreateBuilder" or "CreateSlimBuilder" or "CreateEmptyBuilder"
                    ? ("", true)
                    : ("", false);
            case IdentifierNameSyntax identifier:
                var declarator = receiver.Ancestors()
                    .FirstOrDefault(a => a is BaseMethodDeclarationSyntax or LocalFunctionStatementSyntax or CompilationUnitSyntax or AnonymousFunctionExpressionSyntax)?
                    .DescendantNodes().OfType<VariableDeclaratorSyntax>()
                    .LastOrDefault(v => v.Identifier.Text == identifier.Identifier.Text && v.SpanStart < receiver.SpanStart);
                return declarator?.Initializer?.Value is { } value ? Prefix(value, depth + 1) : ("", false);
            default:
                return ("", false);
        }
    }

    private static bool IsController(ClassDeclarationSyntax type) =>
        Attributes(type.AttributeLists).Any(a => a.Name is "ApiController" or "Route")
        || type.BaseList?.Types.Any(t => Roslyn.SimpleName(t.Type) is "ControllerBase" or "Controller") == true;

    private static IEnumerable<(string Name, string? Template)> Attributes(SyntaxList<AttributeListSyntax> lists) =>
        lists.SelectMany(l => l.Attributes).Select(a =>
        {
            var name = Roslyn.SimpleName(a.Name) ?? "";
            if (name.EndsWith("Attribute", StringComparison.Ordinal))
            {
                name = name[..^"Attribute".Length];
            }

            var template = a.ArgumentList?.Arguments.FirstOrDefault(arg => arg.NameEquals is null) is { } first
                ? Roslyn.StringLiteral(first.Expression)
                : null;
            return (name, template);
        });

    private static string Combine(string prefix, string path)
    {
        var left = prefix.TrimEnd('/');
        var right = path.Trim().TrimStart('/');
        return right.Length == 0 ? (left.Length == 0 ? "/" : left) : $"{left}/{right}";
    }

    /// <summary>Ruta legible: barra inicial, sin barra final y parámetros sin restricciones (<c>{id:guid}</c> → <c>{id}</c>).</summary>
    internal static string CleanPath(string path)
    {
        var builder = new StringBuilder();
        foreach (var segment in path.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            builder.Append('/');
            builder.Append(segment.StartsWith('{') && segment.EndsWith('}') ? "{" + ParameterName(segment) + "}" : segment);
        }

        return builder.Length == 0 ? "/" : builder.ToString();
    }

    private static string ParameterName(string segment)
    {
        var inner = segment[1..^1].TrimStart('*');
        var cut = inner.IndexOfAny([':', '=', '?']);
        return cut >= 0 ? inner[..cut] : inner;
    }

    private static System.Text.Json.Nodes.JsonObject Http(string method, string path)
    {
        var http = new System.Text.Json.Nodes.JsonObject { ["method"] = method, ["path"] = path };
        var parameters = path.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Where(s => s.StartsWith('{') && s.EndsWith('}'))
            .Select(s => (System.Text.Json.Nodes.JsonNode)new System.Text.Json.Nodes.JsonObject
            {
                ["name"] = s[1..^1],
                ["in"] = "path",
            })
            .ToArray();
        if (parameters.Length > 0)
        {
            http["params"] = new System.Text.Json.Nodes.JsonArray(parameters);
        }

        return http;
    }
}
