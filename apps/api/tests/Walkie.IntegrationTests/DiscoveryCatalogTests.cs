using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Features;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Crear en el catálogo desde Walkie Live (spec walkie-live, tarea 6; ADR-0012 y ADR-0014): <c>create</c> en
/// <c>POST /api/snapshots/{id}/apply</c> con vista previa, bitácora (<c>pending</c> → <c>completed</c> o
/// <c>compensated</c>), recuperación tras una caída simulada, concurrencia y procedencia
/// (<c>GET /api/apps/{appId}/bindings</c>). Postgres real y paquetes de la CLI real. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryCatalogTests(WalkieApiFactory factory)
{
    private const string Get = "api:GET /api/pedidos/{}";
    private const string Post = "api:POST /api/pedidos";
    private const string Delete = "api:DELETE /api/pedidos/{}";
    private const string Db = "database:postgresql/tienda";
    private const string Service = "service:Tienda.Api";
    private const string Module = "module:Tienda.Pedidos";
    private static readonly string[] CsprojOnly = ["csproj"];

    /// <summary>Una fuente por prueba: cada análisis de la prueba es de la misma fuente (como `.walkie/source.json`).</summary>
    private readonly string source = Guid.CreateVersion7().ToString();

    // ---------- Crear ----------

    [Fact]
    public async Task Crear_una_api_primero_muestra_la_vista_previa_y_despues_la_crea_con_el_mismo_id_y_su_vinculo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var id = Guid.CreateVersion7();
        var applyId = Guid.CreateVersion7();

        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: true, Create(Get, id)), HttpStatusCode.OK);

        AssertResult(preview);
        Assert.Equal("planned", preview.GetProperty("status").GetString());
        var planned = preview.GetProperty("created").EnumerateArray().Single();
        Assert.Equal(Get, planned.GetProperty("entityKey").GetString());
        Assert.Equal(id, planned.GetProperty("target").GetProperty("id").GetGuid());
        var item = planned.GetProperty("item");
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.CatalogItem, item));
        Assert.Equal(id, item.GetProperty("id").GetGuid());
        Assert.Equal("api", item.GetProperty("type").GetString());
        Assert.Equal(1, item.GetProperty("version").GetInt32());
        Assert.Equal("GET", item.GetProperty("http").GetProperty("method").GetString());
        Assert.Equal("/api/pedidos/{id}", item.GetProperty("http").GetProperty("path").GetString());
        Assert.False(item.TryGetProperty("description", out _)); // el análisis no la trajo: no se inventa
        Assert.Contains(Warnings(preview), w => w.Code == "to-complete" && w.Message.Contains("descripción", StringComparison.Ordinal)
            && w.Message.Contains("respuestas", StringComparison.Ordinal));
        Assert.Empty(await CatalogOfAsync(client, appId)); // la vista previa no escribe
        await AssertBindingsAsync(appId, 0);

        var done = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false, Create(Get, id)), HttpStatusCode.OK);

        AssertResult(done);
        Assert.Equal("completed", done.GetProperty("status").GetString());
        var created = await JsonAsync(await client.GetAsync(new Uri($"/api/catalog/{id}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.True(JsonElement.DeepEquals(item, created), $"{item}\n{created}");
        var reviewed = ItemOf(await ReviewAsync(client, snapshotId), Get);
        Assert.Equal("created", reviewed.GetProperty("status").GetString());
        Assert.Equal(id, reviewed.GetProperty("binding").GetProperty("target").GetProperty("id").GetGuid());
        Assert.Equal(applyId, reviewed.GetProperty("binding").GetProperty("applyId").GetGuid());
        Assert.Equal("completed", await ApplyStatusAsync(applyId));
    }

    [Theory]
    [InlineData(Service, "service")]
    [InlineData(Db, "database")]
    [InlineData("resource", "resource")]
    public async Task Crea_servicios_bases_y_recursos_con_lo_que_trajo_el_analisis(string keyOrKind, string type)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var review = await ReviewAsync(client, snapshotId, "pageSize=500");
        var key = keyOrKind.Contains(':', StringComparison.Ordinal)
            ? keyOrKind
            : review.GetProperty("items").EnumerateArray().First(i => i.GetProperty("kind").GetString() == keyOrKind).GetProperty("key").GetString()!;
        var id = Guid.CreateVersion7();

        var done = await JsonAsync(await ApplyAsync(client, snapshotId, Create(key, id)), HttpStatusCode.OK);

        AssertResult(done);
        var created = await JsonAsync(await client.GetAsync(new Uri($"/api/catalog/{id}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(type, created.GetProperty("type").GetString());
        switch (type)
        {
            case "database":
                Assert.Equal("PostgreSQL", created.GetProperty("database").GetProperty("engine").GetString());
                Assert.Equal("tienda", created.GetProperty("database").GetProperty("name").GetString());
                break;
            case "resource":
                Assert.Equal("cache", created.GetProperty("resource").GetProperty("kind").GetString());
                break;
            case "service":
                Assert.False(created.TryGetProperty("http", out _));
                break;
        }
    }

    [Fact]
    public async Task Una_base_de_EF_se_crea_como_modelo_logico_con_su_aviso_y_sin_motor_inventado()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack(ef: true));
        var key = (await ReviewAsync(client, snapshotId, "kind=database")).GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("key").GetString()!).Single(k => k.StartsWith("database:efcore/", StringComparison.Ordinal));

        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: true, Create(key, Guid.CreateVersion7())), HttpStatusCode.OK);

        var warnings = Warnings(preview);
        Assert.Contains(warnings, w => w.Code == "logical-database");
        Assert.Contains(warnings, w => w.Code == "to-complete" && w.Message.Contains("motor", StringComparison.Ordinal));
        var item = preview.GetProperty("created")[0].GetProperty("item");
        Assert.False(item.TryGetProperty("database", out var database) && database.TryGetProperty("engine", out _));
    }

    [Fact]
    public async Task Un_hallazgo_inferido_se_crea_solo_si_se_pide_y_la_vista_previa_lo_dice()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Alter(Pack(), (_, discovery) =>
        {
            var entity = discovery["entities"]!.AsArray().Single(e => e!["key"]!.GetValue<string>() == Post)!.AsObject();
            entity["basis"] = "inferred";
            entity["confidence"] = "medium";
            entity["derivedFrom"] = new JsonArray(Service);
        });
        var snapshotId = await UploadSnapshotAsync(client, appId, pack);
        var reviewed = ItemOf(await ReviewAsync(client, snapshotId), Post);
        Assert.Equal("inferred", reviewed.GetProperty("basis").GetString());
        Assert.False(reviewed.TryGetProperty("binding", out _)); // nada se vincula solo
        await AssertBindingsAsync(appId, 0);

        var id = Guid.CreateVersion7();
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: true, Create(Post, id)), HttpStatusCode.OK);
        Assert.Contains(Warnings(preview), w => w.Code == "inferred" && w.Message.Contains(Service, StringComparison.Ordinal));
        Assert.Empty(await CatalogOfAsync(client, appId));

        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Post, id)), HttpStatusCode.OK);
        var binding = ItemOf(await ReviewAsync(client, snapshotId), Post).GetProperty("binding");
        Assert.Equal("created", binding.GetProperty("decision").GetString());
        // La naturaleza inferida no entra al elemento: vive en el hallazgo y su vínculo.
        var created = await JsonAsync(await client.GetAsync(new Uri($"/api/catalog/{id}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.DoesNotContain("inferred", created.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("modulo-sin-apis-en-el-catalogo", "/operations/0/entityKey")]
    [InlineData("titulo-en-blanco", "/operations/0/item/Title")]
    [InlineData("id-repetido-en-la-solicitud", "/operations/1/id")]
    [InlineData("crear-sin-id", "/operations/0")]
    public async Task Crear_lo_que_no_se_puede_responde_400_con_su_ruta_y_no_escribe_nada(string variant, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = variant == "titulo-en-blanco"
            ? Alter(Pack(), (_, discovery) =>
            {
                // Pasa el schema del paquete (minLength 1) pero no las reglas del catálogo: lo frena la validación oficial.
                var entity = discovery["entities"]!.AsArray().Single(e => e!["key"]!.GetValue<string>() == Get)!.AsObject();
                entity["title"] = "   ";
                entity["fingerprint"] = DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(entity));
            })
            : Pack();
        var snapshotId = await UploadSnapshotAsync(client, appId, pack);
        var id = Guid.CreateVersion7();
        JsonObject[] operations = variant switch
        {
            "modulo-sin-apis-en-el-catalogo" => [Create(Module, id)], // tarea 9: su lienzo necesita sus APIs en el catálogo
            "titulo-en-blanco" => [Create(Get, id)],
            "id-repetido-en-la-solicitud" => [Create(Get, id), Create(Post, id)],
            "crear-sin-id" => [new JsonObject { ["op"] = "create", ["entityKey"] = Get }],
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, null),
        };

        var problem = await JsonAsync(await ApplyAsync(client, snapshotId, operations), HttpStatusCode.BadRequest);

        Assert.True(problem.GetProperty("errors").TryGetProperty(path, out _), problem.ToString());
        Assert.Empty(await CatalogOfAsync(client, appId));
        await AssertBindingsAsync(appId, 0);
        await AssertNoJournalAsync(appId);
    }

    [Fact]
    public async Task Una_firma_que_ya_esta_en_el_catalogo_no_se_duplica_y_un_titulo_igual_solo_avisa()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var existing = await CatalogAsync(client, appId, "api", "Consultar pedido", TestJson.Http("GET", "/api/pedidos/{pedidoId}"));
        await CatalogAsync(client, appId, "service", "Tienda.Api");
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var duplicate = await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, Guid.CreateVersion7())), HttpStatusCode.Conflict);
        Assert.Contains("misma firma", Error(duplicate, "/operations/0/entityKey"), StringComparison.Ordinal);
        Assert.Contains("vincúlalo", Error(duplicate, "/operations/0/entityKey"), StringComparison.Ordinal);

        var sameTitle = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: true, Create(Service, Guid.CreateVersion7())), HttpStatusCode.OK);
        Assert.Contains(Warnings(sameTitle), w => w.Code == "same-title");

        Assert.Equal(2, (await CatalogOfAsync(client, appId)).Count);
        Assert.Equal(1, (await JsonAsync(await client.GetAsync(new Uri($"/api/catalog/{existing}", UriKind.Relative)), HttpStatusCode.OK)).GetProperty("version").GetInt32());
    }

    // ---------- Idempotencia y concurrencia ----------

    [Fact]
    public async Task El_mismo_applyId_devuelve_lo_mismo_sin_duplicar_y_con_otra_solicitud_da_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var applyId = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();

        var first = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false, Create(Get, id)), HttpStatusCode.OK);
        var again = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false, Create(Get, id)), HttpStatusCode.OK);
        var other = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false, Create(Post, Guid.CreateVersion7())), HttpStatusCode.Conflict);

        Assert.True(JsonElement.DeepEquals(first, again));
        Assert.Contains("otra solicitud", Error(other, "applyId"), StringComparison.Ordinal);
        Assert.Single(await CatalogOfAsync(client, appId));
        await AssertBindingsAsync(appId, 1);
    }

    [Fact]
    public async Task Un_doble_clic_crea_un_solo_elemento()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var applyId = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();

        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => ApplyAsync(client, snapshotId, applyId, dryRun: false, Create(Get, id))));

        // Cada clic recibe el resultado o «se está ejecutando» (409): nunca un segundo elemento.
        Assert.All(responses, r => Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict, r.StatusCode.ToString()));
        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(await CatalogOfAsync(client, appId));
        var done = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false, Create(Get, id)), HttpStatusCode.OK);
        Assert.Equal("completed", done.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Dos_aplicaciones_distintas_que_crean_el_mismo_hallazgo_a_la_vez_dejan_uno_solo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => ApplyAsync(client, snapshotId, Create(Get, Guid.CreateVersion7()))));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        Assert.Single(await CatalogOfAsync(client, appId));
        await AssertBindingsAsync(appId, 1);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.False(await db.Bindings.AnyAsync(b => b.AppId == appId && b.PendingApplyId != null));
    }

    [Fact]
    public async Task Crear_con_una_version_vieja_con_una_decision_activa_o_sobre_un_analisis_viejo_da_409_sin_escribir()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        await JsonAsync(await ApplyAsync(client, snapshotId, Op("reject", Db, 0)), HttpStatusCode.OK);

        var stale = await JsonAsync(await ApplyAsync(client, snapshotId, Create(Db, Guid.CreateVersion7(), version: 0)), HttpStatusCode.Conflict);
        Assert.True(stale.GetProperty("errors").TryGetProperty("/operations/0/bindingVersion", out _));
        var decided = await JsonAsync(await ApplyAsync(client, snapshotId, Create(Db, Guid.CreateVersion7(), version: 1)), HttpStatusCode.Conflict);
        Assert.Contains("restablécela", Error(decided, "/operations/0/entityKey"), StringComparison.Ordinal);

        var newer = await UploadSnapshotAsync(client, appId, Pack(extraEndpoint: true));
        Assert.NotEqual(snapshotId, newer);
        var old = await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, Guid.CreateVersion7())), HttpStatusCode.Conflict);
        Assert.True(old.GetProperty("errors").TryGetProperty("snapshotId", out _));

        Assert.Empty(await CatalogOfAsync(client, appId));
    }

    [Fact]
    public async Task Un_id_que_ya_es_de_otro_elemento_da_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var id = Guid.CreateVersion7();
        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, id)), HttpStatusCode.OK);

        var reused = await JsonAsync(await ApplyAsync(client, snapshotId, Create(Post, id)), HttpStatusCode.Conflict);

        Assert.True(reused.GetProperty("errors").TryGetProperty("/operations/0/id", out _));
        Assert.Single(await CatalogOfAsync(client, appId));
    }

    // ---------- Fallos, caídas y compensación ----------

    [Fact]
    public async Task Un_fallo_entre_escrituras_deshace_lo_creado_y_no_deja_decisiones()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var applyId = Guid.CreateVersion7();
        using var faulty = WithCheckpoints((checkpoint, _) =>
            checkpoint == "created:1" ? throw new InvalidOperationException("fallo simulado") : Task.CompletedTask);
        using var failing = Authenticated(faulty);

        var result = await JsonAsync(await ApplyAsync(failing, snapshotId, applyId, dryRun: false,
            Create(Get, Guid.CreateVersion7()), Create(Post, Guid.CreateVersion7()), Op("reject", Db, 0)), HttpStatusCode.OK);

        AssertResult(result);
        Assert.Equal("compensated", result.GetProperty("status").GetString());
        Assert.Contains(Warnings(result), w => w.Code == "compensated");
        Assert.Empty(result.GetProperty("created").EnumerateArray());
        Assert.Empty(await CatalogOfAsync(client, appId));
        await AssertBindingsAsync(appId, 0);
        Assert.Equal("compensated", await ApplyStatusAsync(applyId));
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.False(await db.Bindings.AnyAsync(b => b.AppId == appId && b.PendingApplyId != null));
        Assert.All(await db.ApplySteps.Where(s => s.ApplyId == applyId).ToListAsync(), s => Assert.Equal("compensated", s.Status));

        // El mismo applyId repite el resultado; una decisión nueva (otro applyId) sí puede crearlos.
        var replay = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false,
            Create(Get, Guid.CreateVersion7()), Create(Post, Guid.CreateVersion7()), Op("reject", Db, 0)), HttpStatusCode.Conflict);
        Assert.True(replay.GetProperty("errors").TryGetProperty("applyId", out _)); // ids distintos: otra solicitud
        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, Guid.CreateVersion7())), HttpStatusCode.OK);
    }

    [Fact]
    public async Task La_compensacion_no_borra_lo_que_una_persona_ya_edito()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var first = Guid.CreateVersion7();
        var second = Guid.CreateVersion7();
        using var faulty = WithCheckpoints(async (checkpoint, _) =>
        {
            if (checkpoint != "created:1")
            {
                return;
            }

            // Mientras la aplicación sigue, alguien edita el primer elemento creado.
            var edited = await client.PutAsJsonAsync(new Uri($"/api/catalog/{first}", UriKind.Relative),
                new UpdateCatalogItemRequest("Consultar pedido", "Escrito por una persona", TestJson.Http("GET", "/api/pedidos/{pedidoId}"), 1));
            Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
            throw new InvalidOperationException("fallo simulado");
        });
        using var failing = Authenticated(faulty);

        var result = await JsonAsync(await ApplyAsync(failing, snapshotId, Create(Get, first), Create(Post, second)), HttpStatusCode.OK);

        Assert.Equal("compensated", result.GetProperty("status").GetString());
        var kept = Assert.Single(Warnings(result), w => w.Code == "compensation-kept");
        Assert.Equal(Get, kept.EntityKey);
        Assert.Equal(first, result.GetProperty("unchanged")[0].GetProperty("id").GetGuid());
        var catalog = await CatalogOfAsync(client, appId);
        var survivor = Assert.Single(catalog);
        Assert.Equal(first, survivor.GetProperty("id").GetGuid());
        Assert.Equal("Escrito por una persona", survivor.GetProperty("description").GetString());
        await AssertBindingsAsync(appId, 0); // quedó sin vínculo, documentado en la bitácora y el aviso
    }

    [Theory]
    [InlineData("pending", 0)]
    [InlineData("created:0", 1)]
    [InlineData("created:1", 2)]
    [InlineData("finalize", 2)]
    public async Task Tras_una_caida_el_reintento_con_el_mismo_applyId_termina_sin_duplicar(string checkpoint, int createdBefore)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var applyId = Guid.CreateVersion7();
        JsonObject[] operations = [Create(Get, Guid.CreateVersion7()), Create(Post, Guid.CreateVersion7()), Op("reject", Db, 0)];
        using (var crashing = WithCheckpoints((reached, _) =>
            reached == checkpoint ? throw new ApplyAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ApplyAsync(dying, snapshotId, applyId, dryRun: false, operations));
        }

        // Quedó a medias: pending, con lo creado hasta ahí y los hallazgos reservados, sin decisiones.
        Assert.Equal("pending", await ApplyStatusAsync(applyId));
        Assert.Equal(createdBefore, (await CatalogOfAsync(client, appId)).Count);
        await AssertBindingsAsync(appId, 0);

        var done = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, dryRun: false, operations), HttpStatusCode.OK);

        AssertResult(done);
        Assert.Equal("completed", done.GetProperty("status").GetString());
        Assert.Equal(2, (await CatalogOfAsync(client, appId)).Count);
        await AssertBindingsAsync(appId, 3);
        Assert.Equal("completed", await ApplyStatusAsync(applyId));
    }

    [Fact]
    public async Task Otra_aplicacion_sobre_un_hallazgo_reservado_termina_la_interrumpida_y_pide_revisar_otra_vez()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var applyId = Guid.CreateVersion7();
        using (var crashing = WithCheckpoints((reached, _) => reached == "created:0" ? throw new ApplyAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ApplyAsync(dying, snapshotId, applyId, dryRun: false, Create(Get, Guid.CreateVersion7())));
        }

        // La vista previa no escribe: solo dice que hay una aplicación sin terminar.
        await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: true, Op("reject", Get, 0)), HttpStatusCode.Conflict);
        Assert.Equal("pending", await ApplyStatusAsync(applyId));

        var other = await JsonAsync(await ApplyAsync(client, snapshotId, Op("reject", Get, 0)), HttpStatusCode.Conflict);

        Assert.Contains("se terminó", Error(other, "operations"), StringComparison.Ordinal);
        Assert.Equal("completed", await ApplyStatusAsync(applyId));
        Assert.Equal("created", ItemOf(await ReviewAsync(client, snapshotId), Get).GetProperty("status").GetString());
        Assert.Single(await CatalogOfAsync(client, appId));
    }

    // ---------- Procedencia, cambios humanos y destinos borrados ----------

    [Fact]
    public async Task La_procedencia_dice_de_que_fuente_hallazgo_analisis_y_evidencia_viene_un_elemento()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var id = Guid.CreateVersion7();
        var linked = await CatalogAsync(client, appId, "database", "Ventas");
        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, id), Link(Db, "catalogItem", linked, 0)), HttpStatusCode.OK);

        var provenance = await ProvenanceAsync(client, appId, $"catalogItem:{id}");

        Assert.True(provenance.GetProperty("targetExists").GetBoolean());
        var origin = provenance.GetProperty("bindings").EnumerateArray().Single();
        Assert.Equal("Proyecto demo", origin.GetProperty("source").GetProperty("name").GetString());
        Assert.Equal("created", origin.GetProperty("binding").GetProperty("decision").GetString());
        Assert.Equal(snapshotId, origin.GetProperty("binding").GetProperty("snapshotId").GetGuid());
        Assert.Equal(Get, origin.GetProperty("entity").GetProperty("key").GetString());
        Assert.Equal("observed", origin.GetProperty("entity").GetProperty("basis").GetString());
        var evidence = origin.GetProperty("evidence").EnumerateArray().First();
        Assert.Equal("src/Tienda.Api/Program.cs", evidence.GetProperty("path").GetString());
        Assert.False(evidence.TryGetProperty("snippet", out _));
        Assert.Equal("same", origin.GetProperty("latest").GetProperty("status").GetString());

        var ofLinked = await ProvenanceAsync(client, appId, $"catalogItem:{linked}");
        Assert.Equal("linked", ofLinked.GetProperty("bindings")[0].GetProperty("binding").GetProperty("decision").GetString());
        var none = await ProvenanceAsync(client, appId, $"catalogItem:{await CatalogAsync(client, appId, "service", "Manual")}");
        Assert.Empty(none.GetProperty("bindings").EnumerateArray());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(BindingsUri(appId, "catalogItem"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(BindingsUri(appId, $"screen:{id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BindingsUri(Guid.NewGuid(), $"catalogItem:{id}"))).StatusCode);
    }

    [Fact]
    public async Task Lo_editado_a_mano_no_se_sobrescribe_al_reimportar_y_la_procedencia_no_bloquea_editar()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var id = Guid.CreateVersion7();
        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, id)), HttpStatusCode.OK);

        var edit = new UpdateCatalogItemRequest("Ver un pedido", "Documentado por el equipo", TestJson.Http("GET", "/api/pedidos/{pedidoId}"), 1);
        var edited = await JsonAsync(await client.PutAsJsonAsync(new Uri($"/api/catalog/{id}", UriKind.Relative), edit), HttpStatusCode.OK);
        Assert.Equal(2, edited.GetProperty("version").GetInt32());

        // Un análisis nuevo de la misma fuente, con el endpoint renombrado en el código: nada se reescribe.
        var newer = await UploadSnapshotAsync(client, appId, Pack(parameter: "codigo"));
        var after = await JsonAsync(await client.GetAsync(new Uri($"/api/catalog/{id}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.True(JsonElement.DeepEquals(edited, after), $"{edited}\n{after}");
        Assert.Single(await CatalogOfAsync(client, appId));
        var status = ItemOf(await ReviewAsync(client, newer), Get).GetProperty("status").GetString();
        Assert.Equal("changed", status); // la ruta cambió en el código: se marca, no se copia al elemento
        var provenance = await ProvenanceAsync(client, appId, $"catalogItem:{id}");
        Assert.Equal("Ver un pedido", provenance.GetProperty("target").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Un_elemento_borrado_a_mano_no_se_presenta_como_vinculo_valido()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var id = Guid.CreateVersion7();
        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, id)), HttpStatusCode.OK);
        Assert.False(ItemOf(await ReviewAsync(client, snapshotId), Get).TryGetProperty("targetMissing", out _));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(new Uri($"/api/catalog/{id}", UriKind.Relative))).StatusCode);

        var reviewed = ItemOf(await ReviewAsync(client, snapshotId), Get);
        Assert.True(reviewed.GetProperty("targetMissing").GetBoolean());
        Assert.False((await ProvenanceAsync(client, appId, $"catalogItem:{id}")).GetProperty("targetExists").GetBoolean());
        // Se puede restablecer y decidir otra vez.
        var version = reviewed.GetProperty("binding").GetProperty("version").GetInt32();
        await JsonAsync(await ApplyAsync(client, snapshotId, Op("reset", Get, version)), HttpStatusCode.OK);
        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, Guid.CreateVersion7())), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Crear_en_el_catalogo_no_toca_lienzos_modulos_features_ni_el_resto_del_catalogo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Listar pedidos", TestJson.Http("GET", "/api/pedidos"));
        var moduleId = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative),
            new { id = moduleId, name = "Pedidos" })).StatusCode);
        var featureId = await FeatureWithCanvasAsync(client, appId, itemId);
        var before = await StateAsync(client, appId, featureId, moduleId);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        await JsonAsync(await ApplyAsync(client, snapshotId, Create(Get, Guid.CreateVersion7()), Create(Service, Guid.CreateVersion7())), HttpStatusCode.OK);

        var after = await StateAsync(client, appId, featureId, moduleId);
        foreach (var part in new[] { "features", "modules", "canvas", "moduleCanvas" })
        {
            Assert.True(JsonElement.DeepEquals(before.GetProperty(part), after.GetProperty(part)), part);
        }

        var existing = after.GetProperty("catalog").EnumerateArray().Single(i => i.GetProperty("id").GetGuid() == itemId);
        Assert.True(JsonElement.DeepEquals(before.GetProperty("catalog")[0], existing));
        Assert.Equal(3, after.GetProperty("catalog").GetArrayLength());
    }

    [Fact]
    public async Task Crear_vincular_rechazar_y_restablecer_conviven_en_una_aplicacion()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var target = await CatalogAsync(client, appId, "service", "API de la tienda");
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        await JsonAsync(await ApplyAsync(client, snapshotId, Op("reject", Post, 0)), HttpStatusCode.OK);

        var result = await JsonAsync(await ApplyAsync(client, snapshotId,
            Create(Get, Guid.CreateVersion7()), Link(Service, "catalogItem", target, 0), Op("reject", Db, 0), Op("reset", Post, 1)), HttpStatusCode.OK);

        AssertResult(result);
        Assert.Single(result.GetProperty("created").EnumerateArray());
        Assert.Single(result.GetProperty("linked").EnumerateArray());
        Assert.Equal([Db], result.GetProperty("rejected").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal([Post], result.GetProperty("reset").EnumerateArray().Select(e => e.GetString()));
        var review = await ReviewAsync(client, snapshotId);
        Assert.Equal("created", ItemOf(review, Get).GetProperty("status").GetString());
        Assert.Equal("linked", ItemOf(review, Service).GetProperty("status").GetString());
        Assert.Equal("rejected", ItemOf(review, Db).GetProperty("status").GetString());
        Assert.NotEqual("rejected", ItemOf(review, Post).GetProperty("status").GetString());
    }

    // ---------- Seguridad ----------

    [Fact]
    public async Task Sin_sesion_401_con_Discovery_apagado_404_y_la_procedencia_aparece_en_OpenAPI()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var id = Guid.CreateVersion7();
        using var anonymous = factory.CreateClient();
        using var disabled = factory.WithWebHostBuilder(b => b.UseSetting("Discovery:Enabled", "false"));
        using var off = Authenticated(disabled);

        foreach (var (http, expected) in new[] { (anonymous, HttpStatusCode.Unauthorized), (off, HttpStatusCode.NotFound) })
        {
            Assert.Equal(expected, (await ApplyAsync(http, snapshotId, Create(Get, id))).StatusCode);
            Assert.Equal(expected, (await http.GetAsync(BindingsUri(appId, $"catalogItem:{id}"))).StatusCode);
        }

        Assert.Empty(await CatalogOfAsync(client, appId));
        var document = await anonymous.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));
        Assert.Contains("/api/apps/{appId}/bindings", document, StringComparison.Ordinal);
    }

    // ---------- Transformación (pura) ----------

    [Fact]
    public void La_transformacion_copia_el_contrato_sin_agregar_nada_y_avisa_lo_que_falta()
    {
        using var document = JsonDocument.Parse("""
            { "key": "service:Tienda.Api", "kind": "service", "title": "Tienda.Api", "basis": "observed", "confidence": "high",
              "fingerprint": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "evidence": ["e1"] }
            """);

        var item = CatalogDraft.From(document.RootElement);
        var warnings = CatalogDraft.Warnings("service:Tienda.Api", document.RootElement, CsprojOnly).ToList();

        Assert.Equal(new CreateCatalogItemRequest("service", "Tienda.Api", null, null), item);
        var missing = Assert.Single(warnings);
        Assert.Equal("to-complete", missing.Code);
        Assert.Contains("dónde corre", missing.Message, StringComparison.Ordinal);
    }

    // ---------- Ayudas ----------

    /// <summary>El proyecto ficticio: API (con una biblioteca que es módulo), base y caché en compose y, si se pide, un DbContext.</summary>
    private byte[] Pack(bool extraEndpoint = false, string parameter = "id", bool ef = false)
    {
        var files = new Dictionary<string, string>
        {
            ["src/Tienda.Api/Tienda.Api.csproj"] =
                "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>"
                + "<ItemGroup><ProjectReference Include=\"../Tienda.Pedidos/Tienda.Pedidos.csproj\" /></ItemGroup></Project>",
            ["src/Tienda.Api/Program.cs"] =
                "var app = WebApplication.CreateBuilder(args).Build();\nvar pedidos = app.MapGroup(\"/api/pedidos\");\n"
                + $"pedidos.MapGet(\"/{{{parameter}:guid}}\", (Guid {parameter}) => 1);\npedidos.MapPost(\"/\", () => 1);\n"
                + (extraEndpoint ? "pedidos.MapPut(\"/{id:guid}\", (Guid id) => 1);\n" : "")
                + "app.Run();\n",
            ["src/Tienda.Pedidos/Tienda.Pedidos.csproj"] =
                "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
            ["src/Tienda.Pedidos/PedidosEndpoints.cs"] =
                "namespace Tienda.Pedidos;\npublic static class PedidosEndpoints\n{\n    public static void Map(IEndpointRouteBuilder routes) => routes.MapDelete(\"/api/pedidos/{id:guid}\", (Guid id) => 1);\n}\n",
            ["docker-compose.yml"] =
                "services:\n  api:\n    build: ./src/Tienda.Api\n    depends_on: [db, cache]\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_DB: tienda\n  cache:\n    image: redis:7\n",
        };
        if (ef)
        {
            files["src/Tienda.Pedidos/TiendaDbContext.cs"] =
                "namespace Tienda.Pedidos;\npublic sealed class TiendaDbContext(DbContextOptions<TiendaDbContext> options) : DbContext(options)\n{\n    public DbSet<Pedido> Pedidos => Set<Pedido>();\n}\n";
        }

        return Scan(files, "--source-id", source);
    }

    private static JsonObject Create(string key, Guid id, int version = 0) =>
        new() { ["op"] = "create", ["entityKey"] = key, ["id"] = id.ToString(), ["bindingVersion"] = version };

    private static JsonObject Op(string op, string key, int version) =>
        new() { ["op"] = op, ["entityKey"] = key, ["bindingVersion"] = version };

    private static JsonObject Link(string key, string kind, Guid id, int version) =>
        new() { ["op"] = "link", ["entityKey"] = key, ["target"] = new JsonObject { ["kind"] = kind, ["id"] = id.ToString() }, ["bindingVersion"] = version };

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, params JsonObject[] operations) =>
        ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: false, operations);

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, Guid applyId, bool dryRun, params JsonObject[] operations)
    {
        var body = new JsonObject { ["applyId"] = applyId.ToString(), ["operations"] = new JsonArray([.. operations.Select(o => (JsonNode)o.DeepClone())]) };
        return client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative), body);
    }

    private static void AssertResult(JsonElement result) => Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryApplyResult, result));

    private static List<(string Code, string Message, string? EntityKey)> Warnings(JsonElement result) =>
        [.. result.GetProperty("warnings").EnumerateArray().Select(w => (
            w.GetProperty("code").GetString()!,
            w.GetProperty("message").GetString()!,
            w.TryGetProperty("entityKey", out var key) ? key.GetString() : null))];

    private static string Error(JsonElement problem, string path) =>
        string.Join(" ", problem.GetProperty("errors").GetProperty(path).EnumerateArray().Select(m => m.GetString()));

    private static Uri BindingsUri(Guid appId, string target) =>
        new($"/api/apps/{appId}/bindings?target={Uri.EscapeDataString(target)}", UriKind.Relative);

    private static async Task<JsonElement> ProvenanceAsync(HttpClient client, Guid appId, string target)
    {
        var provenance = await JsonAsync(await client.GetAsync(BindingsUri(appId, target)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryProvenance, provenance));
        return provenance;
    }

    private static async Task<Guid> UploadSnapshotAsync(HttpClient client, Guid appId, byte[] pack) =>
        (await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId, string query = "pageSize=500") =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?{query}", UriKind.Relative)), HttpStatusCode.OK);

    private static JsonElement ItemOf(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);

    private static async Task<List<JsonElement>> CatalogOfAsync(HttpClient client, Guid appId) =>
        [.. (await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK)).EnumerateArray()];

    private static async Task<Guid> CatalogAsync(HttpClient client, Guid appId, string type, string title, JsonElement? http = null)
    {
        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), new CreateCatalogItemRequest(type, title, null, http));
        return (await JsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Tienda de prueba"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    /// <summary>Una feature con un lienzo que usa el elemento del catálogo y tiene un tour.</summary>
    private static async Task<Guid> FeatureWithCanvasAsync(HttpClient client, Guid appId, Guid itemId)
    {
        var feature = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Ver pedido"));
        var featureId = (await feature.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var graph = new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = 0,
            ["nodes"] = new JsonObject
            {
                ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Detalle" },
                ["r1"] = new JsonObject { ["id"] = "r1", ["type"] = "ref", ["title"] = "Listar pedidos", ["catalogId"] = itemId.ToString() },
            },
            ["edges"] = new JsonObject { ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "r1", ["kind"] = "request" } },
            ["layout"] = new JsonObject { ["s1"] = new JsonObject { ["x"] = 0, ["y"] = 0 }, ["r1"] = new JsonObject { ["x"] = 240, ["y"] = 0 } },
            ["tours"] = new JsonObject
            {
                ["t1"] = new JsonObject
                {
                    ["id"] = "t1", ["name"] = "Recorrido", ["kind"] = "guide",
                    ["steps"] = new JsonArray(new JsonObject { ["id"] = "p1", ["nodeId"] = "s1", ["note"] = "Empieza aquí" }),
                },
            },
        };
        var saved = await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph);
        Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());
        return featureId;
    }

    private static async Task<JsonElement> StateAsync(HttpClient client, Guid appId, Guid featureId, Guid moduleId)
    {
        async Task<JsonNode> GetAsync(string uri) => JsonNode.Parse(await client.GetStringAsync(new Uri(uri, UriKind.Relative)))!;
        var state = new JsonObject
        {
            ["catalog"] = await GetAsync($"/api/apps/{appId}/catalog"),
            ["features"] = await GetAsync($"/api/apps/{appId}/features"),
            ["modules"] = await GetAsync($"/api/apps/{appId}/modules"),
            ["canvas"] = await GetAsync($"/api/features/{featureId}/canvas"),
            ["moduleCanvas"] = await GetAsync($"/api/features/{moduleId}/canvas"),
        };
        return JsonSerializer.SerializeToElement(state);
    }

    /// <summary>La API con un <see cref="IApplyCheckpoints"/> que hace lo que diga la prueba en cada punto.</summary>
    private WebApplicationFactory<Program> WithCheckpoints(Func<string, Guid, Task> reached) =>
        factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IApplyCheckpoints>(new TestCheckpoints(reached))));

    private static HttpClient Authenticated(WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken());
        return client;
    }

    /// <summary>Una solicitud que se corta en una caída simulada: no hay respuesta útil (500 o la excepción del servidor de pruebas).</summary>
    private static async Task CrashAsync(Func<Task<HttpResponseMessage>> request)
    {
        try
        {
            var response = await request();
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        }
        catch (ApplyAbandonedException)
        {
        }
    }

    private async Task<string?> ApplyStatusAsync(Guid applyId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        return await db.Applies.Where(a => a.ApplyId == applyId).Select(a => a.Status).SingleOrDefaultAsync();
    }

    private async Task AssertBindingsAsync(Guid appId, int expected)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.Equal(expected, await db.Bindings.CountAsync(b => b.AppId == appId && b.Decision != null));
    }

    private async Task AssertNoJournalAsync(Guid appId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.False(await db.Applies.AnyAsync(a => a.AppId == appId));
    }

    private sealed class TestCheckpoints(Func<string, Guid, Task> reached) : IApplyCheckpoints
    {
        public Task ReachedAsync(string checkpoint, Guid applyId) => reached(checkpoint, applyId);
    }
}
