using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Detectors;

/// <summary>Un endpoint descubierto: la clave de su API y el nodo que lo atiende (la llamada <c>MapX</c> o la acción del controller).</summary>
internal sealed record EndpointRecord(string ApiKey, SourceFile File, SyntaxNode Node, Lines Lines);

/// <summary>
/// Qué base lee o escribe cada endpoint de ASP.NET Core (spec walkie-live-arquitectura, ADR-0016), con Roslyn solo
/// sintáctico y una cadena acotada:
/// <list type="number">
/// <item>endpoint → su handler (grupo de métodos <c>MapGet("/x", GetX)</c>, <c>Clase.Metodo</c>, lambda o acción);</item>
/// <item>handler → el método que llama sobre un parámetro, campo o parámetro del constructor con tipo (un servicio; una
/// interfaz, si tiene una sola implementación), como mucho <see cref="MaxDepth"/> saltos;</item>
/// <item>método → el <c>DbSet</c> de un <c>DbContext</c> que usa: <c>Add</c>, <c>Remove</c>, <c>Update</c>,
/// <c>ExecuteUpdate</c>, <c>ExecuteDelete</c> o <c>SaveChanges</c> es escritura; cualquier otra consulta, lectura.</item>
/// </list>
/// Que un servicio esté registrado o inyectado no prueba nada: cuenta solo la llamada que sale del endpoint. Una interfaz
/// con varias implementaciones no se sigue (no se sabe cuál corre). La relación es de la <c>api</c> a la base lógica del
/// <c>DbContext</c> (no a una tabla ni a la base física), inferida y media; la evidencia es la cadena.
/// </summary>
public sealed class AspNetCoreDataDetector : IDetector
{
    public const int MaxDepth = 3;

    private static readonly HashSet<string> Writes =
    [
        "Add", "AddAsync", "AddRange", "AddRangeAsync", "Remove", "RemoveRange", "Update", "UpdateRange", "Attach",
        "ExecuteUpdate", "ExecuteUpdateAsync", "ExecuteDelete", "ExecuteDeleteAsync",
    ];

    private static readonly HashSet<string> Primitive =
        ["string", "int", "long", "bool", "Guid", "DateTime", "DateTimeOffset", "CancellationToken", "HttpContext", "HttpRequest", "ClaimsPrincipal", "IFormFile", "TimeProvider", "decimal", "double"];

    public string Id => "aspnetcore-data";

    public IReadOnlyList<string> Entities { get; } = [];

    public IReadOnlyList<string> Relations { get; } = ["reads", "writes"];

    public string? NotApplicable(AnalysisContext context) =>
        context.Endpoints.Count == 0 ? "No hay endpoints de ASP.NET Core."
        : context.DbContexts.Count == 0 ? "No hay DbContext de EF Core." : null;

    public void Run(AnalysisContext context)
    {
        if (NotApplicable(context) is not null)
        {
            return;
        }

        var types = TypeIndex(context);
        foreach (var endpoint in context.Endpoints)
        {
            if (Handler(endpoint, types) is not { } handler)
            {
                continue;
            }

            var found = new Dictionary<(string Kind, string Database), List<(SourceFile File, Lines Lines, string Note)>>();
            var start = new List<(SourceFile, Lines, string)> { (endpoint.File, endpoint.Lines, "endpoint") };
            Walk(context, types, handler, 0, start, found, new HashSet<SyntaxNode>());
            foreach (var ((kind, database), chain) in found.OrderBy(f => f.Key.Kind, StringComparer.Ordinal).ThenBy(f => f.Key.Database, StringComparer.Ordinal))
            {
                foreach (var (file, lines, note) in chain)
                {
                    var evidence = context.Findings.Evidence(Id, file.Path, Confidence.Medium, note, lines);
                    context.Findings.Relation(kind, endpoint.ApiKey, database, Basis.Inferred, Confidence.Medium, evidence);
                }
            }
        }
    }

