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

    /// <summary><c>screen:&lt;ruta normalizada&gt;</c>.</summary>
    public static string Screen(string route) => $"screen:{NormalizePath(route)}";

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

    /// <summary><c>feature:&lt;nombre&gt;</c>.</summary>
    public static string Feature(string name) => Simple("feature", name);

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
