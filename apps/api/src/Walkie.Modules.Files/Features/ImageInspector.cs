using System.Buffers.Binary;

namespace Walkie.Modules.Files.Features;

/// <summary>
/// Reconoce PNG, JPEG y WebP por su contenido (no por la extensión ni el Content-Type que manda el cliente)
/// y lee sus dimensiones de la cabecera. SVG y el resto se rechazan (spec imagenes-portal, decisión 2).
/// </summary>
internal static class ImageInspector
{
    public sealed record ImageInfo(string ContentType, int Width, int Height);

    /// <summary>Tipo y dimensiones; <c>null</c> si no es una imagen permitida o la cabecera está rota.</summary>
    public static ImageInfo? Inspect(ReadOnlySpan<byte> data)
    {
        if (IsPng(data) && data.Length >= 24)
        {
            return Valid(new ImageInfo("image/png",
                BinaryPrimitives.ReadInt32BigEndian(data[16..]), BinaryPrimitives.ReadInt32BigEndian(data[20..])));
        }

        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
        {
            return Jpeg(data);
        }

        if (data.Length >= 30 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8))
        {
            return WebP(data);
        }

        return null;
    }

    private static bool IsPng(ReadOnlySpan<byte> data) =>
        data.Length >= 8 && data[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });

    /// <summary>Recorre los segmentos hasta un SOF (0xC0–0xCF salvo C4, C8 y CC), que trae alto y ancho.</summary>
    private static ImageInfo? Jpeg(ReadOnlySpan<byte> data)
    {
        var i = 2;
        while (i + 9 < data.Length)
        {
            if (data[i] != 0xFF)
            {
                return null;
            }

            var marker = data[i + 1];
            if (marker == 0xFF)
            {
                i++;
                continue;
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(data[(i + 2)..]);
            if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
            {
                return Valid(new ImageInfo("image/jpeg",
                    BinaryPrimitives.ReadUInt16BigEndian(data[(i + 7)..]), BinaryPrimitives.ReadUInt16BigEndian(data[(i + 5)..])));
            }

            i += 2 + length;
        }

        return null;
    }

    private static ImageInfo? WebP(ReadOnlySpan<byte> data)
    {
        var chunk = data[12..16];
        if (chunk.SequenceEqual("VP8X"u8))
        {
            return Valid(new ImageInfo("image/webp", 1 + UInt24(data[24..]), 1 + UInt24(data[27..])));
        }

        if (chunk.SequenceEqual("VP8L"u8) && data[20] == 0x2F)
        {
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(data[21..]);
            return Valid(new ImageInfo("image/webp", (int)(bits & 0x3FFF) + 1, (int)((bits >> 14) & 0x3FFF) + 1));
        }

        if (chunk.SequenceEqual("VP8 "u8) && data[23] == 0x9D && data[24] == 0x01 && data[25] == 0x2A)
        {
            return Valid(new ImageInfo("image/webp",
                BinaryPrimitives.ReadUInt16LittleEndian(data[26..]) & 0x3FFF,
                BinaryPrimitives.ReadUInt16LittleEndian(data[28..]) & 0x3FFF));
        }

        return null;
    }

    private static int UInt24(ReadOnlySpan<byte> b) => b[0] | (b[1] << 8) | (b[2] << 16);

    private static ImageInfo? Valid(ImageInfo info) => info.Width > 0 && info.Height > 0 ? info : null;
}