    /// <summary>Un método (o lambda) con su cuerpo, sus parámetros y la clase que lo contiene.</summary>
    private sealed record Body(SourceFile File, SyntaxNode Node, IReadOnlyDictionary<string, string> Variables, string Name);

    private sealed class Types
    {
        public Dictionary<string, List<(SourceFile File, TypeDeclarationSyntax Type)>> ByName { get; } = new(StringComparer.Ordinal);

        public Dictionary<string, List<string>> Implementations { get; } = new(StringComparer.Ordinal);
    }

    /// <summary>Clases e interfaces del código (sin pruebas ni herramientas) por nombre, y qué clases implementan cada interfaz.</summary>
    private Types TypeIndex(AnalysisContext context)
    {
        var types = new Types();
        foreach (var file in context.Files.Where(f => f.Extension.Equals(".cs", StringComparison.OrdinalIgnoreCase)))
        {
            if (context.ProjectOf(file.Path)?.Role is DotnetProjectRole.Test or DotnetProjectRole.Tool || context.CSharp(file, Id)?.GetRoot() is not { } root)
            {
                continue;
            }

            foreach (var type in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
            {
                var name = type.Identifier.Text;
                if (!types.ByName.TryGetValue(name, out var list))
                {
                    types.ByName[name] = list = [];
                }

                list.Add((file, type));
                foreach (var baseType in type.BaseList?.Types ?? default)
                {
                    if (Roslyn.SimpleName(baseType.Type) is { } implemented && implemented.Length > 1 && implemented[0] == 'I' && char.IsUpper(implemented[1]))
                    {
                        if (!types.Implementations.TryGetValue(implemented, out var impls))
                        {
                            types.Implementations[implemented] = impls = [];
                        }

                        impls.Add(name);
                    }
                }
            }
        }

        return types;
    }

    /// <summary>El handler de un endpoint: el método o la lambda que le pasa <c>MapX</c>, o la acción del controller.</summary>
    private static Body? Handler(EndpointRecord endpoint, Types types)
    {
        switch (endpoint.Node)
        {
            case MethodDeclarationSyntax action:
                return Method(endpoint.File, action);
            case InvocationExpressionSyntax map when map.ArgumentList.Arguments.Count >= 2:
                var argument = map.ArgumentList.Arguments[1].Expression;
                switch (argument)
                {
                    case AnonymousFunctionExpressionSyntax lambda:
                        var parameters = lambda switch
                        {
                            ParenthesizedLambdaExpressionSyntax p => p.ParameterList.Parameters,
                            SimpleLambdaExpressionSyntax s => SyntaxFactoryList(s.Parameter),
                            AnonymousMethodExpressionSyntax a => a.ParameterList?.Parameters ?? default,
                            _ => default,
                        };
                        var variables = Fields(lambda.Ancestors().OfType<TypeDeclarationSyntax>().FirstOrDefault());
                        foreach (var p in parameters)
                        {
                            if (p.Type is not null && Roslyn.SimpleName(p.Type) is { } t)
                            {
                                variables[p.Identifier.Text] = t;
                            }
                        }

                        return new Body(endpoint.File, lambda.Body, variables, "lambda");
                    case IdentifierNameSyntax group:
                        var owner = map.Ancestors().OfType<TypeDeclarationSyntax>().FirstOrDefault();
                        return owner?.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(m => m.Identifier.Text == group.Identifier.Text) is { } local
                            ? Method(endpoint.File, local)
                            : null;
                    case MemberAccessExpressionSyntax { Expression: IdentifierNameSyntax typeName } qualified
                        when types.ByName.TryGetValue(typeName.Identifier.Text, out var candidates) && candidates is [var only]:
                        return only.Type.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(m => m.Identifier.Text == qualified.Name.Identifier.Text) is { } method
                            ? Method(only.File, method)
                            : null;
                }

                break;
        }

        return null;
    }

    private static SeparatedSyntaxList<ParameterSyntax> SyntaxFactoryList(ParameterSyntax parameter) =>
        Microsoft.CodeAnalysis.CSharp.SyntaxFactory.SeparatedList([parameter]);

    private static Body? Method(SourceFile file, MethodDeclarationSyntax method)
    {
        var variables = Fields(method.Ancestors().OfType<TypeDeclarationSyntax>().FirstOrDefault());
        foreach (var p in method.ParameterList.Parameters)
        {
            if (p.Type is not null && Roslyn.SimpleName(p.Type) is { } t)
            {
                variables[p.Identifier.Text] = t;
            }
        }

        SyntaxNode? body = (SyntaxNode?)method.Body ?? method.ExpressionBody;
        return body is null ? null : new Body(file, body, variables, Roslyn.SymbolOf(body));
    }

    /// <summary>Campos y parámetros del constructor (también el primario) de la clase, con su tipo.</summary>
    private static Dictionary<string, string> Fields(TypeDeclarationSyntax? type)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        if (type is null)
        {
            return fields;
        }

        foreach (var p in type.ParameterList?.Parameters ?? default)
        {
            if (p.Type is not null && Roslyn.SimpleName(p.Type) is { } t)
            {
                fields[p.Identifier.Text] = t;
            }
        }

        foreach (var field in type.Members.OfType<FieldDeclarationSyntax>())
        {
            if (Roslyn.SimpleName(field.Declaration.Type) is { } t)
            {
                foreach (var v in field.Declaration.Variables)
                {
                    fields[v.Identifier.Text] = t;
                }
            }
        }

        foreach (var ctor in type.Members.OfType<ConstructorDeclarationSyntax>())
        {
            foreach (var p in ctor.ParameterList.Parameters)
            {
                if (p.Type is not null && Roslyn.SimpleName(p.Type) is { } t)
                {
                    fields.TryAdd(p.Identifier.Text, t);
                }
            }
        }

        return fields;
    }

