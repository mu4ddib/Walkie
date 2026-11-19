using System.Globalization;
using System.Text;

namespace Walkie.Shared.Discovery;

/// <summary>
/// Claves estables de las entidades y relaciones de un <c>.walkiepack</c> (ADR-0014). Salen de lo que define al
/// componente (método y ruta, nombre, motor…), nunca de líneas ni de la ruta del archivo: así el mismo componente se
/// reconoce entre análisis aunque se mueva o se renombre un parámetro. Las usan el analizador al escribir y la API al
/// validar.
/// </summary>
public static class DiscoveryKeys
{
    /// <summary><c>api:&lt;MÉTODO&gt; &lt;ruta normalizada&gt;</c>.</summary>
    public static string Api(string method, string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(method);
        return $"api:{method.Trim().ToUpperInvariant()} {NormalizePath(path)}";
    }

    /// <summary>
    /// <c>screen:&lt;ámbito&gt;:&lt;ruta normalizada&gt;</c> (formatVersion 1): la misma ruta en dos apps de un monorepo son dos
    /// pantallas. El ámbito es el de <see cref="AppScope"/>.
    /// </summary>
    public static string Screen(string scope, string route) => $"screen:{CheckScope(scope)}:{NormalizePath(route)}";

    /// <summary><c>screen:&lt;ruta normalizada&gt;</c>: la clave de la versión 0, sin la app. Solo para migrar y reconocer decisiones viejas.</summary>
    public static string ScreenV0(string route) => $"screen:{NormalizePath(route)}";

    /// <summary><c>service:&lt;nombre&gt;</c> (nombre del proyecto o del servicio de compose).</summary>
    public static string Service(string name) => Simple("service", name);

    /// <summary><c>database:&lt;motor en minúsculas&gt;/&lt;nombre&gt;</c>.</summary>
    public static string Database(string engine, string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(engine);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
#pragma warning disable CA1308 // el motor se compara sin mayúsculas (PostgreSQL = postgresql) y se escribe en minúsculas
        return $"database:{engine.Trim().ToLowerInvariant()}/{name.Trim()}";
#pragma warning restore CA1308
    }

    /// <summary><c>resource:&lt;subtipo&gt;/&lt;nombre&gt;</c> (subtipo de <c>$defs/resource</c> del grafo).</summary>
    public static string Resource(string kind, string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(kind);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return $"resource:{kind.Trim()}/{name.Trim()}";
    }

    /// <summary><c>module:&lt;nombre&gt;</c>.</summary>
    public static string Module(string name) => Simple("module", name);

    /// <summary><c>feature:&lt;ámbito&gt;:&lt;nombre&gt;</c> (formatVersion 1): dos apps con un candidato del mismo nombre son dos candidatos.</summary>
    public static string Feature(string scope, string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return $"feature:{CheckScope(scope)}:{name.Trim()}";
    }

    /// <summary><c>feature:&lt;nombre&gt;</c>: la clave de la versión 0. Solo para migrar y reconocer decisiones viejas.</summary>
    public static string FeatureV0(string name) => Simple("feature", name);

    /// <summary>
    /// Separa una clave con ámbito (<c>screen:web:/pedidos</c>, <c>feature:web:Pedidos</c>) en el ámbito y el resto (la
    /// ruta o el nombre). El ámbito nunca tiene <c>:</c>, así que el primero lo cierra. False si no es de ese tipo o no
    /// tiene ámbito (una clave de la versión 0: <c>screen:/pedidos</c>).
    /// </summary>
    public static bool TryParseScoped(string key, string kind, out string scope, out string rest)
    {
        scope = rest = "";
        var prefix = kind + ":";
        if (!key.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var body = key[prefix.Length..];
        var colon = body.IndexOf(':', StringComparison.Ordinal);
        if (colon <= 0 || (kind == "screen" && body[0] == '/'))
        {
            return false;
        }

        scope = body[..colon];
        rest = body[(colon + 1)..];
        return AppScope.IsValid(scope) && rest.Length > 0 && (kind != "screen" || rest[0] == '/');
    }

    /// <summary>La clave de la versión 0 que corresponde a una clave con ámbito (sin la app); null si no tiene ámbito.</summary>
    public static string? WithoutScope(string key)
    {
        foreach (var kind in new[] { "screen", "feature" })
        {
            if (TryParseScoped(key, kind, out _, out var rest))
            {
                return $"{kind}:{rest}";
            }
        }

        return null;
    }

    private static string CheckScope(string scope) =>
        AppScope.IsValid(scope) ? scope : throw new ArgumentException($"Ámbito de app inválido: «{scope}».", nameof(scope));

    /// <summary><c>&lt;kind&gt;:&lt;from&gt;-&gt;&lt;to&gt;</c>.</summary>
    public static string Relation(string kind, string from, string to) => $"{kind}:{from}->{to}";

    /// <summary>
    /// Ruta de una API o de una pantalla sin lo que varía entre estilos: barra inicial, sin barras repetidas ni final,
    /// y cada parámetro como <c>{}</c> (<c>{id}</c>, <c>{id:int}</c>, <c>{*resto}</c>, <c>:id</c>, <c>[id]</c>, <c>[...slug]</c>).
    /// Se conservan mayúsculas y minúsculas. Sin query ni fragmento.
    /// </summary>
    public static string NormalizePath(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        var cut = path.IndexOfAny(['?', '#']);
        var clean = (cut >= 0 ? path[..cut] : path).Trim();
        var segments = clean.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var builder = new StringBuilder();
        foreach (var segment in segments)
        {
            builder.Append('/').Append(IsParameter(segment) ? "{}" : segment);
        }

        return builder.Length == 0 ? "/" : builder.ToString();
    }

    private static bool IsParameter(string segment) =>
        (segment.StartsWith('{') && segment.EndsWith('}'))
        || (segment.StartsWith('[') && segment.EndsWith(']'))
        || (segment.Length > 1 && segment[0] == ':');

    private static string Simple(string kind, string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return string.Create(CultureInfo.InvariantCulture, $"{kind}:{name.Trim()}");
    }
}
