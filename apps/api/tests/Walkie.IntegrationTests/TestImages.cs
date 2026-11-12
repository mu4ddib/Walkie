using System.Buffers.Binary;

namespace Walkie.IntegrationTests;

/// <summary>
/// Cabeceras mínimas de PNG, JPEG y WebP con las dimensiones pedidas. No son imágenes decodificables
/// completas, pero tienen la firma y las medidas que lee la API (y no traen datos de nadie).
/// </summary>
internal static class TestImages
{
    public static byte[] Create(string kind, int width, int height) => kind switch
    {
        "png" => Png(width, height),
        "jpeg" => Jpeg(width, height),
        "webp" => WebP(width, height),
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    /// <summary>PNG completo y decodificable (RGB, un degradado) para lo que de verdad dibuja la imagen, como el PDF.</summary>
    public static byte[] RealPng(int width, int height)
    {
        using var raw = new MemoryStream();
        for (var y = 0; y < height; y++)
        {
            raw.WriteByte(0); // sin filtro
            for (var x = 0; x < width; x++)
            {
                raw.Write([(byte)(x * 255 / Math.Max(1, width - 1)), (byte)(y * 255 / Math.Max(1, height - 1)), 180]);
            }
        }

        using var compressed = new MemoryStream();
        using (var zlib = new System.IO.Compression.ZLibStream(compressed, System.IO.Compression.CompressionLevel.Optimal, leaveOpen: true))
        {
            raw.Position = 0;
            raw.CopyTo(zlib);
        }

        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8; // profundidad
        header[9] = 2; // RGB
        using var png = new MemoryStream();
        png.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        Chunk(png, "IHDR", header);
        Chunk(png, "IDAT", compressed.ToArray());
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    private static void Chunk(Stream png, string type, byte[] data)
    {
        var length = new byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        png.Write(length);
        var typed = System.Text.Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
        png.Write(typed);
        var crc = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crc, Crc32(typed));
        png.Write(crc);
    }

    private static uint Crc32(byte[] bytes)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in bytes)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
            {
                crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
            }
        }

        return ~crc;
    }

    private static byte[] Png(int width, int height)
    {
        var data = new byte[33];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, (byte)'I', (byte)'H', (byte)'D', (byte)'R' }
            .CopyTo(data, 0);
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(16), width);
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(20), height);
        data[24] = 8; // profundidad
        data[25] = 6; // RGBA
        return data;
    }

    private static byte[] Jpeg(int width, int height)
    {
        // SOI, APP0 de 16 bytes y un SOF0 con alto y ancho.
        var data = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10 };
        data.AddRange(new byte[14]);
        data.AddRange([0xFF, 0xC0, 0x00, 0x11, 0x08, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width, 0x03]);
        data.AddRange(new byte[9]);
        data.AddRange([0xFF, 0xD9]);
        return [.. data];
    }

    private static byte[] WebP(int width, int height)
    {
        // RIFF/WEBP con un chunk VP8X (ancho y alto menos 1 en 24 bits).
        var data = new byte[30];
        "RIFF"u8.CopyTo(data);
        BinaryPrimitives.WriteInt32LittleEndian(data.AsSpan(4), data.Length - 8);
        "WEBPVP8X"u8.CopyTo(data.AsSpan(8));
        BinaryPrimitives.WriteInt32LittleEndian(data.AsSpan(16), 10);
        WriteUInt24(data.AsSpan(24), width - 1);
        WriteUInt24(data.AsSpan(27), height - 1);
        return data;
    }

    private static void WriteUInt24(Span<byte> target, int value)
    {
        target[0] = (byte)value;
        target[1] = (byte)(value >> 8);
        target[2] = (byte)(value >> 16);
    }
}
