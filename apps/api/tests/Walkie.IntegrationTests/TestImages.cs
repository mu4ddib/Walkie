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
