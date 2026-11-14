using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Walkie.Analyzer.Detectors;

/// <summary>Ayudas sintácticas (sin modelo semántico: no se compila nada).</summary>
internal static class Roslyn
{
    /// <summary>Líneas (desde 1) de un nodo.</summary>
    public static Lines LinesOf(SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        return new Lines(span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1);
    }

    /// <summary>Ancla estable: <c>Clase.Método</c> que contiene al nodo (o <c>Program</c> en instrucciones de nivel superior).</summary>
    public static string SymbolOf(SyntaxNode node)
    {
        var type = node.Ancestors().OfType<BaseTypeDeclarationSyntax>().FirstOrDefault()?.Identifier.Text ?? "Program";
        var member = node.AncestorsAndSelf().FirstOrDefault(a => a is BaseMethodDeclarationSyntax or LocalFunctionStatementSyntax or PropertyDeclarationSyntax) switch
        {
            MethodDeclarationSyntax m => m.Identifier.Text,
            ConstructorDeclarationSyntax => ".ctor",
            LocalFunctionStatementSyntax f => f.Identifier.Text,
            PropertyDeclarationSyntax p => p.Identifier.Text,
            _ => null,
        };
        return member is null ? type : $"{type}.{member}";
    }

    /// <summary>Valor de un literal de cadena (también verbatim y raw), o null si no es literal.</summary>
    public static string? StringLiteral(ExpressionSyntax? expression) =>
        expression is LiteralExpressionSyntax literal && literal.IsKind(SyntaxKind.StringLiteralExpression)
            ? literal.Token.ValueText
            : null;

    /// <summary>Nombre simple de un tipo (<c>DbSet&lt;T&gt;</c> → <c>DbSet</c>, <c>A.B.C</c> → <c>C</c>).</summary>
    public static string? SimpleName(TypeSyntax type) => type switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        GenericNameSyntax generic => generic.Identifier.Text,
        QualifiedNameSyntax qualified => SimpleName(qualified.Right),
        AliasQualifiedNameSyntax alias => SimpleName(alias.Name),
        _ => null,
    };

    /// <summary>Nombre del método invocado (<c>x.MapGet(...)</c> → <c>MapGet</c>).</summary>
    public static string? InvokedName(InvocationExpressionSyntax invocation) => invocation.Expression switch
    {
        MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
        IdentifierNameSyntax id => id.Identifier.Text,
        GenericNameSyntax generic => generic.Identifier.Text,
        _ => null,
    };
}