    /// <summary>Recorre el cuerpo: los <c>DbSet</c> que usa y, hasta el límite, los métodos de servicios que llama.</summary>
    private static void Walk(AnalysisContext context, Types types, Body body, int depth, List<(SourceFile, Lines, string)> chain,
        Dictionary<(string, string), List<(SourceFile, Lines, string)>> found, HashSet<SyntaxNode> seen)
    {
        if (!seen.Add(body.Node))
        {
            return;
        }

        if (depth < MaxDepth)
        {
            foreach (var (call, method) in SameType(body))
            {
                if (Method(body.File, method) is { } next)
                {
                    Walk(context, types, next, depth + 1, [.. chain, (body.File, Roslyn.LinesOf(call), $"{method.Identifier.Text} (misma clase)")], found, seen);
                }
            }
        }

        foreach (var access in body.Node.DescendantNodes().OfType<MemberAccessExpressionSyntax>())
        {
            if (access.Expression is not IdentifierNameSyntax receiver || !body.Variables.TryGetValue(receiver.Identifier.Text, out var type))
            {
                continue;
            }

            // db.Tabla… y db.SaveChanges(): el DbContext de la variable.
            if (context.DbContexts.TryGetValue(type, out var database))
            {
                var member = access.Name.Identifier.Text;
                string? kind = member switch
                {
                    "SaveChanges" or "SaveChangesAsync" => "writes",
                    "Database" => Chain(access).Any(n => n.StartsWith("Execute", StringComparison.Ordinal)) ? "writes" : "reads",
                    "ChangeTracker" or "Entry" or "Set" => null,
                    _ when char.IsUpper(member[0]) => Chain(access).Any(Writes.Contains) ? "writes" : "reads",
                    _ => null,
                };
                if (kind is not null)
                {
                    Add(found, (kind, database), chain, (body.File, Roslyn.LinesOf(access), $"{receiver.Identifier.Text}.{member} ({type})"));
                }

                continue;
            }

            // servicio.Metodo(…): el método de su clase (o de la única implementación de su interfaz).
            if (depth >= MaxDepth || access.Parent is not InvocationExpressionSyntax || Primitive.Contains(type))
            {
                continue;
            }

            var method = access.Name.Identifier.Text;
            foreach (var (file, target) in Targets(types, type))
            {
                foreach (var declaration in target.Members.OfType<MethodDeclarationSyntax>().Where(m => m.Identifier.Text == method))
                {
                    if (Method(file, declaration) is { } next)
                    {
                        Walk(context, types, next, depth + 1, [.. chain, (body.File, Roslyn.LinesOf(access), $"{receiver.Identifier.Text}.{method} → {target.Identifier.Text}")], found, seen);
                    }
                }
            }
        }
    }

