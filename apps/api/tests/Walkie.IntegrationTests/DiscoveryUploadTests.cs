using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// <c>POST /api/apps/{appId}/sources/snapshots</c> (spec walkie-live, tarea 3; ADR-0012 y ADR-0014) con Postgres real y
/// paquetes generados por la CLI real. Ninguna prueba simula el analizador ni la base.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryUploadTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task El_paquete_de_Walkie_generado_por_la_CLI_se_guarda_se_consulta_y_no_toca_lienzos_ni_catalogo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var (featureId, catalogBefore, canvasBefore) = await DocumentedAppAsync(client, appId);

        // 1. La CLI generó el paquete y cumple el contrato.
        var pack = WalkiePack;
        var (manifest, discovery) = Open(pack);
        Assert.Empty(DiscoveryPackValidator.Validate(JsonSerializer.SerializeToElement(manifest), JsonSerializer.SerializeToElement(discovery)));
        Assert.Contains(discovery["entities"]!.AsArray(), e => e!["key"]!.GetValue<string>() == "service:Walkie.Api");

        // 2. La API lo aceptó y guardó el análisis.
        var created = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryUpload, created));
        Assert.Equal("created", created.GetProperty("status").GetString());
        var snapshot = created.GetProperty("snapshot");
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoverySnapshot, snapshot));
        var snapshotId = snapshot.GetProperty("id").GetGuid();
        Assert.Equal(WalkieSource, snapshot.GetProperty("source").GetProperty("id").GetGuid());
        Assert.Equal("partial", snapshot.GetProperty("completeness").GetString()); // el front sin parser de TypeScript

        // 3. Entidades, relaciones y evidencia guardadas tal como vinieron, en el mismo orden.
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var reader = scope.ServiceProvider.GetRequiredService<IDiscoveryReader>();
            AssertSame(discovery["entities"]!.AsArray(), await reader.EntitiesAsync(snapshotId, null, default));
            AssertSame(discovery["relations"]!.AsArray(), await reader.RelationsAsync(snapshotId, default));
            AssertSame(discovery["evidence"]!.AsArray(), await reader.EvidenceAsync(snapshotId, default));
            Assert.Equal(created.GetProperty("summary").GetProperty("entities").GetProperty("api").GetInt32(),
                (await reader.EntitiesAsync(snapshotId, "api", default)).Count);
            Assert.Equal(snapshotId, Assert.Single(await reader.SnapshotsOfSourceAsync(appId, WalkieSource, default)).Id);
        }

        // 4. Reimportar el mismo archivo no duplica.
        var again = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.OK);
        Assert.Equal("existing", again.GetProperty("status").GetString());
        Assert.Equal("pack", again.GetProperty("duplicate").GetString());
        Assert.Equal(snapshotId, again.GetProperty("snapshot").GetProperty("id").GetGuid());

        // 5. Otro análisis del mismo árbol (otro generatedAt, otro archivo) tampoco: mismo contenido.
        var later = WalkieLater();
        Assert.NotEqual(pack, later);
        var sameContent = await JsonAsync(await UploadAsync(client, appId, later), HttpStatusCode.OK);
        Assert.Equal("content", sameContent.GetProperty("duplicate").GetString());
        Assert.Equal(snapshotId, sameContent.GetProperty("snapshot").GetProperty("id").GetGuid());
        await AssertCountsAsync(appId, snapshots: 1, entities: discovery["entities"]!.AsArray().Count);

        // 6. Ningún lienzo ni elemento del catálogo cambió.
        Assert.True(JsonElement.DeepEquals(catalogBefore, await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative))));
        Assert.True(JsonElement.DeepEquals(canvasBefore, await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative))));
        var features = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/apps/{appId}/features", UriKind.Relative));
        Assert.Single(features.EnumerateArray());
        var modules = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/apps/{appId}/modules", UriKind.Relative));
        Assert.Empty(modules.EnumerateArray());
    }

    [Fact]
    public async Task Con_dryRun_valida_y_resume_sin_guardar_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Tienda();

        var preview = await JsonAsync(await UploadAsync(client, appId, pack, dryRun: true), HttpStatusCode.OK);

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryUpload, preview));
        Assert.True(preview.GetProperty("dryRun").GetBoolean());
        Assert.Equal("preview", preview.GetProperty("status").GetString());
        Assert.False(preview.TryGetProperty("snapshot", out _));
        var summary = preview.GetProperty("summary");
        Assert.False(summary.GetProperty("sourceExists").GetBoolean());
        Assert.Equal(2, summary.GetProperty("entities").GetProperty("api").GetInt32());
        Assert.Equal(Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(pack)), summary.GetProperty("packSha256").GetString());
        await AssertCountsAsync(appId, snapshots: 0, entities: 0, sources: 0);
    }

    [Fact]
    public async Task Un_dryRun_de_un_paquete_ya_guardado_dice_que_no_se_crearia_otro()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Tienda();
        var created = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created);

        var preview = await JsonAsync(await UploadAsync(client, appId, pack, dryRun: true), HttpStatusCode.OK);

        Assert.Equal("preview", preview.GetProperty("status").GetString());
        Assert.Equal("pack", preview.GetProperty("duplicate").GetString());
        Assert.Equal(created.GetProperty("snapshot").GetProperty("id").GetGuid(), preview.GetProperty("snapshot").GetProperty("id").GetGuid());
        Assert.True(preview.GetProperty("summary").GetProperty("sourceExists").GetBoolean());
    }

    [Fact]
    public async Task Un_analisis_parcial_se_guarda_y_dice_que_es_parcial()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var created = await JsonAsync(await UploadAsync(client, appId, Tienda("--detectors", "compose")), HttpStatusCode.Created);

        var snapshot = created.GetProperty("snapshot");
        Assert.Equal("partial", snapshot.GetProperty("completeness").GetString());
        Assert.Contains(snapshot.GetProperty("detectors").EnumerateArray(), d => d.GetProperty("status").GetString() == "skipped");
        Assert.False(created.GetProperty("summary").GetProperty("entities").TryGetProperty("api", out _));
    }

    [Fact]
    public async Task Un_analisis_nuevo_de_la_misma_fuente_apunta_al_anterior()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var first = await JsonAsync(await UploadAsync(client, appId, Tienda("--source-id", WalkieSource.ToString())), HttpStatusCode.Created);
        var changed = Scan(new Dictionary<string, string> { ["compose.yaml"] = "services:\n  db:\n    image: postgres:17\n" }, "--source-id", WalkieSource.ToString());

        var second = await JsonAsync(await UploadAsync(client, appId, changed), HttpStatusCode.Created);

        Assert.Equal(first.GetProperty("snapshot").GetProperty("id").GetGuid(), second.GetProperty("snapshot").GetProperty("previousSnapshotId").GetGuid());
        Assert.True(second.GetProperty("summary").GetProperty("sourceExists").GetBoolean());
        await AssertCountsAsync(appId, snapshots: 2, sources: 1);
    }

    [Fact]
    public async Task Dos_subidas_del_mismo_paquete_a_la_vez_guardan_un_solo_analisis()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Tienda();

        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => UploadAsync(client, appId, pack)));

        Assert.All(responses, r => Assert.True(r.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK, r.StatusCode.ToString()));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        await AssertCountsAsync(appId, snapshots: 1);
    }

    [Fact]
    public async Task Sin_sesion_responde_401_y_con_una_app_que_no_existe_404()
    {
        using var anonymous = factory.CreateClient();
        using var client = factory.CreateAuthenticatedClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await UploadAsync(anonymous, Guid.NewGuid(), Tienda())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await UploadAsync(client, Guid.NewGuid(), Tienda())).StatusCode);
    }

    [Fact]
    public async Task Con_Discovery_apagado_responde_404_y_no_guarda_nada()
    {
        using var disabled = factory.WithWebHostBuilder(b => b.UseSetting("Discovery:Enabled", "false"));
        using var client = disabled.CreateClient();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken());
        var appId = await CreateAppAsync(client);

        Assert.Equal(HttpStatusCode.NotFound, (await UploadAsync(client, appId, Tienda())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await UploadAsync(client, appId, Tienda(), dryRun: true)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await UploadAsync(disabled.CreateClient(), appId, Tienda())).StatusCode);
        await AssertCountsAsync(appId, snapshots: 0, sources: 0);
    }

    [Fact]
    public async Task Sin_archivo_o_con_algo_que_no_es_un_zip_responde_400_accionable()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        using var empty = new MultipartFormDataContent();
        var missing = await JsonAsync(await client.PostAsync(new Uri($"/api/apps/{appId}/sources/snapshots", UriKind.Relative), empty), HttpStatusCode.BadRequest);
        var notZip = await JsonAsync(await UploadAsync(client, appId, Encoding.UTF8.GetBytes("no soy un zip")), HttpStatusCode.BadRequest);

        Assert.Contains("walkie scan", Errors(missing)["file"], StringComparison.Ordinal);
        Assert.Contains("no se pudo abrir como .zip", Errors(notZip)["file"], StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("zip-slip", "file/../manifest.json", "Nombre de entrada inválido")]
    [InlineData("ruta-absoluta", "file//etc/discovery.json", "Nombre de entrada inválido")]
    [InlineData("barra-invertida", "file/datos\\discovery.json", "Nombre de entrada inválido")]
    [InlineData("entrada-repetida", "file/discovery.json", "Entrada repetida")]
    [InlineData("entrada-inesperada", "file/script.sh", "Entrada inesperada")]
    [InlineData("demasiadas-entradas", "file", "demasiadas entradas")]
    [InlineData("sin-discovery", "discovery.json", "Falta en el archivo")]
    [InlineData("json-invalido", "discovery.json", "No es JSON válido")]
    [InlineData("discovery-no-objeto", "discovery.json", "Tiene que ser un objeto JSON")]
    public async Task Un_zip_malicioso_o_malformado_se_rechaza_con_la_ruta_del_problema(string variant, string path, string message)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var (manifest, discovery) = Open(Tienda());
        var m = Encoding.UTF8.GetBytes(manifest.ToJsonString());
        var d = Encoding.UTF8.GetBytes(discovery.ToJsonString());
        var pack = variant switch
        {
            "zip-slip" => Zip(("../manifest.json", m), (DiscoveryFormat.DiscoveryPath, d)),
            "ruta-absoluta" => Zip((DiscoveryFormat.ManifestPath, m), ("/etc/discovery.json", d)),
            "barra-invertida" => Zip((DiscoveryFormat.ManifestPath, m), ("datos\\discovery.json", d)),
            "entrada-repetida" => Duplicate(m, d),
            "entrada-inesperada" => Zip((DiscoveryFormat.ManifestPath, m), (DiscoveryFormat.DiscoveryPath, d), ("script.sh", "rm -rf /"u8.ToArray())),
            "demasiadas-entradas" => ManyEntries(m, d),
            "sin-discovery" => Zip((DiscoveryFormat.ManifestPath, m)),
            "json-invalido" => Zip((DiscoveryFormat.ManifestPath, m), (DiscoveryFormat.DiscoveryPath, "{ \"entities\": ["u8.ToArray())),
            "discovery-no-objeto" => Zip((DiscoveryFormat.ManifestPath, m), (DiscoveryFormat.DiscoveryPath, "[]"u8.ToArray())),
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, null),
        };

        var problem = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.BadRequest);

        var errors = Errors(problem);
        Assert.True(errors.ContainsKey(path), $"Sin {path}: {string.Join(", ", errors.Keys)}");
        Assert.Contains(message, errors[path], StringComparison.Ordinal);
        await AssertCountsAsync(appId, snapshots: 0, sources: 0);
    }

    [Fact]
    public async Task Una_zip_bomb_se_corta_al_leer_aunque_declare_un_tamano_pequeno()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var (manifest, _) = Open(Tienda());

        // 201 MB de espacios comprimen a unos cientos de KB.
        var bomb = Bomb(Encoding.UTF8.GetBytes(manifest.ToJsonString()), 201L * 1024 * 1024);
        Assert.True(bomb.Length < 5 * 1024 * 1024);
        var problem = await JsonAsync(await UploadAsync(client, appId, bomb), HttpStatusCode.BadRequest);

        Assert.Contains("200 MB", Errors(problem)["file"], StringComparison.Ordinal);
        await AssertCountsAsync(appId, snapshots: 0, sources: 0);
    }

    [Fact]
    public async Task Un_paquete_de_mas_de_50_MB_responde_413()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var response = await UploadAsync(client, appId, new byte[(int)Walkie.Modules.Discovery.DiscoveryLimits.MaxPackBytes + 1]);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Contains("walkie scan", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("version-futura", "manifest.json/formatVersion", "actualiza Walkie")]
    [InlineData("otro-formato", "manifest.json/format", "No es un .walkiepack")]
    [InlineData("grafo-futuro", "manifest.json/schemaVersion", "actualiza Walkie")]
    [InlineData("relacion-a-entidad-inexistente", "discovery.json/relations/0/to", "No hay una entidad")]
    [InlineData("evidencia-inexistente", "discovery.json/entities/0/evidence/0", "No hay una evidencia")]
    [InlineData("entidad-repetida", "discovery.json/entities/1/key", "Repetido")]
    [InlineData("fingerprint-alterado", "discovery.json/entities/0/fingerprint", "No coincide")]
    [InlineData("fragmento-sin-permiso", "discovery.json/evidence/0/snippet", "fragmentos de código")]
    [InlineData("ruta-absoluta-en-la-evidencia", "discovery.json/evidence/0/path", "")]
    [InlineData("estadisticas-falsas", "manifest.json/stats/entities", "Dice 999")]
    public async Task Un_paquete_que_no_cumple_el_contrato_se_rechaza_con_la_ruta_y_sin_guardar_nada(string variant, string path, string message)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Alter(Tienda(), (manifest, discovery) =>
        {
            var entities = discovery["entities"]!.AsArray();
            switch (variant)
            {
                case "version-futura": manifest["formatVersion"] = DiscoveryFormat.CurrentVersion + 1; break;
                case "otro-formato": manifest["format"] = "walkie-package"; break;
                case "grafo-futuro": manifest["schemaVersion"] = Walkie.Shared.WalkieInfo.SchemaVersion + 1; break;
                case "relacion-a-entidad-inexistente": discovery["relations"]![0]!["to"] = "api:GET /no-existe"; break;
                case "evidencia-inexistente": entities[0]!["evidence"]![0] = "ev-no-existe"; break;
                case "entidad-repetida": entities.Insert(1, entities[0]!.DeepClone()); break;
                case "fingerprint-alterado": entities[0]!["title"] = "Otro"; break;
                case "fragmento-sin-permiso": discovery["evidence"]![0]!["snippet"] = "services:"; break;
                case "ruta-absoluta-en-la-evidencia": discovery["evidence"]![0]!["path"] = "/home/persona/proyecto/docker-compose.yml"; break;
                case "estadisticas-falsas": manifest["stats"]!["entities"] = 999; break;
                default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
            }
        });

        var problem = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.BadRequest);

        var errors = Errors(problem);
        Assert.True(errors.ContainsKey(path), $"Sin {path}: {string.Join(", ", errors.Keys)}");
        Assert.Contains(message, errors[path], StringComparison.Ordinal);
        await AssertCountsAsync(appId, snapshots: 0, sources: 0);
    }

    [Fact]
    public async Task Un_paquete_con_mas_entidades_que_el_limite_se_rechaza_antes_de_validarlo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Alter(Tienda(), (_, discovery) =>
        {
            var entities = discovery["entities"]!.AsArray();
            var template = entities[0]!;
            for (var i = entities.Count; i <= Walkie.Modules.Discovery.DiscoveryLimits.MaxEntities; i++)
            {
                entities.Add(template.DeepClone());
            }
        });

        var problem = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.BadRequest);

        Assert.Contains("el máximo es 20000", Errors(problem)["discovery.json/entities"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task Un_analisis_guardado_es_inmutable()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var created = await JsonAsync(await UploadAsync(client, appId, Tienda()), HttpStatusCode.Created);
        var snapshotId = created.GetProperty("snapshot").GetProperty("id").GetGuid();

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        var entity = await db.Entities.FirstAsync(e => e.SnapshotId == snapshotId);
        db.Entities.Remove(entity);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();
        var snapshot = await db.Snapshots.FirstAsync(s => s.Id == snapshotId);
        db.Entry(snapshot).Property(s => s.Completeness).CurrentValue = snapshot.Completeness == "complete" ? "partial" : "complete";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task El_endpoint_aparece_en_OpenAPI()
    {
        using var client = factory.CreateClient();

        var document = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("/api/apps/{appId}/sources/snapshots", document, StringComparison.Ordinal);
        Assert.Contains("UploadDiscoverySnapshot", document, StringComparison.Ordinal);
    }

    private async Task AssertCountsAsync(Guid appId, int? snapshots = null, int? entities = null, int? sources = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        if (snapshots is { } s)
        {
            Assert.Equal(s, await db.Snapshots.CountAsync(x => x.AppId == appId));
        }

        if (entities is { } e)
        {
            Assert.Equal(e, await db.Entities.CountAsync(x => db.Snapshots.Any(n => n.Id == x.SnapshotId && n.AppId == appId)));
        }

        if (sources is { } c)
        {
            Assert.Equal(c, await db.Sources.CountAsync(x => x.AppId == appId));
        }
    }

    private static void AssertSame(JsonArray expected, IReadOnlyList<JsonElement> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        for (var i = 0; i < expected.Count; i++)
        {
            Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(expected[i]), actual[i]), $"Distinto en {i}: {actual[i]}");
        }
    }

    private static Dictionary<string, string> Errors(JsonElement problem) =>
        problem.GetProperty("errors").EnumerateObject().ToDictionary(p => p.Name, p => string.Join(" ", p.Value.EnumerateArray().Select(m => m.GetString())));

    private static byte[] Duplicate(byte[] manifest, byte[] discovery) =>
        Zip((DiscoveryFormat.ManifestPath, manifest), (DiscoveryFormat.DiscoveryPath, discovery), (DiscoveryFormat.DiscoveryPath, "{}"u8.ToArray()));

    private static byte[] ManyEntries(byte[] manifest, byte[] discovery) =>
        Zip([(DiscoveryFormat.ManifestPath, manifest), (DiscoveryFormat.DiscoveryPath, discovery), .. Enumerable.Range(0, 2000).Select(i => ($"x/{i}.json", "{}"u8.ToArray()))]);

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Tienda de prueba"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    /// <summary>Una app con una feature (con lienzo guardado) y un elemento del catálogo, para ver que no cambian.</summary>
    private static async Task<(Guid FeatureId, JsonElement Catalog, JsonElement Canvas)> DocumentedAppAsync(HttpClient client, Guid appId)
    {
        var feature = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión"));
        var featureId = (await feature.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var item = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
            new CreateCatalogItemRequest("api", "GET /api/apps", null, TestJson.Http("GET", "/api/apps")));
        Assert.Equal(HttpStatusCode.Created, item.StatusCode);
        var graph = new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = 0,
            ["nodes"] = new JsonObject { ["n1"] = new JsonObject { ["id"] = "n1", ["type"] = "screen", ["title"] = "Login" } },
            ["edges"] = new JsonObject(),
            ["layout"] = new JsonObject { ["n1"] = new JsonObject { ["x"] = 16, ["y"] = 24 } },
        };
        Assert.True((await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph)).IsSuccessStatusCode);
        return (featureId,
            await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)),
            await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)));
    }
}
