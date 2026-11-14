using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Walkie.Shared.Discovery;

/// <summary>
/// Fingerprints del <c>.walkiepack</c> (ADR-0014): <c>sha256:</c> + SHA-256 en hexadecimal del JSON canónico
/// (claves ordenadas por código, sin espacios, cadenas con el escape mínimo de RFC 8785, enteros tal cual). El de una
/// entidad excluye lo que no es su contenido (<see cref="NonContentFields"/>): cambia si cambia lo que describe, no si
/// cambia su evidencia o su confianza.
/// </summary>
public static class DiscoveryFingerprint
{
    /// <summary>Campos de una entidad que no entran en su fingerprint.</summary>
    public static IReadOnlySet<string> NonContentFields { get; } =
        new HashSet<string>(["key", "fingerprint", "basis", "confidence", "derivedFrom", "evidence"], StringComparer.Ordinal);

    /// <summary>Fingerprint del contenido de una entidad.</summary>
    public static string Entity(JsonElement entity) => Hash(Canonical(entity, NonContentFields));

    /// <summary>Fingerprint de un <c>discovery.json</c> completo (identidad del contenido de un análisis).</summary>
    public static string Content(JsonElement discovery) => Hash(Canonical(discovery, null));

    /// <summary>JSON canónico de <paramref name="value"/>, sin las propiedades de primer nivel de <paramref name="skip"/>.</summary>
    public static string Canonical(JsonElement value, IReadOnlySet<string>? skip)
    {
        var builder = new StringBuilder();
        Write(value, builder, skip);
        return builder.ToString();
    }

    private static string Hash(string canonical) =>
        "sha256:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));

    private static void Write(JsonElement value, StringBuilder builder, IReadOnlySet<string>? skip)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                builder.Append('{');
                var first = true;
                foreach (var property in value.EnumerateObject()
                    .Where(p => skip is null || !skip.Contains(p.Name))
                    .OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    if (!first)
                    {
                        builder.Append(',');
                    }

                    first = false;
                    WriteString(property.Name, builder);
                    builder.Append(':');
                    Write(property.Value, builder, null);
                }

                builder.Append('}');
                break;
            case JsonValueKind.Array:
                builder.Append('[');
                var index = 0;
                foreach (var item in value.EnumerateArray())
                {
                    if (index++ > 0)
                    {
                        builder.Append(',');
                    }

                    Write(item, builder, null);
                }

                builder.Append(']');
                break;
            case JsonValueKind.String:
                WriteString(value.GetString()!, builder);
                break;
            case JsonValueKind.Number:
                builder.Append(value.TryGetInt64(out var integer)
                    ? integer.ToString(CultureInfo.InvariantCulture)
                    : value.GetDouble().ToString("R", CultureInfo.InvariantCulture));
                break;
            case JsonValueKind.True:
                builder.Append("true");
                break;
            case JsonValueKind.False:
                builder.Append("false");
                break;
            default:
                builder.Append("null");
                break;
        }
    }

    private static void WriteString(string text, StringBuilder builder)
    {
        builder.Append('"');
        foreach (var c in text)
        {
            switch (c)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (c < 0x20)
                    {
                        builder.Append(CultureInfo.InvariantCulture, $"\\u{(int)c:x4}");
                    }
                    else
                    {
                        builder.Append(c);
                    }

                    break;
            }
        }

        builder.Append('"');
    }
}
