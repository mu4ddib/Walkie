using System.Globalization;
using System.IO.Compression;
using System.Text.Json;

namespace Walkie.Shared.Packages;

/// <summary>
/// Cómo leer un paquete <c>.zip</c> subido por una persona (<c>.walkie</c> de ADR-0009, <c>.walkiepack</c> de
/// ADR-0013). Las opciones por defecto son las de la importación de un <c>.walkie</c>; un formato nuevo puede pedir más.
/// </summary>
public sealed record SafeZipOptions
{
    /// <summary>Nombre del formato en los mensajes (ej. <c>.walkie</c>).</summary>
    public string FormatName { get; init; } = ".walkie";

    public int MaxEntries { get; init; } = 2000;

    /// <summary>Tope de lo descomprimido: lo que declaran las entradas y lo que de verdad se lee (contra zip bombs).</summary>
    public long MaxUncompressedBytes { get; init; } = 200L * 1024 * 1024;

    /// <summary>
    /// Rechazar nombres repetidos. Sin esto, gana la primera entrada (comportamiento del <c>.walkie</c>); con esto,
    /// un paquete no puede esconder una segunda versión de un documento.
    /// </summary>
    public bool RejectDuplicateNames { get; init; }

    /// <summary>
    /// Rechazar nombres que no son rutas relativas limpias: absolutas, con unidad de Windows, con <c>\</c>, con
    /// segmentos <c>.</c> o <c>..</c>, vacíos o con caracteres de control (Zip Slip, aunque nada se extraiga a disco).
    /// </summary>
    public bool RejectUnsafeNames { get; init; }

    /// <summary>Si se da, las únicas entradas permitidas (sin carpetas): cualquier otra es un error.</summary>
    public IReadOnlySet<string>? AllowedEntries { get; init; }
}

/// <summary>
/// Lectura segura de un <c>.zip</c> en memoria. Nunca extrae a disco ni ejecuta nada: lee entradas por nombre, sin
/// creerle al tamaño que declaran (corta al pasar del máximo) y con un tope total de bytes descomprimidos. Los
/// errores van a un diccionario por ruta, como los demás errores de paquete (<c>file</c> para el archivo entero).
/// </summary>
public sealed class SafeZip : IDisposable
{
    private readonly ZipArchive archive;
    private readonly SafeZipOptions options;
    private long totalRead;

    private SafeZip(ZipArchive archive, Dictionary<string, ZipArchiveEntry> entries, SafeZipOptions options)
    {
        this.archive = archive;
        this.options = options;
        Entries = entries;
    }

    /// <summary>Entradas por nombre completo.</summary>
    public IReadOnlyDictionary<string, ZipArchiveEntry> Entries { get; }

    /// <summary>Abre y revisa el zip; null (con el error en <paramref name="errors"/>) si no se puede usar.</summary>
    public static SafeZip? Open(byte[] file, SafeZipOptions options, Dictionary<string, string[]> errors)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(errors);
        ZipArchive archive;
        try
        {
            archive = new ZipArchive(new MemoryStream(file, writable: false), ZipArchiveMode.Read);
        }
        catch (InvalidDataException)
        {
            errors["file"] = [$"No es un archivo {options.FormatName} válido: no se pudo abrir como .zip."];
            return null;
        }

        if (archive.Entries.Count > options.MaxEntries)
        {
            errors["file"] = [string.Create(CultureInfo.InvariantCulture, $"El archivo tiene demasiadas entradas (más de {options.MaxEntries}).")];
            archive.Dispose();
            return null;
        }

        if (archive.Entries.Sum(e => e.Length) > options.MaxUncompressedBytes)
        {
            errors["file"] = [string.Create(CultureInfo.InvariantCulture,
                $"El contenido del archivo descomprimido pasa de {options.MaxUncompressedBytes / (1024 * 1024)} MB.")];
            archive.Dispose();
            return null;
        }

        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.Ordinal);
        var problems = new Dictionary<string, string[]>(StringComparer.Ordinal);
        foreach (var entry in archive.Entries)
        {
            var name = entry.FullName;
            if (options.RejectUnsafeNames && UnsafeName(name) is { } reason)
            {
                problems.TryAdd($"file/{Printable(name)}", [$"Nombre de entrada inválido: {reason}."]);
                continue;
            }

            if (options.AllowedEntries is { } allowed && !allowed.Contains(name))
            {
                problems.TryAdd($"file/{Printable(name)}",
                    [$"Entrada inesperada: un {options.FormatName} solo trae {string.Join(" y ", allowed.Order(StringComparer.Ordinal))}."]);
                continue;
            }

            if (!entries.TryAdd(name, entry) && options.RejectDuplicateNames)
            {
                problems.TryAdd($"file/{Printable(name)}", ["Entrada repetida: el archivo trae dos con el mismo nombre."]);
            }
        }

        if (problems.Count > 0)
        {
            foreach (var (path, messages) in problems)
            {
                errors[path] = messages;
            }

            archive.Dispose();
            return null;
        }

        return new SafeZip(archive, entries, options);
    }

    /// <summary>
    /// Los bytes de la entrada, sin creerle al tamaño que declara: null si pasa de <paramref name="max"/>, si el total
    /// leído del paquete pasa de <see cref="SafeZipOptions.MaxUncompressedBytes"/> o si la entrada está dañada.
    /// </summary>
    public byte[]? ReadBytes(ZipArchiveEntry entry, long max)
    {
        ArgumentNullException.ThrowIfNull(entry);
        try
        {
            using var stream = entry.Open();
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
            {
                totalRead += read;
                if (buffer.Length + read > max || totalRead > options.MaxUncompressedBytes)
                {
                    return null;
                }

                buffer.Write(chunk, 0, read);
            }

            return buffer.ToArray();
        }
        catch (InvalidDataException)
        {
            return null;
        }
    }

    /// <summary>Un documento JSON del paquete; null (con el error en su ruta) si falta, no se puede leer o no es JSON.</summary>
    public JsonElement? ReadJson(string path, Dictionary<string, string[]> errors, int maxDepth = 64)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (!Entries.TryGetValue(path, out var entry))
        {
            errors[path] = ["Falta en el archivo."];
            return null;
        }

        if (ReadBytes(entry, options.MaxUncompressedBytes) is not { } bytes)
        {
            errors[path] = ["No se pudo leer del archivo."];
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = maxDepth });
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            errors[path] = ["No es JSON válido."];
            return null;
        }
    }

    public void Dispose() => archive.Dispose();

    /// <summary>Por qué un nombre de entrada no es una ruta relativa limpia; null si lo es.</summary>
    internal static string? UnsafeName(string name)
    {
        if (name.Length == 0)
        {
            return "vacío";
        }

        if (name.Any(char.IsControl))
        {
            return "tiene caracteres de control";
        }

        if (name.Contains('\\', StringComparison.Ordinal))
        {
            return "usa \\";
        }

        if (name.StartsWith('/') || (name.Length > 1 && name[1] == ':'))
        {
            return "es una ruta absoluta";
        }

        return name.Split('/').Any(s => s is "" or "." or "..") ? "tiene segmentos vacíos, . o .." : null;
    }

    private static string Printable(string name) =>
        new string([.. name.Take(120).Select(c => char.IsControl(c) ? '?' : c)]);
}
