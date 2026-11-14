using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Cli;
using Walkie.Shared.Discovery;

namespace Walkie.IntegrationTests;

/// <summary>
/// Paquetes de Walkie Live para las pruebas de Discovery. Los válidos los genera la CLI real (<see cref="CliApp.Run"/>,
/// el mismo código que <c>walkie scan</c>) sobre el propio repo o sobre proyectos ficticios; los inválidos se arman
/// alterando uno real o escribiendo un zip a mano (ataques). Datos ficticios.
/// </summary>
internal static class DiscoveryPacks
{
    public static readonly Guid WalkieSource = Guid.Parse("0198f0c0-0000-7000-8000-0000000000a1");

    private static readonly Lazy<byte[]> WalkieRepository = new(() => ScanRepository(new DateTimeOffset(2026, 11, 14, 12, 0, 0, TimeSpan.Zero)));

    /// <summary>El <c>.walkiepack</c> de este repo, generado una vez por corrida con <c>walkie scan</c>.</summary>
    public static byte[] WalkiePack => WalkieRepository.Value;

    /// <summary>Otro análisis del mismo árbol, una hora después: mismo contenido, otro archivo.</summary>
    public static byte[] WalkieLater() => ScanRepository(new DateTimeOffset(2026, 11, 14, 13, 0, 0, TimeSpan.Zero));

    /// <summary><c>walkie scan</c> sobre un proyecto ficticio (rutas relativas → contenido), con argumentos extra.</summary>
    public static byte[] Scan(IReadOnlyDictionary<string, string> files, params string[] extra)
    {
        var root = Path.Combine(Path.GetTempPath(), "walkie discovery " + Guid.NewGuid().ToString("N")[..8], "Proyecto demo");
        try
        {
            foreach (var (path, content) in files)
            {
                var full = Path.Combine(root, path);
                Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                File.WriteAllText(full, content);
            }

            Directory.CreateDirectory(root);
            return Run(root, new DateTimeOffset(2026, 11, 14, 12, 0, 0, TimeSpan.Zero), extra);
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(root)!, recursive: true);
        }
    }

    /// <summary>Un proyecto ficticio con API, base y caché.</summary>
    public static byte[] Tienda(params string[] extra) => Scan(new Dictionary<string, string>
    {
        ["src/Tienda.Api/Tienda.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
        ["src/Tienda.Api/Program.cs"] = "var app = WebApplication.CreateBuilder(args).Build();\nvar pedidos = app.MapGroup(\"/api/pedidos\");\npedidos.MapGet(\"/{id:guid}\", (Guid id) => 1);\npedidos.MapPost(\"/\", () => 1);\napp.Run();\n",
        ["docker-compose.yml"] = "services:\n  api:\n    build: ./src/Tienda.Api\n    depends_on: [db, cache]\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_DB: tienda\n  cache:\n    image: redis:7\n",
    }, extra);

    /// <summary>Los dos documentos de un paquete.</summary>
    public static (JsonObject Manifest, JsonObject Discovery) Open(byte[] pack)
    {
        using var zip = new ZipArchive(new MemoryStream(pack), ZipArchiveMode.Read);
        JsonObject Read(string name)
        {
            using var stream = zip.GetEntry(name)!.Open();
            return JsonNode.Parse(stream)!.AsObject();
        }

        return (Read(DiscoveryFormat.ManifestPath), Read(DiscoveryFormat.DiscoveryPath));
    }

    /// <summary>Un paquete real alterado (para probar un rechazo concreto).</summary>
    public static byte[] Alter(byte[] pack, Action<JsonObject, JsonObject> change)
    {
        var (manifest, discovery) = Open(pack);
        change(manifest, discovery);
        return Zip((DiscoveryFormat.ManifestPath, Encoding.UTF8.GetBytes(manifest.ToJsonString())),
                   (DiscoveryFormat.DiscoveryPath, Encoding.UTF8.GetBytes(discovery.ToJsonString())));
    }

    /// <summary>Un zip con estas entradas tal cual (nombres incluidos, aunque sean hostiles).</summary>
    public static byte[] Zip(params (string Name, byte[] Content)[] entries)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in entries)
            {
                using var stream = zip.CreateEntry(name, CompressionLevel.Fastest).Open();
                stream.Write(content);
            }
        }

        return buffer.ToArray();
    }

    /// <summary>Un zip cuyo <c>discovery.json</c> se descomprime a más de <paramref name="bytes"/> (zip bomb).</summary>
    public static byte[] Bomb(byte[] manifest, long bytes)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            using (var stream = zip.CreateEntry(DiscoveryFormat.ManifestPath).Open())
            {
                stream.Write(manifest);
            }

            using var bomb = zip.CreateEntry(DiscoveryFormat.DiscoveryPath, CompressionLevel.SmallestSize).Open();
            var chunk = new byte[1024 * 1024];
            Array.Fill(chunk, (byte)' ');
            for (long written = 0; written <= bytes; written += chunk.Length)
            {
                bomb.Write(chunk);
            }
        }

        return buffer.ToArray();
    }

    public static async Task<HttpResponseMessage> UploadAsync(HttpClient client, Guid appId, byte[] pack, bool dryRun = false)
    {
        using var part = new ByteArrayContent(pack);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var content = new MultipartFormDataContent { { part, "file", "architecture.walkiepack" } };
        return await client.PostAsync(new Uri($"/api/apps/{appId}/sources/snapshots{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative), content);
    }

    private static byte[] ScanRepository(DateTimeOffset at) => Run(RepoRoot(), at, "--source-id", WalkieSource.ToString());

    private static byte[] Run(string root, DateTimeOffset at, params string[] extra)
    {
        var output = Path.Combine(Path.GetTempPath(), $"walkie-{Guid.NewGuid():N}.walkiepack");
        using var stdout = new StringWriter();
        using var stderr = new StringWriter();
        string[] args = extra.Contains("--source-id")
            ? ["scan", root, "-o", output, "-q", .. extra]
            : ["scan", root, "-o", output, "-q", "--no-source-file", .. extra];
        var code = CliApp.Run(args, stdout, stderr, new FixedClock(at));
        try
        {
            if (code != CliApp.Ok)
            {
                throw new InvalidOperationException($"walkie scan terminó con {code}: {stderr}");
            }

            return File.ReadAllBytes(output);
        }
        finally
        {
            File.Delete(output);
        }
    }

    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("No se encontró la raíz del repo (global.json).");
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>Atajo: el JSON de una respuesta (falla con el cuerpo si no es el código esperado).</summary>
    public static async Task<JsonElement> JsonAsync(HttpResponseMessage response, System.Net.HttpStatusCode expected)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"Se esperaba {expected} y llegó {response.StatusCode}: {body}");
        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }
}
