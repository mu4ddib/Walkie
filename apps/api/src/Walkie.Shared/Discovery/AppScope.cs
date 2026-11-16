using System.Text;
using System.Text.RegularExpressions;

namespace Walkie.Shared.Discovery;

/// <summary>
/// El ámbito de una app dentro de una fuente (ADR-0014, formatVersion 1): la parte de la clave de una pantalla o de un
/// candidato a feature que distingue las apps de un monorepo (<c>screen:&lt;ámbito&gt;:&lt;ruta&gt;</c>).
/// <list type="bullet">
/// <item><b>Por defecto</b>, la carpeta de la app relativa a la raíz analizada, con <c>/</c> (<c>apps/web</c>); <c>.</c>
/// si la app está en la raíz. Es única dentro de la fuente (dos apps no comparten carpeta), determinista y no depende
/// del nombre del paquete, que se cambia sin mover nada.</item>
/// <item><b>Elegido por el equipo</b> en <c>.walkie/source.json</c> (<c>"apps": { "apps/web": "web" }</c>): sirve para
/// conservar la identidad al mover una carpeta. La CLI lo lee y nunca lo escribe.</item>
/// </list>
/// Nunca tiene <c>:</c>: así la clave se separa sin ambigüedad. Un carácter fuera de <c>[A-Za-z0-9._~@+-]</c> en una
/// carpeta se escribe como <c>%XX</c> (UTF-8), así dos carpetas distintas nunca dan el mismo ámbito.
/// </summary>
public static partial class AppScope
{
    /// <summary>El ámbito de la app en la raíz analizada.</summary>
    public const string Root = ".";

    public const int MaxLength = 200;

    /// <summary>El ámbito por defecto de una app cuya carpeta relativa es <paramref name="directory"/> (vacía = raíz).</summary>
    public static string FromDirectory(string directory)
    {
        ArgumentNullException.ThrowIfNull(directory);
        var clean = directory.Replace('\\', '/').Trim('/');
        if (clean.Length == 0 || clean == ".")
        {
            return Root;
        }

        var builder = new StringBuilder(clean.Length);
        foreach (var segment in clean.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (builder.Length > 0)
            {
                builder.Append('/');
            }

            foreach (var b in Encoding.UTF8.GetBytes(segment))
            {
                var c = (char)b;
                if (b < 0x80 && (char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '~' or '@' or '+' or '-'))
                {
                    builder.Append(c);
                }
                else
                {
                    builder.Append('%').Append(b.ToString("X2", System.Globalization.CultureInfo.InvariantCulture));
                }
            }
        }

        return builder.ToString();
    }

    /// <summary>Si <paramref name="scope"/> puede ir en una clave: <c>.</c> o segmentos separados por <c>/</c>, sin <c>:</c> ni espacios.</summary>
    public static bool IsValid(string? scope) => scope is not null && scope.Length <= MaxLength && Pattern().IsMatch(scope);

    /// <summary>Lo mismo que <c>$defs/appScope</c> de <c>walkie-discovery.schema.json</c>.</summary>
    [GeneratedRegex(@"^[A-Za-z0-9._~@+%-]+(/[A-Za-z0-9._~@+%-]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