    /// <summary>Métodos de la misma clase llamados sin receptor (<c>await SaveAsync(…)</c>, <c>this.Plan(…)</c>).</summary>
    private static IEnumerable<(InvocationExpressionSyntax Call, MethodDeclarationSyntax Method)> SameType(Body body)
    {
        var type = body.Node.Ancestors().OfType<TypeDeclarationSyntax>().FirstOrDefault();
        if (type is null)
        {
            yield break;
        }

        foreach (var call in body.Node.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var name = call.Expression switch
            {
                IdentifierNameSyntax id => id.Identifier.Text,
                GenericNameSyntax generic => generic.Identifier.Text,
                MemberAccessExpressionSyntax { Expression: ThisExpressionSyntax } self => self.Name.Identifier.Text,
                _ => null,
            };
            if (name is null)
            {
                continue;
            }

            foreach (var method in type.Members.OfType<MethodDeclarationSyntax>().Where(m => m.Identifier.Text == name))
            {
                yield return (call, method);
            }
        }
    }

    /// <summary>La clase del tipo, o la única clase que implementa la interfaz.</summary>
    private static IEnumerable<(SourceFile File, TypeDeclarationSyntax Type)> Targets(Types types, string type)
    {
        if (types.Implementations.TryGetValue(type, out var implementations))
        {
            var distinct = implementations.Distinct(StringComparer.Ordinal).ToList();
            if (distinct is [var only] && types.ByName.TryGetValue(only, out var impl) && impl is [var single])
            {
                yield return single;
            }

            yield break;
        }

        if (types.ByName.TryGetValue(type, out var classes) && classes is [var one] && one.Type is ClassDeclarationSyntax or RecordDeclarationSyntax)
        {
            yield return one;
        }
    }

    /// <summary>Los métodos encadenados después de un acceso (<c>db.Apps.AsNoTracking().Where(…)</c> → AsNoTracking, Where).</summary>
    private static IEnumerable<string> Chain(MemberAccessExpressionSyntax access)
    {
        SyntaxNode node = access;
        while (node.Parent is MemberAccessExpressionSyntax or InvocationExpressionSyntax or AwaitExpressionSyntax or ConditionalAccessExpressionSyntax or MemberBindingExpressionSyntax)
        {
            node = node.Parent;
            if (node is MemberAccessExpressionSyntax member)
            {
                yield return member.Name.Identifier.Text;
            }
            else if (node is ConditionalAccessExpressionSyntax conditional && conditional.WhenNotNull is InvocationExpressionSyntax { Expression: MemberBindingExpressionSyntax binding })
            {
                yield return binding.Name.Identifier.Text;
            }
        }
    }

    private static void Add(Dictionary<(string, string), List<(SourceFile, Lines, string)>> found, (string, string) key, List<(SourceFile, Lines, string)> chain, (SourceFile, Lines, string) last)
    {
        if (!found.TryGetValue(key, out var list))
        {
            found[key] = [.. chain, last];
        }
        else if (list.Count > chain.Count + 1)
        {
            // La cadena más corta es la mejor explicación.
            found[key] = [.. chain, last];
        }
    }
}
