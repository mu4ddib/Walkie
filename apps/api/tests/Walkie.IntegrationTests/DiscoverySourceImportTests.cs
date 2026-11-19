using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Features;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Crear una app desde un proyecto local (<c>POST /api/sources/import</c>, spec walkie-live tarea 10): vista previa sin
/// escribir, validación completa antes de crear, nombre confirmado, bitácora recuperable (reintentos, caídas, fallos,
/// concurrencia) y compensación que no borra lo que una persona tocó. Paquetes de la CLI real; datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoverySourceImportTests(WalkieApiFactory factory)
{
    private readonly Guid source = Guid.CreateVersion7();
    private readonly string name = "Tienda local " + Guid.NewGuid().ToString("N")[..8];

    [Fact]
    public async Task Crea_la_app_vacia_con_su_primer_analisis_y_nada_mas()
    {
        using var client = factory.CreateAuthenticatedClient();
        var pack = Pack();

        var preview = await JsonAsync(await ImportAsync(client, pack, dryRun: true), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoverySourceImport, preview));
        Assert.Equal("preview", preview.GetProperty("status").GetString());
        Assert.False(preview.GetProperty("app").TryGetProperty("id", out _));
        Assert.False(preview.GetProperty("summary").TryGetProperty("appId", out _));
        Assert.Equal(0, await ImportsOfSourceAsync()); // 2: la vista previa no escribe

        var importId = Guid.CreateVersion7();
        var created = await JsonAsync(await ImportAsync(client, pack, name, importId), HttpStatusCode.Created);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoverySourceImport, created));
        var appId = created.GetProperty("app").GetProperty("id").GetGuid();
        var snapshot = created.GetProperty("snapshot");

        // 1, 5 y 6: la app con el nombre confirmado y el primer análisis de la fuente estable.
        var app = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(name, app.GetProperty("name").GetString());
        Assert.Equal(source, snapshot.GetProperty("source").GetProperty("id").GetGuid());
        Assert.False(snapshot.TryGetProperty("previousSnapshotId", out _));
        var sources = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/sources", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(source, Assert.Single(sources.GetProperty("sources").EnumerateArray()).GetProperty("source").GetProperty("id").GetGuid());
        // Sin features, módulos ni catálogo: se decide en la revisión.
        Assert.Empty((await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!);
        Assert.Empty((await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK)).EnumerateArray());
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshot.GetProperty("id").GetGuid()}/review", UriKind.Relative)), HttpStatusCode.OK);
        Assert.True(review.GetProperty("counts").GetProperty("new").GetInt32() > 0);

        // 7 y 14: el mismo pedido otra vez (un reintento tras un timeout) devuelve lo mismo sin otra app.
        var again = await JsonAsync(await ImportAsync(client, pack, name, importId), HttpStatusCode.OK);
        Assert.Equal("existing", again.GetProperty("status").GetString());
        Assert.Equal(appId, again.GetProperty("app").GetProperty("id").GetGuid());
        Assert.Equal(1, await AppsNamedAsync(client, name));
        Assert.Equal("completed", await StatusAsync(importId));
    }

    [Theory]
    [InlineData("zip-roto")]
    [InlineData("version-futura")]
    [InlineData("fingerprint-alterado")]
    [InlineData("v0-ambiguo")]
    public async Task Un_paquete_invalido_se_rechaza_sin_dejar_ninguna_app(string variant)
    {
        using var client = factory.CreateAuthenticatedClient();
        var pack = variant switch
        {
            "zip-roto" => "no es un zip"u8.ToArray(),
            "version-futura" => Alter(Pack(), (m, _) => m["formatVersion"] = DiscoveryFormat.CurrentVersion + 1),
            "fingerprint-alterado" => Alter(Pack(), (_, d) => d["entities"]![0]!["title"] = "Otro título"),
            _ => AmbiguousV0(),
        };

        var response = await ImportAsync(client, pack, name, Guid.CreateVersion7());

        // 3 y 16: 400 con la ruta del problema y ninguna app ni bitácora.
        var problem = await JsonAsync(response, HttpStatusCode.BadRequest);
        Assert.True(problem.GetProperty("errors").EnumerateObject().Any());
        Assert.Equal(0, await AppsNamedAsync(client, name));
        Assert.Equal(0, await ImportsOfSourceAsync());
    }

    [Fact]
    public async Task Un_paquete_v0_compatible_se_migra_y_crea_la_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var v0 = Alter(Pack(withFrontend: false), (m, _) => m["formatVersion"] = 0); // sin pantallas: la migración no cambia nada

        var created = await JsonAsync(await ImportAsync(client, v0, name, Guid.CreateVersion7()), HttpStatusCode.Created);

        // 15: llegó como v0 y quedó guardado migrado.
        Assert.Equal(0, created.GetProperty("snapshot").GetProperty("formatVersion").GetInt32());
        Assert.Equal(1, await AppsNamedAsync(client, name));
    }

    [Fact]
    public async Task Un_nombre_que_ya_existe_se_propone_distinto_y_si_se_insiste_da_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new { name });
        var pack = Pack(sourceName: name);

        var preview = await JsonAsync(await ImportAsync(client, pack, dryRun: true), HttpStatusCode.OK);
        Assert.Equal($"{name} (2)", preview.GetProperty("app").GetProperty("name").GetString());
        var taken = await JsonAsync(await ImportAsync(client, pack, name, dryRun: true), HttpStatusCode.OK);
        Assert.True(taken.GetProperty("app").GetProperty("nameTaken").GetBoolean());

        // 4: con el nombre de otra app, 409 y nada creado.
        var conflict = await JsonAsync(await ImportAsync(client, pack, name, Guid.CreateVersion7()), HttpStatusCode.Conflict);
        Assert.Contains("nombre", conflict.GetProperty("title").GetString(), StringComparison.Ordinal);
        Assert.Equal(1, await AppsNamedAsync(client, name));
        var blank = await ImportAsync(client, pack, "   ", Guid.CreateVersion7());
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
    }

    [Fact]
    public async Task El_mismo_importId_con_otro_paquete_u_otro_nombre_da_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var importId = Guid.CreateVersion7();
        await JsonAsync(await ImportAsync(client, Pack(), name, importId), HttpStatusCode.Created);

        Assert.Equal(HttpStatusCode.Conflict, (await ImportAsync(client, Pack(), name + " otro", importId)).StatusCode);
        Assert.Equal(1, await AppsNamedAsync(client, name));
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("app")]
    public async Task Una_caida_a_mitad_se_retoma_con_el_mismo_importId_sin_duplicar(string checkpoint)
    {
        using var client = factory.CreateAuthenticatedClient();
        var pack = Pack();
        var importId = Guid.CreateVersion7();
        using (var crashing = WithCheckpoints(reached => reached == checkpoint ? throw new ImportAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ImportAsync(dying, pack, name, importId));
        }

        // 8 y 11: quedó pendiente (con o sin la app creada) y observable en la bitácora.
        Assert.Equal("pending", await StatusAsync(importId));
        var preview = await JsonAsync(await ImportAsync(client, pack, dryRun: true), HttpStatusCode.OK);
        Assert.Contains(preview.GetProperty("warnings").EnumerateArray(), w => w.GetProperty("code").GetString() == "pending-import");

        var done = await JsonAsync(await ImportAsync(client, pack, name, importId), HttpStatusCode.Created);
        Assert.Equal("created", done.GetProperty("status").GetString());
        Assert.Equal(1, await AppsNamedAsync(client, name));
        Assert.Equal("completed", await StatusAsync(importId));
    }

    [Fact]
    public async Task Si_falla_al_guardar_el_analisis_se_borra_la_app_que_nadie_toco()
    {
        using var client = factory.CreateAuthenticatedClient();
        var importId = Guid.CreateVersion7();
        using var faulty = WithCheckpoints(reached => reached == "app" ? throw new InvalidOperationException("fallo simulado") : Task.CompletedTask);
        using var failing = Authenticated(faulty);

        var response = await ImportAsync(failing, Pack(), name, importId);

        // 9 y 12: no se informa éxito; la app se deshizo y la bitácora dice compensated.
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(0, await AppsNamedAsync(client, name));
        Assert.Equal("compensated", await StatusAsync(importId));
        // Volver a intentarlo es otra creación.
        await JsonAsync(await ImportAsync(client, Pack(), name, Guid.CreateVersion7()), HttpStatusCode.Created);
    }

    [Fact]
    public async Task Si_falla_despues_de_que_alguien_toco_la_app_no_se_borra_y_queda_pendiente()
    {
        using var client = factory.CreateAuthenticatedClient();
        var importId = Guid.CreateVersion7();
        var pack = Pack();
        using var faulty = WithCheckpoints(async reached =>
        {
            if (reached != "app")
            {
                return;
            }

            // Mientras tanto, alguien abre la app recién creada y agrega una feature.
            var app = (await client.GetFromJsonAsync<JsonElement[]>(new Uri("/api/apps", UriKind.Relative)))!.Single(a => a.GetProperty("name").GetString() == name);
            await client.PostAsJsonAsync(new Uri($"/api/apps/{app.GetProperty("id").GetGuid()}/features", UriKind.Relative), new { name = "Hecha a mano" });
            throw new InvalidOperationException("fallo simulado");
        });
        using var failing = Authenticated(faulty);

        var response = await ImportAsync(failing, pack, name, importId);

        // 13: la app con la feature de una persona se queda; la creación queda pendiente y un reintento la termina.
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(1, await AppsNamedAsync(client, name));
        Assert.Equal("pending", await StatusAsync(importId));
        var done = await JsonAsync(await ImportAsync(client, pack, name, importId), HttpStatusCode.Created);
        var appId = done.GetProperty("app").GetProperty("id").GetGuid();
        Assert.Single((await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!);
    }

    [Fact]
    public async Task Una_pendiente_con_la_app_tocada_que_nadie_reintenta_no_bloquea_la_fuente_ni_borra_la_app()
    {
        // Tarea 11, punto 9: la creación se cayó después de crear la app, alguien la usó y el navegador que la empezó se
        // cerró (nadie reintenta ese importId). Antes, toda creación nueva desde la fuente respondía 409 para siempre.
        using var client = factory.CreateAuthenticatedClient();
        var importId = Guid.CreateVersion7();
        var pack = Pack();
        using (var crashing = WithCheckpoints(reached => reached == "app" ? throw new ImportAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ImportAsync(dying, pack, name, importId));
        }

        var stuck = (await client.GetFromJsonAsync<JsonElement[]>(new Uri("/api/apps", UriKind.Relative)))!.Single(a => a.GetProperty("name").GetString() == name);
        var stuckId = stuck.GetProperty("id").GetGuid();
        await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{stuckId}/features", UriKind.Relative), new { name = "Hecha a mano" }), HttpStatusCode.Created);

        // Otra creación desde la misma fuente: la anterior queda abandonada (no se borra nada) y esta se crea.
        var other = await JsonAsync(await ImportAsync(client, pack, name + " (2)", Guid.CreateVersion7()), HttpStatusCode.Created);
        Assert.NotEqual(stuckId, other.GetProperty("app").GetProperty("id").GetGuid());
        Assert.Equal("abandoned", await StatusAsync(importId));
        Assert.Single((await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{stuckId}/features", UriKind.Relative)))!);

        // El importId original ya no la termina: lo dice, con qué hacer.
        var late = await ImportAsync(client, pack, name, importId);
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);
        Assert.Contains("Importar proyecto local", await late.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(1, await AppsNamedAsync(client, name));
    }

    [Fact]
    public async Task Dos_creaciones_a_la_vez_desde_la_misma_fuente_no_dan_dos_apps()
    {
        using var client = factory.CreateAuthenticatedClient();
        var pack = Pack();

        // 10: dos importId distintos, mismo proyecto, al mismo tiempo.
        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(i => ImportAsync(client, pack, $"{name} {i}", Guid.CreateVersion7())));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.Created), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        var apps = (await client.GetFromJsonAsync<JsonElement[]>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.Single(apps, a => a.GetProperty("name").GetString()!.StartsWith(name, StringComparison.Ordinal));
    }

    [Fact]
    public async Task El_mismo_proyecto_en_otra_app_se_avisa_y_no_se_asocia_a_esa()
    {
        using var client = factory.CreateAuthenticatedClient();
        var pack = Pack();
        var first = await JsonAsync(await ImportAsync(client, pack, name, Guid.CreateVersion7()), HttpStatusCode.Created);

        var preview = await JsonAsync(await ImportAsync(client, pack, dryRun: true), HttpStatusCode.OK);

        Assert.Contains(preview.GetProperty("warnings").EnumerateArray(), w => w.GetProperty("code").GetString() == "source-in-other-apps");
        var second = await JsonAsync(await ImportAsync(client, pack, name + " bis", Guid.CreateVersion7()), HttpStatusCode.Created);
        Assert.NotEqual(first.GetProperty("app").GetProperty("id").GetGuid(), second.GetProperty("app").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Sin_sesion_401_con_Discovery_apagado_404_y_en_OpenAPI()
    {
        // 18
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await ImportAsync(anonymous, Pack(), name, Guid.CreateVersion7())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(new Uri("/api/discovery", UriKind.Relative))).StatusCode);

        using var client = factory.CreateAuthenticatedClient();
        var status = await JsonAsync(await client.GetAsync(new Uri("/api/discovery", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryStatus, status));

        // 17: apagado, ni el estado ni crear existen (404), y no queda nada.
        using var disabled = factory.WithWebHostBuilder(b => b.UseSetting("Discovery:Enabled", "false"));
        using var off = Authenticated(disabled);
        Assert.Equal(HttpStatusCode.NotFound, (await off.GetAsync(new Uri("/api/discovery", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ImportAsync(off, Pack(), name, Guid.CreateVersion7())).StatusCode);
        Assert.Equal(0, await AppsNamedAsync(client, name));

        var openApi = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));
        Assert.Contains("/api/sources/import", openApi, StringComparison.Ordinal);
        Assert.Contains("/api/discovery", openApi, StringComparison.Ordinal);
    }

    // ---------- Proyecto ----------

    private byte[] Pack(bool withFrontend = true, string? sourceName = null)
    {
        var files = new Dictionary<string, string>
        {
            ["src/Tienda.Api/Tienda.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>",
            ["src/Tienda.Api/Program.cs"] = "var app = WebApplication.CreateBuilder(args).Build();\napp.MapGet(\"/api/pedidos\", () => 1);\napp.Run();\n",
        };
        if (withFrontend)
        {
            files["web/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""";
            files["web/src/main.tsx"] = "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos } from './pages';\nexport const router = createBrowserRouter([{ path: '/pedidos', element: <Pedidos /> }]);\n";
            files["web/src/pages.tsx"] = "export const Pedidos = () => null;\n";
        }

        return Scan(files, ["--source-id", source.ToString(), .. sourceName is null ? Array.Empty<string>() : ["--name", sourceName]]);
    }

    /// <summary>Un paquete v0 con la misma ruta en dos apps (la versión 0 las juntaba): no se puede migrar sin adivinar.</summary>
    private byte[] AmbiguousV0() => Alter(Pack(), (manifest, discovery) =>
    {
        manifest["formatVersion"] = 0;
        var screen = discovery["entities"]!.AsArray().Single(e => e!["kind"]!.GetValue<string>() == "screen")!.AsObject();
        screen.Remove("app");
        screen["key"] = "screen:/pedidos";
        discovery["evidence"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "ev-otra-app", ["detector"] = "react-router", ["path"] = "admin/src/main.tsx", ["confidence"] = "medium",
        });
        discovery["evidence"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "ev-otra-app-pkg", ["detector"] = "package-json", ["path"] = "admin/package.json", ["symbol"] = "dependencies.react", ["confidence"] = "high",
        });
        screen["evidence"]!.AsArray().Add("ev-otra-app");
    });

    // ---------- API ----------

    private static async Task<HttpResponseMessage> ImportAsync(HttpClient client, byte[] pack, string? appName = null, Guid? importId = null, bool dryRun = false)
    {
        using var part = new ByteArrayContent(pack);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var content = new MultipartFormDataContent { { part, "file", "architecture.walkiepack" } };
        if (appName is not null)
        {
            content.Add(new StringContent(appName), "name");
        }

        if (importId is { } id)
        {
            content.Add(new StringContent(id.ToString()), "importId");
        }

        return await client.PostAsync(new Uri($"/api/sources/import{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative), content);
    }

    private static async Task<int> AppsNamedAsync(HttpClient client, string appName) =>
        (await client.GetFromJsonAsync<JsonElement[]>(new Uri("/api/apps", UriKind.Relative)))!.Count(a => a.GetProperty("name").GetString() == appName);

    private async Task<string?> StatusAsync(Guid importId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        return await db.SourceImports.Where(i => i.ImportId == importId).Select(i => i.Status).SingleOrDefaultAsync();
    }

    private async Task<int> ImportsOfSourceAsync()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        return await db.SourceImports.CountAsync(i => i.SourceId == source);
    }

    private WebApplicationFactory<Program> WithCheckpoints(Func<string, Task> reached) =>
        factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<ISourceImportCheckpoints>(new TestCheckpoints(reached))));

    private static HttpClient Authenticated(WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken());
        return client;
    }

    private static async Task CrashAsync(Func<Task<HttpResponseMessage>> request)
    {
        try
        {
            var response = await request();
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        }
        catch (ImportAbandonedException)
        {
        }
    }

    private sealed class TestCheckpoints(Func<string, Task> reached) : ISourceImportCheckpoints
    {
        public Task ReachedAsync(string checkpoint, Guid importId) => reached(checkpoint);
    }
}
