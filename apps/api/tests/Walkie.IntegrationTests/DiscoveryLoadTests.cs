using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Xunit.Abstractions;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Concurrencia, memoria y rendimiento de Walkie Live (spec walkie-live, tarea 11, puntos 6 y 7).
/// La concurrencia corre siempre, con tamaños moderados y aserciones de corrección. La matriz de rendimiento solo con
/// <c>WALKIE_BENCH=1</c> (tarda minutos): imprime mediana, p95 y máximo de cada medición. Las mediciones son de la
/// máquina donde corre, con la API y Postgres en el mismo equipo; no son garantías.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryLoadTests(WalkieApiFactory factory, ITestOutputHelper output)
{
    private static bool Bench => Environment.GetEnvironmentVariable("WALKIE_BENCH") == "1";

    [Fact]
    public async Task Las_operaciones_concurrentes_no_duplican_ni_bloquean_y_no_agotan_conexiones()
    {
        using var client = factory.CreateAuthenticatedClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var appId = await CreateAppAsync(client, "Concurrencia");
        var source = Guid.CreateVersion7();
        var memory = new MemorySampler();

        // Subidas simultáneas de paquetes distintos de la misma fuente (6) y del mismo paquete (6).
        var distinct = Enumerable.Range(0, 6).Select(i => DiscoveryReviewPerformanceTests.SyntheticPack(200 + i, source)).ToArray();
        var watch = Stopwatch.StartNew();
        var uploads = await Task.WhenAll(distinct.Select(p => UploadAsync(client, appId, p)));
        Log("6 subidas distintas a la vez", watch);
        Assert.All(uploads, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.Created, HttpStatusCode.OK }));
        // Antes de la tarea 11: 5 de 6 respondían 500 (la fuente se creaba dos veces). Ahora todas se guardan, en cadena.
        var chain = await CountAsync(db => db.Snapshots.Where(sn => sn.AppId == appId).Select(sn => sn.PreviousSnapshotId).Distinct().CountAsync());
        Assert.Equal(6, chain); // null + 5 anteriores distintos: ningún análisis comparte «anterior»
        var same = DiscoveryReviewPerformanceTests.SyntheticPack(150, Guid.CreateVersion7());
        var sameApp = await CreateAppAsync(client, "Mismo paquete");
        var repeated = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => UploadAsync(client, sameApp, same)));
        Assert.Single(repeated, r => r.StatusCode == HttpStatusCode.Created);
        Assert.All(repeated, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.Created, HttpStatusCode.OK }));
        Assert.Equal(1, await CountAsync(db => db.Snapshots.CountAsync(s => s.AppId == sameApp)));

        // Validación de varios paquetes grandes a la vez (dryRun: no guarda).
        var large = Enumerable.Range(0, 3).Select(i => DiscoveryReviewPerformanceTests.SyntheticPack(Bench ? 20_000 : 5_000, Guid.CreateVersion7())).ToArray();
        watch.Restart();
        var checks = await Task.WhenAll(large.Select(p => UploadAsync(client, appId, p, dryRun: true)));
        Log($"3 validaciones de {(Bench ? 20_000 : 5_000)} entidades a la vez (dryRun)", watch);
        Assert.All(checks, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));

        // Revisión concurrente del mismo análisis (20 pedidos, distintos filtros).
        var latest = (await JsonAsync(uploads.Last(r => r.StatusCode == HttpStatusCode.Created), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        var sources = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/sources", UriKind.Relative)), HttpStatusCode.OK);
        latest = sources.GetProperty("sources")[0].GetProperty("latestSnapshot").GetProperty("id").GetGuid();
        string[] filters = ["", "&status=new", "&kind=api", "&change=added", "&needsReview=true"];
        watch.Restart();
        var reviews = await Task.WhenAll(Enumerable.Range(0, 20).Select(i =>
            client.GetAsync(new Uri($"/api/snapshots/{latest}/review?page=0{filters[i % filters.Length]}", UriKind.Relative))));
        Log("20 revisiones a la vez", watch);
        Assert.All(reviews, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));

        // Aplicaciones sobre el mismo hallazgo con distintos applyId: una gana, las demás 409; nada duplicado.
        var key = DiscoveryReviewPerformanceTests.Key(0);
        var race = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ApplyAsync(client, latest, Guid.CreateVersion7(), Create(key, Guid.CreateVersion7()))));
        Assert.Single(race, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(race, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Equal(1, await CountAsync(db => db.Bindings.CountAsync(b => b.AppId == appId && b.EntityKey == key && b.Decision == "created")));

        // El mismo applyId seis veces a la vez (doble clic, reintentos): una ejecución; el resto 409 (en curso) o el resultado guardado.
        var applyId = Guid.CreateVersion7();
        var other = DiscoveryReviewPerformanceTests.Key(1);
        var itemId = Guid.CreateVersion7();
        var same6 = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ApplyAsync(client, latest, applyId, Create(other, itemId))));
        Assert.Contains(same6, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(same6, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Equal(1, await CountAsync(db => db.ApplySteps.CountAsync(s => s.ApplyId == applyId)));

        // Crear app con el mismo importId (6) y con distintos importId de la misma fuente (6).
        var pack = Tienda("--source-id", Guid.CreateVersion7().ToString());
        var importId = Guid.CreateVersion7();
        var name = "Concurrente " + Guid.NewGuid().ToString("N")[..6];
        var sameImport = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ImportAsync(client, pack, name, importId)));
        Assert.Contains(sameImport, r => r.StatusCode == HttpStatusCode.Created);
        Assert.All(sameImport, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.Conflict }));
        var pack2 = Tienda("--source-id", Guid.CreateVersion7().ToString());
        var distinctImports = await Task.WhenAll(Enumerable.Range(0, 6).Select(i => ImportAsync(client, pack2, $"{name} ({i})", Guid.CreateVersion7())));
        Assert.Single(distinctImports, r => r.StatusCode == HttpStatusCode.Created);
        var apps = (await client.GetFromJsonAsync<JsonNode[]>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.Single(apps, a => a!["name"]!.GetValue<string>() == name);
        Assert.Single(apps, a => a!["name"]!.GetValue<string>().StartsWith(name + " (", StringComparison.Ordinal));

        // Conexiones: ninguna sesión colgada (candados de sesión soltados) ni el pool agotado.
        var connections = await CountAsync(db => db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM pg_stat_activity WHERE datname = current_database()").SingleAsync());
        var locks = await CountAsync(db => db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM pg_locks WHERE locktype = 'advisory'").SingleAsync());
        output.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"[carga] conexiones abiertas al terminar: {connections}; candados de sesión: {locks}; memoria del proceso de pruebas: pico {memory.PeakMb} MB, al terminar {MemorySampler.CurrentMb} MB"));
        Assert.Equal(0, locks);
        Assert.True(connections < 100, $"{connections} conexiones abiertas");
        memory.Dispose();
    }

    [Fact]
    public async Task Matriz_de_rendimiento()
    {
        if (!Bench)
        {
            output.WriteLine("Omitida: WALKIE_BENCH=1 para medir.");
            return;
        }

        using var client = factory.CreateAuthenticatedClient();
        client.Timeout = TimeSpan.FromMinutes(10);
        output.WriteLine($"Equipo: {Environment.ProcessorCount} CPU, {Environment.OSVersion}, .NET {Environment.Version}; API y Postgres (Testcontainers, postgres:17) en la misma máquina.");

        // A, B y C: escanear con la CLI (en el proceso), con CPU y memoria asignada.
        var medium = MediumProject();
        try
        {
            foreach (var (label, root, runs) in new[] { ("A pequeño (Tienda)", TiendaFolder(), 15), ("B mediano (300 APIs, 60 pantallas)", medium, 15), ("C Walkie", RepoRoot(), 10) })
            {
                var times = new List<double>();
                var cpu = new List<double>();
                var alloc = new List<double>();
                byte[] last = [];
                for (var i = 0; i < runs; i++)
                {
                    var proc = Process.GetCurrentProcess().TotalProcessorTime;
                    var allocated = GC.GetTotalAllocatedBytes();
                    var watch = Stopwatch.StartNew();
                    last = ScanDirectory(root, "--source-id", Guid.CreateVersion7().ToString());
                    times.Add(watch.Elapsed.TotalMilliseconds);
                    cpu.Add((Process.GetCurrentProcess().TotalProcessorTime - proc).TotalMilliseconds);
                    alloc.Add((GC.GetTotalAllocatedBytes() - allocated) / 1024.0 / 1024.0);
                }

                Stats($"{label}: escaneo (ms)", times);
                Stats($"{label}: CPU del escaneo (ms)", cpu);
                Stats($"{label}: memoria asignada por escaneo (MB)", alloc);
                await PackMetricsAsync(client, label, last, runs);
            }
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(medium)!, recursive: true);
        }

        // D: sintético en el límite de entidades.
        await PackMetricsAsync(client, "D sintético 20000", DiscoveryReviewPerformanceTests.SyntheticPack(20_000, Guid.CreateVersion7()), 5);

        // E: varios análisis de la misma fuente (la revisión compara con el anterior).
        var source = Guid.CreateVersion7();
        var appId = await CreateAppAsync(client, "Varios análisis");
        var reviewTimes = new List<double>();
        for (var i = 0; i < 6; i++)
        {
            var created = await JsonAsync(await UploadAsync(client, appId, DiscoveryReviewPerformanceTests.SyntheticPack(5_000 + (i * 10), source, reanalysis: i % 2 == 1)), HttpStatusCode.Created);
            var snapshot = created.GetProperty("snapshot").GetProperty("id").GetGuid();
            for (var r = 0; r < 5; r++)
            {
                var watch = Stopwatch.StartNew();
                await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshot}/review?page=0", UriKind.Relative)), HttpStatusCode.OK);
                reviewTimes.Add(watch.Elapsed.TotalMilliseconds);
            }
        }

        Stats("E 6 análisis de 5000 de la misma fuente: revisión comparada, primera página (ms)", reviewTimes);
    }

    // ---------- Mediciones de un paquete en la API ----------

    private async Task PackMetricsAsync(HttpClient client, string label, byte[] pack, int runs)
    {
        var unzip = new List<double>();
        var validate = new List<double>();
        for (var i = 0; i < runs; i++)
        {
            var watch = Stopwatch.StartNew();
            using (var zip = new ZipArchive(new MemoryStream(pack)))
            {
                foreach (var entry in zip.Entries)
                {
                    using var stream = entry.Open();
                    await stream.CopyToAsync(Stream.Null);
                }
            }

            unzip.Add(watch.Elapsed.TotalMilliseconds);
            var (manifest, discovery) = Open(pack);
            watch.Restart();
            Assert.Empty(DiscoveryPackValidator.Validate(JsonSerializer.SerializeToElement(manifest), JsonSerializer.SerializeToElement(discovery)));
            validate.Add(watch.Elapsed.TotalMilliseconds);
        }

        Stats($"{label}: descomprimir ({pack.Length / 1024} KB) (ms)", unzip);
        Stats($"{label}: validar el contrato (ms)", validate);

        var persist = new List<double>();
        Guid snapshot = default;
        Guid appId = default;
        for (var i = 0; i < Math.Min(runs, 5); i++)
        {
            appId = await CreateAppAsync(client, $"Rendimiento {label} {i}");
            var watch = Stopwatch.StartNew();
            var created = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created);
            persist.Add(watch.Elapsed.TotalMilliseconds);
            snapshot = created.GetProperty("snapshot").GetProperty("id").GetGuid();
        }

        Stats($"{label}: subir y guardar el análisis (ms)", persist);
        var review = new List<double>();
        var filtered = new List<double>();
        var evidence = new List<double>();
        JsonElement page = default;
        for (var i = 0; i < 20; i++)
        {
            var watch = Stopwatch.StartNew();
            page = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshot}/review?page=0", UriKind.Relative)), HttpStatusCode.OK);
            review.Add(watch.Elapsed.TotalMilliseconds);
            watch.Restart();
            await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshot}/review?page=1&kind=api&status=new", UriKind.Relative)), HttpStatusCode.OK);
            filtered.Add(watch.Elapsed.TotalMilliseconds);
            var key = page.GetProperty("items")[i % page.GetProperty("items").GetArrayLength()].GetProperty("key").GetString()!;
            watch.Restart();
            await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshot}/evidence?entityKey={Uri.EscapeDataString(key)}", UriKind.Relative)), HttpStatusCode.OK);
            evidence.Add(watch.Elapsed.TotalMilliseconds);
        }

        Stats($"{label}: revisión, primera página con matching (ms)", review);
        Stats($"{label}: revisión filtrada, segunda página (ms)", filtered);
        Stats($"{label}: evidencia de un hallazgo (ms)", evidence);

        // Generar catálogo: crear una API (vista previa y aplicación).
        var api = page.GetProperty("items").EnumerateArray().First(i => i.GetProperty("kind").GetString() == "api").GetProperty("key").GetString()!;
        var create = Stopwatch.StartNew();
        await JsonAsync(await ApplyAsync(client, snapshot, Guid.CreateVersion7(), Create(api, Guid.CreateVersion7())), HttpStatusCode.OK);
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"{label}: crear un elemento del catálogo: {create.ElapsedMilliseconds} ms (una vez)"));

        // Módulo y feature con su lienzo (si el análisis los propone): vista previa, ids y aplicación con validación del grafo.
        foreach (var kind in new[] { "module", "feature" })
        {
            var listed = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshot}/review?kind={kind}&pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
            foreach (var item in listed.GetProperty("items").EnumerateArray().Take(1))
            {
                var key = item.GetProperty("key").GetString()!;
                var id = Guid.CreateVersion7();
                var watch = Stopwatch.StartNew();
                var preview = await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshot}/apply?dryRun=true", UriKind.Relative),
                    new JsonObject { ["applyId"] = Guid.CreateVersion7().ToString(), ["operations"] = new JsonArray(Create(key, id)) });
                var previewMs = watch.ElapsedMilliseconds;
                if (preview.StatusCode != HttpStatusCode.OK)
                {
                    output.WriteLine($"{label}: {kind} {key}: vista previa {(int)preview.StatusCode} en {previewMs} ms (sin APIs en el catálogo)");
                    continue;
                }

                var draft = (await preview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("created").EnumerateArray().Last().GetProperty("canvas");
                watch.Restart();
                var applied = await ApplyAsync(client, snapshot, Guid.CreateVersion7(), Create(key, id, Canvas(draft)));
                output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                    $"{label}: {kind} {key}: vista previa {previewMs} ms, crear con lienzo ({draft.GetProperty("nodes").GetArrayLength()} cajas) {watch.ElapsedMilliseconds} ms → {(int)applied.StatusCode}"));
            }
        }
    }

    // ---------- Proyectos ----------

    private static string TiendaFolder()
    {
        var (_, _) = Open(Tienda());
        var root = Path.Combine(Path.GetTempPath(), "walkie-bench-tienda-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(Path.Combine(root, "src/Tienda.Api"));
        File.WriteAllText(Path.Combine(root, "src/Tienda.Api/Tienda.Api.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>");
        File.WriteAllText(Path.Combine(root, "src/Tienda.Api/Program.cs"), "var app = WebApplication.CreateBuilder(args).Build();\nvar pedidos = app.MapGroup(\"/api/pedidos\");\npedidos.MapGet(\"/{id:guid}\", (Guid id) => 1);\npedidos.MapPost(\"/\", () => 1);\napp.Run();\n");
        File.WriteAllText(Path.Combine(root, "docker-compose.yml"), "services:\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_DB: tienda\n");
        return root;
    }

    /// <summary>30 controllers con 10 endpoints, 6 DbContext y una web React con 60 rutas que llaman a la API (ficticio).</summary>
    private static string MediumProject()
    {
        var root = Path.Combine(Path.GetTempPath(), "walkie-bench-" + Guid.NewGuid().ToString("N")[..8], "Mediano");
        void Write(string path, string content)
        {
            var full = Path.Combine(root, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
        }

        Write("src/Banco.Api/Banco.Api.csproj", "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>");
        for (var c = 0; c < 30; c++)
        {
            var actions = new StringBuilder();
            for (var a = 0; a < 10; a++)
            {
                var verb = (a % 4) switch { 0 => "HttpGet", 1 => "HttpPost", 2 => "HttpPut", _ => "HttpDelete" };
                actions.Append(CultureInfo.InvariantCulture, $"    [{verb}(\"accion{a}/{{id}}\")] public IActionResult A{a}(int id) => Ok();\n");
            }

            Write($"src/Banco.Api/Controllers/Recurso{c}Controller.cs",
                $"using Microsoft.AspNetCore.Mvc;\n[ApiController]\n[Route(\"api/recurso{c}\")]\npublic class Recurso{c}Controller : ControllerBase\n{{\n{actions}}}\n");
        }

        for (var d = 0; d < 6; d++)
        {
            Write($"src/Banco.Api/Data/Contexto{d}.cs",
                $"using Microsoft.EntityFrameworkCore;\npublic class Contexto{d} : DbContext\n{{\n    public DbSet<object> Tabla{d}A => Set<object>();\n    public DbSet<object> Tabla{d}B => Set<object>();\n    protected override void OnConfiguring(DbContextOptionsBuilder o) => o.UseNpgsql(\"\");\n}}\n");
        }

        Write("web/package.json", """{ "name": "banco-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""");
        var routes = new StringBuilder("import { createBrowserRouter } from 'react-router-dom';\nimport * as P from './pages';\nexport const router = createBrowserRouter([\n");
        var pages = new StringBuilder("import { Link } from 'react-router-dom';\n");
        for (var r = 0; r < 60; r++)
        {
            routes.Append(CultureInfo.InvariantCulture, $"  {{ path: '/seccion{r / 2}{(r % 2 == 1 ? "/:id" : "")}', element: <P.Pagina{r} /> }},\n");
            pages.Append(CultureInfo.InvariantCulture,
                $"export function Pagina{r}() {{ fetch('/api/recurso{r % 30}/accion0/1'); return <Link to=\"/seccion{(r + 1) % 30}\">siguiente</Link>; }}\n");
        }

        routes.Append("]);\n");
        Write("web/src/main.tsx", routes.ToString());
        Write("web/src/pages.tsx", pages.ToString());
        Write("docker-compose.yml", "services:\n  db:\n    image: postgres:17\n  cache:\n    image: redis:7\n");
        return root;
    }

    // ---------- Estadística ----------

    private void Stats(string label, List<double> values)
    {
        var sorted = values.Order().ToList();
        double At(double q) => sorted[Math.Min(sorted.Count - 1, (int)Math.Ceiling(q * sorted.Count) - 1)];
        output.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"{label}: n={sorted.Count} mediana={At(0.5):F1} p95={At(0.95):F1} máx={sorted[^1]:F1}"));
    }

    private void Log(string label, Stopwatch watch) =>
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"[carga] {label}: {watch.ElapsedMilliseconds} ms"));

    /// <summary>Muestrea la memoria del proceso de pruebas (API incluida: corre en el mismo proceso) cada 50 ms.</summary>
    private sealed class MemorySampler : IDisposable
    {
        private readonly Timer _timer;
        private long _peak;

        public MemorySampler() => _timer = new Timer(_ => Sample(), null, 0, 50);

        public long PeakMb => Interlocked.Read(ref _peak) / 1024 / 1024;

        public static long CurrentMb => Process.GetCurrentProcess().WorkingSet64 / 1024 / 1024;

        public void Dispose() => _timer.Dispose();

        private void Sample()
        {
            var now = Process.GetCurrentProcess().WorkingSet64;
            long seen;
            do
            {
                seen = Interlocked.Read(ref _peak);
            }
            while (now > seen && Interlocked.CompareExchange(ref _peak, now, seen) != seen);
        }
    }

    // ---------- API ----------

    private async Task<int> CountAsync(Func<DiscoveryDbContext, Task<int>> query)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>());
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client, string name) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(name + " " + Guid.NewGuid().ToString("N")[..6])), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();

    private static async Task<HttpResponseMessage> ImportAsync(HttpClient client, byte[] pack, string name, Guid importId)
    {
        using var part = new ByteArrayContent(pack);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var form = new MultipartFormDataContent
        {
            { part, "file", "architecture.walkiepack" },
            { new StringContent(name), "name" },
            { new StringContent(importId.ToString()), "importId" },
        };
        return await client.PostAsync(new Uri("/api/sources/import", UriKind.Relative), form);
    }

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, Guid applyId, params JsonObject[] operations) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative),
            new JsonObject { ["applyId"] = applyId.ToString(), ["operations"] = new JsonArray([.. operations.Select(o => o.DeepClone())]) });

    private static JsonObject Create(string key, Guid id, JsonObject? canvas = null)
    {
        var op = new JsonObject { ["op"] = "create", ["entityKey"] = key, ["id"] = id.ToString(), ["bindingVersion"] = 0 };
        if (canvas is not null)
        {
            op["canvas"] = canvas;
        }

        return op;
    }

    private static JsonObject Canvas(JsonElement draft)
    {
        JsonObject Ids(string name) => new([.. draft.GetProperty(name).EnumerateArray()
            .Select(i => KeyValuePair.Create(i.GetProperty("key").GetString()!, (JsonNode?)Guid.CreateVersion7().ToString()))]);
        var layout = new JsonObject();
        var index = 0;
        foreach (var node in draft.GetProperty("nodes").EnumerateArray())
        {
            layout[node.GetProperty("key").GetString()!] = new JsonObject { ["x"] = index % 4 * 264, ["y"] = index / 4 * 160 };
            index++;
        }

        return new JsonObject { ["nodes"] = Ids("nodes"), ["edges"] = Ids("edges"), ["interfaces"] = Ids("interfaces"), ["layout"] = layout };
    }
}
