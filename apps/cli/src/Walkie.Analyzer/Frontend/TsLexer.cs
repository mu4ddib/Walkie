using System.Text;

namespace Walkie.Analyzer.Frontend;

internal enum TokenKind
{
    Identifier,
    String,
    Template,
    Number,
    Regex,
    Punct,
    JsxOpen,
    JsxClose,
}

/// <summary>Un atributo de JSX: valor literal, expresión (sus tokens) o ninguno (<c>&lt;Route index /&gt;</c>).</summary>
internal sealed record JsxAttribute(string Name, string? Literal, IReadOnlyList<Token>? Expression, int Offset);

/// <summary>Una plantilla <c>`…${expr}…`</c>: la cabeza y, por cada sustitución, sus tokens y el texto que la sigue.</summary>
internal sealed record TemplateParts(string Head, IReadOnlyList<(IReadOnlyList<Token> Expression, string Tail)> Spans);

/// <summary>
/// Un token. <see cref="Text"/> es el valor (cadena sin comillas y con los escapes simples resueltos), el nombre del
/// identificador, el operador o el nombre de la etiqueta JSX. <see cref="Offset"/> es la posición en el archivo.
/// </summary>
internal sealed record Token(TokenKind Kind, string Text, int Offset)
{
    public TemplateParts? Template { get; init; }

    public IReadOnlyList<JsxAttribute>? Attributes { get; init; }

    public bool SelfClosing { get; init; }

    public bool Is(string punct) => Kind == TokenKind.Punct && Text == punct;

    public bool IsIdentifier(string name) => Kind == TokenKind.Identifier && Text == name;
}

/// <summary>
/// Escáner de tokens de TypeScript, JavaScript, TSX y JSX (ADR-0013, opción a). No arma un árbol: separa cadenas,
/// plantillas, comentarios, expresiones regulares, números, identificadores, operadores y etiquetas JSX con sus
/// atributos, que es lo que necesitan los patrones de rutas y llamadas. El texto de JSX (con apóstrofes como
/// «Don't») se salta: nunca abre una cadena. Tolera archivos rotos: si algo no cierra, lo marca en
/// <see cref="HasErrors"/> y sigue con lo que pudo leer. Nunca ejecuta nada.
/// </summary>
internal sealed class TsLexer
{
    private static readonly string[] Operators =
    [
        ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
        "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
    ];

    /// <summary>Después de estos operadores, <c>/</c> empieza una expresión regular y <c>&lt;</c> puede abrir JSX.</summary>
    private static readonly HashSet<string> ExpressionStart =
    [
        "(", ",", "=", ":", "[", "!", "&", "&&", "|", "||", "?", "??", "{", "}", ";", "=>", "+", "-", "*", "%", "<", ">",
        "==", "===", "!=", "!==", "+=", "-=", "*=", "/=", "%=", "&&=", "||=", "??=", "~", "^", "...",
    ];

