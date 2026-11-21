using System.Text.Json;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Tamaño con que el navegador dibuja una caja del lienzo según su contenido (spec walkie-live-documentacion). Lo
/// nominal (184 × 72) se queda corto: una API de ruta larga mide hasta 264 × 242 y una pantalla con título largo crece
/// varias líneas. La estimación se ajustó midiendo <c>.pixel-node</c> en Chromium y es conservadora (nunca menor que
/// lo medido). La misma fórmula está en la web (<c>boxSize</c> en <c>discovery/layout/layoutQuality.ts</c>): la
/// distribución del lienzo inicial reserva este tamaño y la API rechaza lo que se encima con él.
/// </summary>
internal static class BoxSizes
{
    public const double MinWidth = 184;
    public const double MaxWidth = 264;

    /// <summary>Caracteres por línea con el ancho máximo: título (Plex Sans), método y ruta (Plex Mono), descripción.</summary>
    private const int TitlePerLine = 29;
    private const int HttpPerLine = 30;
    private const int DescriptionPerLine = 40;

    /// <summary>
    /// Tamaño de una caja con <paramref name="title"/>, la línea de método y ruta (<paramref name="http"/>) y la
    /// descripción (la caja muestra hasta 2 líneas).
    /// </summary>
    public static (double W, double H) Estimate(string title, string? http = null, string? description = null, double extra = 0)
    {
        var longest = Math.Max(title.Length * 8.4, Math.Max((description?.Length ?? 0) * 6.3, (http?.Length ?? 0) * 7.6));
        var width = Math.Clamp(Math.Ceiling((longest + 12) / 8) * 8, MinWidth, MaxWidth);
        var height = 50 + (19 * Lines(title, TitlePerLine));
        if (!string.IsNullOrEmpty(http))
        {
            height += 20 * Lines(http, HttpPerLine);
        }

        if (!string.IsNullOrEmpty(description))
        {
            height += 18 * Math.Min(2, Lines(description, DescriptionPerLine));
        }

        return (width, height + extra);
    }

    /// <summary>
    /// Tamaño de una caja de un lienzo guardado: lo explícito de su <c>layout</c> manda (un grupo o el ancho de un
    /// módulo); lo que falta se estima con su contenido (un <c>ref</c> se dibuja como su elemento: título y su firma).
    /// </summary>
    public static (double W, double H) OfSaved(JsonElement? node, JsonElement layout)
    {
        var (w, h) = node is { } n ? OfNode(n) : (MinWidth, 72d);
        return (Number(layout, "w") ?? w, Number(layout, "h") ?? h);
    }

    private static (double W, double H) OfNode(JsonElement node)
    {
        var type = Text(node, "type") ?? "";
        var title = Text(node, "title") ?? "";
        string? http = null;
        if (node.TryGetProperty("http", out var contract) && contract.ValueKind == JsonValueKind.Object)
        {
            http = $"{Text(contract, "method")} {Text(contract, "path")}".Trim();
        }
        else if (type == "ref")
        {
            // El título de un componente es el último conocido; su elemento suele llevar método y ruta.
            http = title;
        }

        double extra = 0;
        if (node.TryGetProperty("inputs", out var inputs) && inputs.ValueKind == JsonValueKind.Array)
        {
            extra += 16 + (16 * Math.Min(6, inputs.GetArrayLength()));
        }

        if (Text(node, "expression") is { } expression)
        {
            extra += 16 * Math.Min(4, expression.Split('\n').Length);
        }

        if (Text(node, "assetId") is not null)
        {
            extra += 112;
        }

        return Estimate(title, http, Text(node, "description"), extra);
    }

    /// <summary>Líneas de un texto partido por palabras; una palabra más larga que la línea ocupa las que necesite.</summary>
    internal static int Lines(string text, int perLine)
    {
        var lines = 1;
        var used = 0;
        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (used > 0 && used + 1 + word.Length <= perLine)
            {
                used += 1 + word.Length;
                continue;
            }

            if (used > 0)
            {
                lines++;
            }

            lines += (word.Length - 1) / perLine;
            used = ((word.Length - 1) % perLine) + 1;
        }

        return lines;
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static double? Number(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : null;
}
