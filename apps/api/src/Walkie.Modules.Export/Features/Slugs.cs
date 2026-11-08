using System.Globalization;
using System.Text;

namespace Walkie.Modules.Export.Features;

/// <summary>Nombres de archivo del export (spec export-markdown, decisión 5): minúsculas, sin acentos, con guiones.</summary>
internal static class Slugs
{
    /// <summary>"Iniciar sesión" → "iniciar-sesion"; sin letras ni dígitos → <paramref name="fallback"/>.</summary>
    public static string From(string text, string fallback = "feature")
    {
        var slug = new StringBuilder(text.Length);
        foreach (var c in text.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsAsciiLetterOrDigit(c))
            {
                slug.Append(char.ToLowerInvariant(c));
            }
            else if (slug.Length > 0 && slug[^1] != '-')
            {
                slug.Append('-');
            }
        }

        var result = slug.ToString().TrimEnd('-');
        return result.Length == 0 ? fallback : result;
    }

    /// <summary>Ruta de la imagen de una pantalla dentro del zip: <c>img/&lt;slug del título&gt;-&lt;8 del id&gt;.&lt;ext&gt;</c>.</summary>
    public static string ImagePath(string screenTitle, Guid assetId, string contentType) =>
        $"img/{From(screenTitle, "pantalla")}-{assetId.ToString("N")[..8]}.{Extension(contentType)}";

    private static string Extension(string contentType) => contentType switch
    {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "bin",
    };
}