    private static readonly HashSet<string> ExpressionKeywords =
        ["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "default"];

    private readonly string text;
    private readonly bool jsx;
    private int pos;
    private bool unclosed;

    private TsLexer(string text, bool jsx)
    {
        this.text = text;
        this.jsx = jsx;
    }

    public bool HasErrors { get; private set; }

    /// <summary>Los tokens de <paramref name="text"/>. JSX solo en <c>.tsx</c>, <c>.jsx</c> y <c>.js</c> (en <c>.ts</c>, <c>&lt;</c> es un genérico).</summary>
    public static (IReadOnlyList<Token> Tokens, bool HasErrors) Lex(string text, bool jsx)
    {
        var lexer = new TsLexer(text, jsx);
        var tokens = new List<Token>();
        lexer.LexInto(tokens, stopAtBrace: false);
        return (tokens, lexer.HasErrors);
    }

    /// <summary>Lee tokens hasta el final, o hasta la <c>}</c> que cierra (sin consumirla) si <paramref name="stopAtBrace"/>.</summary>
    private void LexInto(List<Token> tokens, bool stopAtBrace)
    {
        var depth = 0;
        while (true)
        {
            SkipTrivia();
            if (pos >= text.Length)
            {
                if (stopAtBrace)
                {
                    HasErrors = true;
                }

                return;
            }

            var c = text[pos];
            if (stopAtBrace)
            {
                if (c == '{')
                {
                    depth++;
                }
                else if (c == '}')
                {
                    if (depth == 0)
                    {
                        return;
                    }

                    depth--;
                }
            }

            var previous = tokens.Count > 0 ? tokens[^1] : null;
            if (c is '\'' or '"')
            {
                tokens.Add(ReadString(c));
            }
            else if (c == '`')
            {
                tokens.Add(ReadTemplate());
            }
            else if (char.IsAsciiDigit(c) || (c == '.' && pos + 1 < text.Length && char.IsAsciiDigit(text[pos + 1])))
            {
                tokens.Add(ReadNumber());
            }
            else if (IsIdentifierStart(c))
            {
                tokens.Add(ReadIdentifier());
            }
            else if (c == '/' && StartsExpression(previous))
            {
                tokens.Add(ReadRegexOrPunct());
            }
            else if (c == '<' && jsx && StartsExpression(previous) && LooksLikeJsx())
            {
                // Si el elemento no cierra (un genérico que parecía JSX, o un archivo roto), se vuelve atrás y «<» es un
                // operador: así un error no se come el resto del archivo.
                var (savedPos, savedCount) = (pos, tokens.Count);
                unclosed = false;
                ReadJsxElement(tokens);
                if (unclosed)
                {
                    tokens.RemoveRange(savedCount, tokens.Count - savedCount);
                    pos = savedPos;
                    HasErrors = true;
                    tokens.Add(ReadPunct());
                }
            }
            else
            {
                tokens.Add(ReadPunct());
            }
        }
    }

    private void SkipTrivia()
    {
        while (pos < text.Length)
        {
            var c = text[pos];
            if (char.IsWhiteSpace(c))
            {
                pos++;
            }
            else if (c == '/' && pos + 1 < text.Length && text[pos + 1] == '/')
            {
                var end = text.IndexOf('\n', pos);
                pos = end < 0 ? text.Length : end + 1;
            }
            else if (c == '/' && pos + 1 < text.Length && text[pos + 1] == '*')
            {
                var end = text.IndexOf("*/", pos + 2, StringComparison.Ordinal);
                if (end < 0)
                {
                    HasErrors = true;
                    pos = text.Length;
                }
                else
                {
                    pos = end + 2;
                }
            }
            else
            {
                return;
            }
        }
    }

    /// <summary>Una cadena con comillas simples o dobles. Si no cierra antes del salto de línea no es una cadena: es la comilla sola.</summary>
    private Token ReadString(char quote)
    {
        var start = pos;
        var value = new StringBuilder();
        var i = pos + 1;
        while (i < text.Length && text[i] != quote)
        {
            if (text[i] == '\n')
            {
                HasErrors = true;
                pos = start + 1;
                return new Token(TokenKind.Punct, quote.ToString(), start);
            }

            if (text[i] == '\\' && i + 1 < text.Length)
            {
                value.Append(Escape(text[i + 1]));
                i += 2;
                continue;
            }

            value.Append(text[i]);
            i++;
        }

        if (i >= text.Length)
        {
            HasErrors = true;
        }

        pos = Math.Min(text.Length, i + 1);
        return new Token(TokenKind.String, value.ToString(), start);
    }

    private static char Escape(char c) => c switch
    {
        'n' => '\n',
        't' => '\t',
        'r' => '\r',
        _ => c,
    };

    /// <summary>Una plantilla, con sus sustituciones leídas como tokens (pueden tener cadenas, llaves y otras plantillas).</summary>
    private Token ReadTemplate()
    {
        var start = pos;
        pos++;
        var head = new StringBuilder();
        var current = head;
        var spans = new List<(IReadOnlyList<Token>, string)>();
        var tails = new List<StringBuilder>();
        while (pos < text.Length && text[pos] != '`')
        {
            if (text[pos] == '\\' && pos + 1 < text.Length)
            {
                current.Append(Escape(text[pos + 1]));
                pos += 2;
            }
            else if (text[pos] == '$' && pos + 1 < text.Length && text[pos + 1] == '{')
            {
                pos += 2;
                var expression = new List<Token>();
                LexInto(expression, stopAtBrace: true);
                pos = Math.Min(text.Length, pos + 1); // la } que cierra
                var tail = new StringBuilder();
                tails.Add(tail);
                spans.Add((expression, ""));
                current = tail;
            }
            else
            {
                current.Append(text[pos]);
                pos++;
            }
        }

        if (pos >= text.Length)
        {
            HasErrors = true;
        }

        pos = Math.Min(text.Length, pos + 1);
        var parts = new TemplateParts(head.ToString(), [.. spans.Select((s, i) => (s.Item1, tails[i].ToString()))]);
        return new Token(TokenKind.Template, text[start..Math.Min(text.Length, pos)], start) { Template = parts };
    }

    private Token ReadNumber()
    {
        var start = pos;
        while (pos < text.Length && (char.IsAsciiLetterOrDigit(text[pos]) || text[pos] is '.' or '_'))
        {
            pos++;
        }

        return new Token(TokenKind.Number, text[start..pos], start);
    }

    private static bool IsIdentifierStart(char c) => char.IsLetter(c) || c is '_' or '$' or '#' or '@';

    private Token ReadIdentifier()
    {
        var start = pos;
        pos++;
        while (pos < text.Length && (char.IsLetterOrDigit(text[pos]) || text[pos] is '_' or '$'))
        {
            pos++;
        }

        return new Token(TokenKind.Identifier, text[start..pos], start);
    }

    private static bool StartsExpression(Token? previous) =>
        previous is null
        || (previous.Kind == TokenKind.Punct && ExpressionStart.Contains(previous.Text))
        || (previous.Kind == TokenKind.Identifier && ExpressionKeywords.Contains(previous.Text))
        || previous.Kind is TokenKind.JsxOpen or TokenKind.JsxClose;

    /// <summary>Una expresión regular (hasta la <c>/</c> que cierra, fuera de clases <c>[…]</c>, sin saltos de línea) o el operador.</summary>
    private Token ReadRegexOrPunct()
    {
        var start = pos;
        var i = pos + 1;
        var inClass = false;
        while (i < text.Length && text[i] != '\n')
        {
            var c = text[i];
            if (c == '\\')
            {
                i += 2;
                continue;
            }

            if (c == '[')
            {
                inClass = true;
            }
            else if (c == ']')
            {
                inClass = false;
            }
            else if (c == '/' && !inClass)
            {
                i++;
                while (i < text.Length && char.IsAsciiLetter(text[i]))
                {
                    i++;
                }

                pos = i;
                return new Token(TokenKind.Regex, text[start..i], start);
            }

            i++;
        }

        return ReadPunct();
    }

    private Token ReadPunct()
    {
        var start = pos;
        foreach (var op in Operators)
        {
            if (string.CompareOrdinal(text, pos, op, 0, op.Length) == 0)
            {
                pos += op.Length;
                return new Token(TokenKind.Punct, op, start);
            }
        }

        pos++;
        return new Token(TokenKind.Punct, text[start].ToString(), start);
    }

    /// <summary><c>&lt;</c> seguido de un nombre (o <c>&gt;</c> de un fragmento), y no un genérico de flecha (<c>&lt;T,&gt;</c>, <c>&lt;T extends U&gt;</c>).</summary>
    private bool LooksLikeJsx()
    {
        var i = pos + 1;
        if (i < text.Length && text[i] == '>')
        {
            return true;
        }

        if (i >= text.Length || !(char.IsLetter(text[i]) || text[i] == '_'))
        {
            return false;
        }

        var nameEnd = i;
        while (nameEnd < text.Length && (char.IsLetterOrDigit(text[nameEnd]) || text[nameEnd] is '_' or '.' or '-' or ':'))
        {
            nameEnd++;
        }

        var next = nameEnd;
        while (next < text.Length && text[next] is ' ' or '\t')
        {
            next++;
        }

        if (next < text.Length && text[next] == ',')
        {
            return false;
        }

        return string.CompareOrdinal(text, next, "extends ", 0, 8) != 0;
    }

    /// <summary>
    /// Un elemento JSX completo: la etiqueta de apertura con sus atributos, las expresiones <c>{…}</c> de los hijos como
    /// tokens normales (ahí puede haber llamadas o más rutas) y la etiqueta de cierre. El texto entre etiquetas se salta.
    /// </summary>
    private void ReadJsxElement(List<Token> tokens)
    {
        var start = pos;
        pos++; // <
        var name = ReadJsxName();
        SkipJsxTypeArguments();
        var attributes = new List<JsxAttribute>();
        var inline = new List<Token>();
        var selfClosing = false;
        while (true)
        {
            SkipTrivia();
            if (pos >= text.Length)
            {
                HasErrors = true;
                unclosed = true;
                break;
            }

            if (text[pos] == '/' && pos + 1 < text.Length && text[pos + 1] == '>')
            {
                pos += 2;
                selfClosing = true;
                break;
            }

            if (text[pos] == '>')
            {
                pos++;
                break;
            }

            if (text[pos] == '{')
            {
                // {...props}
                pos++;
                var spread = new List<Token>();
                LexInto(spread, stopAtBrace: true);
                pos = Math.Min(text.Length, pos + 1);
                inline.AddRange(spread);
                continue;
            }

            var attributeStart = pos;
            var attribute = ReadJsxName();
            if (attribute.Length == 0)
            {
                HasErrors = true;
                pos++;
                continue;
            }

            SkipTrivia();
            if (pos < text.Length && text[pos] == '=')
            {
                pos++;
                SkipTrivia();
                if (pos < text.Length && text[pos] is '"' or '\'')
                {
                    var quote = text[pos];
                    var end = text.IndexOf(quote, pos + 1);
                    if (end < 0)
                    {
                        HasErrors = true;
                        pos = text.Length;
                        break;
                    }

                    attributes.Add(new JsxAttribute(attribute, text[(pos + 1)..end], null, attributeStart));
                    pos = end + 1;
                }
                else if (pos < text.Length && text[pos] == '{')
                {
                    pos++;
                    var expression = new List<Token>();
                    LexInto(expression, stopAtBrace: true);
                    pos = Math.Min(text.Length, pos + 1);
                    attributes.Add(new JsxAttribute(attribute, null, expression, attributeStart));
                    inline.AddRange(expression);
                }
                else if (pos < text.Length && text[pos] == '<')
                {
                    var element = new List<Token>();
                    ReadJsxElement(element);
                    attributes.Add(new JsxAttribute(attribute, null, element, attributeStart));
                    inline.AddRange(element);
                }
            }
            else
            {
                attributes.Add(new JsxAttribute(attribute, null, null, attributeStart));
            }
        }

        tokens.Add(new Token(TokenKind.JsxOpen, name, start) { Attributes = attributes, SelfClosing = selfClosing });
        tokens.AddRange(inline);
        if (!selfClosing)
        {
            ReadJsxChildren(tokens, name);
        }
    }

    /// <summary>Argumentos de tipo de un elemento de TSX (<c>&lt;Menu&lt;App&gt; …&gt;</c>): se saltan.</summary>
    private void SkipJsxTypeArguments()
    {
        SkipTrivia();
        if (pos >= text.Length || text[pos] != '<')
        {
            return;
        }

        var depth = 0;
        for (var i = pos; i < text.Length; i++)
        {
            if (text[i] == '<')
            {
                depth++;
            }
            else if (text[i] == '>' && --depth == 0)
            {
                pos = i + 1;
                return;
            }
        }
    }

    private string ReadJsxName()
    {
        var start = pos;
        while (pos < text.Length && (char.IsLetterOrDigit(text[pos]) || text[pos] is '_' or '.' or '-' or ':' or '$'))
        {
            pos++;
        }

        return text[start..pos];
    }

    /// <summary>Hijos de un elemento hasta su cierre: texto (se salta), expresiones y elementos anidados.</summary>
    private void ReadJsxChildren(List<Token> tokens, string name)
    {
        while (pos < text.Length)
        {
            var c = text[pos];
            if (c == '{')
            {
                pos++;
                LexInto(tokens, stopAtBrace: true);
                pos = Math.Min(text.Length, pos + 1);
            }
            else if (c == '<' && pos + 1 < text.Length && text[pos + 1] == '/')
            {
                var start = pos;
                pos += 2;
                var closing = ReadJsxName();
                var end = text.IndexOf('>', pos);
                pos = end < 0 ? text.Length : end + 1;
                tokens.Add(new Token(TokenKind.JsxClose, closing, start));
                if (closing != name)
                {
                    HasErrors = true;
                }

                return;
            }
            else if (c == '<')
            {
                ReadJsxElement(tokens);
            }
            else
            {
                pos++;
            }
        }

        HasErrors = true; // el elemento no cerró
        unclosed = true;
    }
}
