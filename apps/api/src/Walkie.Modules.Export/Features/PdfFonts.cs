using System.Reflection;
using PdfSharp.Fonts;

namespace Walkie.Modules.Export.Features;

/// <summary>
/// Fuentes del PDF (ADR-0008): PDFsharp no usa las del sistema en Linux, así que se le dan IBM Plex Sans y Mono
/// (SIL OFL 1.1) embebidas en el ensamblado. Cualquier otra familia cae en IBM Plex Sans.
/// </summary>
internal sealed class PdfFonts : IFontResolver
{
    public const string Sans = "IBM Plex Sans";
    public const string Mono = "IBM Plex Mono";

    private static readonly Lock Gate = new();
    private static bool _installed;

    /// <summary>Lo registra una vez por proceso (PDFsharp no deja cambiarlo después de usarlo).</summary>
    public static void Install()
    {
        lock (Gate)
        {
            if (_installed)
            {
                return;
            }

            GlobalFontSettings.FontResolver = new PdfFonts();
            _installed = true;
        }
    }

    public FontResolverInfo ResolveTypeface(string familyName, bool bold, bool italic)
    {
        if (string.Equals(familyName, Mono, StringComparison.OrdinalIgnoreCase))
        {
            return new FontResolverInfo("IBMPlexMono-Regular", bold, italic);
        }

        // La semibold hace de negrita y la itálica de cursiva; negrita y cursiva a la vez se simula.
        return (bold, italic) switch
        {
            (true, false) => new FontResolverInfo("IBMPlexSans-SemiBold"),
            (false, true) => new FontResolverInfo("IBMPlexSans-Italic"),
            (true, true) => new FontResolverInfo("IBMPlexSans-SemiBold", false, true),
            _ => new FontResolverInfo("IBMPlexSans-Regular"),
        };
    }

    public byte[] GetFont(string faceName)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"Walkie.Fonts.{faceName}.ttf")
            ?? throw new InvalidOperationException($"Falta la fuente embebida {faceName}.");
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }
}
