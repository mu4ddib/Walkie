using System.Text;
using System.Text.RegularExpressions;

namespace Walkie.Modules.Export.Features;

/// <summary>Escapado para que los textos del lienzo se vean tal cual (spec export-markdown, criterio 8).</summary>
internal static partial class MarkdownText
{
    private const string Special = "\\`*_[]<>#|~";

    /// <summary>Texto en una línea (títulos, celdas de tabla, listas): sin saltos de línea y con los símbolos escapados.</summary>
    public static string Inline(string text) => EscapeLine(OneLine(text));

    /// <summary>Párrafo de varias líneas: cada línea escapada; un salto de línea se mantiene (dos espacios al final).</summary>
    public static string Block(string text) =>
        string.Join("  \n", text.ReplaceLineEndings("\n").Split('\n').Select(EscapeLine));

    /// <summary>
    /// Bloque de código con una cerca más larga que cualquier racha de comillas invertidas del texto; con
    /// <paramref name="language"/> (ej. <c>json</c>), resaltado.
    /// </summary>
    public static string CodeBlock(string text, string language = "")
    {
        var fence = new string('`', Math.Max(3, LongestRun(text, '`') + 1));
        return $"{fence}{language}\n{text.ReplaceLineEndings("\n")}\n{fence}";
    }

    /// <summary>Código en línea (<c>GET /ruta</c>), con tantas comillas como haga falta.</summary>
    public static string Code(string text)
    {
        var line = OneLine(text);
        var ticks = new string('`', LongestRun(line, '`') + 1);
        var pad = line.StartsWith('`') || line.EndsWith('`') ? " " : string.Empty;
        return $"{ticks}{pad}{line}{pad}{ticks}";
    }

    /// <summary>Etiqueta de Mermaid entre comillas: comillas, &lt;, &gt; y # como códigos de entidad.</summary>
    public static string Mermaid(string text) =>
        OneLine(text)
            .Replace("#", "#35;", StringComparison.Ordinal)
            .Replace("\"", "#quot;", StringComparison.Ordinal)
            .Replace("<", "#lt;", StringComparison.Ordinal)
            .Replace(">", "#gt;", StringComparison.Ordinal);

    /// <summary>Sangría para seguir un elemento de lista en la línea siguiente.</summary>
    public static string Indent(string text, int spaces) =>
        text.Replace("\n", "\n" + new string(' ', spaces), StringComparison.Ordinal);

    private static string OneLine(string text) =>
        WhiteSpace().Replace(text.ReplaceLineEndings(" "), " ").Trim();

    private static string EscapeLine(string line)
    {
        var escaped = new StringBuilder(line.Length + 8);
        foreach (var c in line)
        {
            if (Special.Contains(c, StringComparison.Ordinal))
            {
                escaped.Append('\\');
            }

            escaped.Append(c);
        }

        // Al inicio de línea, "- ", "+ ", "= " o "1. " se volverían lista o subrayado.
        var result = escaped.ToString();
        if (result.Length > 0 && result[0] is '-' or '+' or '=')
        {
            return "\\" + result;
        }

        return OrderedListStart().Replace(result, @"$1\.");
    }

    private static int LongestRun(string text, char c)
    {
        int longest = 0, current = 0;
        foreach (var ch in text)
        {
            current = ch == c ? current + 1 : 0;
            longest = Math.Max(longest, current);
        }

        return longest;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhiteSpace();

    [GeneratedRegex(@"^(\d+)\.")]
    private static partial Regex OrderedListStart();
}
