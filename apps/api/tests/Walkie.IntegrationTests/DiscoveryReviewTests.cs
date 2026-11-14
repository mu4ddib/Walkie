using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Revisión calculada y decisiones (spec walkie-live, tarea 4; ADR-0012 y ADR-0014): <c>GET /api/snapshots/{id}/review</c>,
/// <c>POST /api/snapshots/{id}/apply</c> (reject, link, reset) y <c>GET /api/apps/{id}/sources</c>, con Postgres real y
/// paquetes de la CLI real. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryReviewTests(WalkieApiFactory factory)
{
    private const string Get = "api:GET /api/pedidos/{}";
    private const string Post = "api:POST /api/pedidos";
    private const string Db = "database:postgresql/tienda";
    private const string Service = "service:Tienda.Api";

    // ---------- Revisión ----------

    [Fact]
    public async Task Un_analisis_nuevo_sin_nada_en_la_app_da_todo_new_con_propuesta_de_crear()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var review = await ReviewAsync(client, snapshotId);

        var total = review.GetProperty("page").GetProperty("total").GetInt32();
        Assert.True(total >= 5);
        Assert.Equal(total, review.GetProperty("counts").GetProperty("new").GetInt32());
        Assert.All(review.GetProperty("items").EnumerateArray(), i =>
        {
            Assert.Equal("new", i.GetProperty("status").GetString());
            Assert.Equal("create", i.GetProperty("proposal").GetProperty("op").GetString());
            Assert.True(i.GetProperty("evidenceCount").GetInt32() >= 1);
        });
        Assert.False(review.TryGetProperty("previousSnapshotId", out _));
    }

    [Fact]
    public async Task Una_coincidencia_por_firma_propone_vincular_sin_vincular()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Consultar pedido", http: Http("GET", "/api/pedidos/{pedidoId}"));
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var item = ItemOf(await ReviewAsync(client, snapshotId), Get);

        Assert.Equal("matched", item.GetProperty("status").GetString());
        Assert.Equal("signature", item.GetProperty("match").GetProperty("reason").GetString());
        Assert.Equal(itemId, item.GetProperty("match").GetProperty("target").GetProperty("id").GetGuid());
        Assert.Equal("link", item.GetProperty("proposal").GetProperty("op").GetString());
        Assert.False(item.TryGetProperty("binding", out _));
        await AssertBindingsAsync(appId, 0);
    }

    [Fact]
    public async Task Varias_coincidencias_por_firma_no_eligen_ninguna_y_las_muestran_como_candidatas()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var first = await CatalogAsync(client, appId, "api", "Pedido v1", http: Http("GET", "/api/pedidos/{id}"));
        var second = await CatalogAsync(client, appId, "api", "Pedido v2", http: Http("GET", "/api/pedidos/{pedidoId}/"));
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var item = ItemOf(await ReviewAsync(client, snapshotId), Get);

        Assert.Equal("new", item.GetProperty("status").GetString());
        Assert.Equal("none", item.GetProperty("proposal").GetProperty("op").GetString());
        Assert.False(item.TryGetProperty("match", out _));
        var candidates = item.GetProperty("candidates").EnumerateArray().ToList();
        Assert.Equal([first, second], candidates.Select(c => c.GetProperty("target").GetProperty("id").GetGuid()).Order());
        Assert.All(candidates, c => Assert.Equal("signature", c.GetProperty("reason").GetString()));
    }

    [Fact]
    public async Task Una_coincidencia_por_titulo_es_solo_una_sugerencia_y_respeta_el_tipo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var service = await CatalogAsync(client, appId, "service", "  tienda.API ");
        await CatalogAsync(client, appId, "database", "Tienda.Api"); // mismo título, otro tipo: no cuenta
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var item = ItemOf(await ReviewAsync(client, snapshotId), Service);

        Assert.Equal("matched", item.GetProperty("status").GetString());
        Assert.Equal("title", item.GetProperty("match").GetProperty("reason").GetString());
        Assert.Equal(service, item.GetProperty("match").GetProperty("target").GetProperty("id").GetGuid());
        await AssertBindingsAsync(appId, 0);
    }

    [Fact]
    public async Task Nunca_se_sugiere_un_elemento_de_otra_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var otherApp = await CreateAppAsync(client);
        var foreign = await CatalogAsync(client, otherApp, "api", "Consultar pedido", http: Http("GET", "/api/pedidos/{id}"));
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        Assert.Equal("new", ItemOf(await ReviewAsync(client, snapshotId), Get).GetProperty("status").GetString());

        var response = await ApplyAsync(client, snapshotId, Link(Get, "catalogItem", foreign, 0));
        Assert.Equal("No existe en esta app.", Error(await JsonAsync(response, HttpStatusCode.BadRequest), "/operations/0/target/id"));
    }

    [Fact]
    public async Task Vincular_guarda_la_decision_no_cambia_el_elemento_y_se_reconoce_en_el_analisis_siguiente()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Consultar pedido", http: Http("GET", "/api/pedidos/{id}"));
        var before = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/catalog/{itemId}", UriKind.Relative));
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));

        var result = await JsonAsync(await ApplyAsync(client, first, Link(Get, "catalogItem", itemId, 0)), HttpStatusCode.OK);

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryApplyResult, result));
        Assert.Equal("completed", result.GetProperty("status").GetString());
        Assert.Equal(itemId, result.GetProperty("linked")[0].GetProperty("target").GetProperty("id").GetGuid());
        Assert.Contains(result.GetProperty("unchanged").EnumerateArray(), t => t.GetProperty("id").GetGuid() == itemId);
        var linked = ItemOf(await ReviewAsync(client, first), Get);
        Assert.Equal("linked", linked.GetProperty("status").GetString());
        Assert.Equal(1, linked.GetProperty("binding").GetProperty("version").GetInt32());
        Assert.True(JsonElement.DeepEquals(before, await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/catalog/{itemId}", UriKind.Relative))));

        // Otro análisis de la misma fuente (con una API más): el vínculo sigue.
        var second = await UploadSnapshotAsync(client, appId, Pack(extraEndpoint: true, extra: ["--source-id", WalkieSource.ToString()]));
        var review = await ReviewAsync(client, second);
        Assert.Equal(first, review.GetProperty("previousSnapshotId").GetGuid());
        Assert.Equal("linked", ItemOf(review, Get).GetProperty("status").GetString());
        Assert.Equal("new", ItemOf(review, "api:DELETE /api/pedidos/{}").GetProperty("status").GetString());
    }

    [Theory]
    [InlineData("otro-tipo-del-catalogo", "/operations/0/target/id")]
    [InlineData("modulo-para-una-api", "/operations/0/target/kind")]
    [InlineData("destino-inexistente", "/operations/0/target/id")]
    [InlineData("hallazgo-que-no-esta", "/operations/0/entityKey")]
    [InlineData("crear-todavia-no", "/operations/0/op")]
    [InlineData("misma-clave-dos-veces", "/operations/1/entityKey")]
    [InlineData("restablecer-sin-decision", "/operations/0/entityKey")]
    [InlineData("schema", "/operations/0")]
    public async Task Una_operacion_invalida_responde_400_con_su_ruta_y_no_guarda_nada(string variant, string path)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var database = await CatalogAsync(client, appId, "database", "Ventas");
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        JsonObject[] operations = variant switch
        {
            "otro-tipo-del-catalogo" => [Link(Get, "catalogItem", database, 0)],
            "modulo-para-una-api" => [Link(Get, "module", database, 0)],
            "destino-inexistente" => [Link(Get, "catalogItem", Guid.NewGuid(), 0)],
            "hallazgo-que-no-esta" => [Op("reject", "api:GET /no-existe")],
            "crear-todavia-no" => [new JsonObject { ["op"] = "create", ["entityKey"] = Get, ["id"] = Guid.CreateVersion7().ToString() }],
            "misma-clave-dos-veces" => [Op("reject", Get), Op("reject", Get)],
            "restablecer-sin-decision" => [Op("reset", Get)],
            "schema" => [new JsonObject { ["op"] = "link", ["entityKey"] = Get }], // link sin target
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, null),
        };

        var problem = await JsonAsync(await ApplyAsync(client, snapshotId, operations), HttpStatusCode.BadRequest);

        Assert.True(problem.GetProperty("errors").TryGetProperty(path, out _), problem.ToString());
        await AssertBindingsAsync(appId, 0);
    }

    [Fact]
    public async Task Rechazar_persiste_entre_analisis_y_restablecer_lo_devuelve_a_new()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        await JsonAsync(await ApplyAsync(client, first, Op("reject", Post, 0, note: "Es interna, no se documenta.")), HttpStatusCode.OK);
        var second = await UploadSnapshotAsync(client, appId, Pack(extraEndpoint: true, extra: ["--source-id", WalkieSource.ToString()]));

        var rejected = ItemOf(await ReviewAsync(client, second), Post);
        Assert.Equal("rejected", rejected.GetProperty("status").GetString());
        Assert.Equal("Es interna, no se documenta.", rejected.GetProperty("binding").GetProperty("note").GetString());
        Assert.Equal("none", rejected.GetProperty("proposal").GetProperty("op").GetString());

        var reset = await JsonAsync(await ApplyAsync(client, second, Op("reset", Post, 1)), HttpStatusCode.OK);
        Assert.Equal([Post], reset.GetProperty("reset").EnumerateArray().Select(k => k.GetString()));
        var back = ItemOf(await ReviewAsync(client, second), Post);
        Assert.Equal("new", back.GetProperty("status").GetString());
        Assert.False(back.TryGetProperty("binding", out _));

        // La versión no vuelve atrás: decidir otra vez empieza de «sin vínculo» (0) y queda en la 3.
        await JsonAsync(await ApplyAsync(client, second, Op("reject", Post, 0)), HttpStatusCode.OK);
        Assert.Equal(3, ItemOf(await ReviewAsync(client, second), Post).GetProperty("binding").GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Si_cambia_el_fingerprint_de_algo_decidido_queda_changed_sin_tocar_la_decision()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Consultar pedido");
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        await JsonAsync(await ApplyAsync(client, first, Link(Get, "catalogItem", itemId, 0)), HttpStatusCode.OK);

        // El parámetro cambia de nombre: misma clave, otro contrato.
        var second = await UploadSnapshotAsync(client, appId, Pack(parameter: "pedidoId", extra: ["--source-id", WalkieSource.ToString()]));
        var item = ItemOf(await ReviewAsync(client, second), Get);

        Assert.Equal("changed", item.GetProperty("status").GetString());
        Assert.Equal("linked", item.GetProperty("binding").GetProperty("decision").GetString());
        Assert.Equal(1, item.GetProperty("binding").GetProperty("version").GetInt32());
        Assert.NotEqual(item.GetProperty("fingerprint").GetString(), item.GetProperty("binding").GetProperty("entityFingerprint").GetString());
        Assert.Equal(1, (await ReviewAsync(client, second)).GetProperty("counts").GetProperty("changed").GetInt32());
    }

    [Fact]
    public async Task Algo_vinculado_que_ya_no_aparece_en_un_analisis_completo_queda_missing_y_no_se_borra()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "database", "Base de la tienda");
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        await JsonAsync(await ApplyAsync(client, first, Link(Db, "catalogItem", itemId, 0)), HttpStatusCode.OK);

        var withoutDb = Pack(withDatabase: false, extra: ["--source-id", WalkieSource.ToString()]);
        Assert.Equal("complete", Open(withoutDb).Manifest["completeness"]!.GetValue<string>());
        var second = await UploadSnapshotAsync(client, appId, withoutDb);
        var review = await ReviewAsync(client, second, "status=missing");

        var missing = Assert.Single(review.GetProperty("items").EnumerateArray());
        Assert.Equal(Db, missing.GetProperty("key").GetString());
        Assert.Equal(itemId, missing.GetProperty("binding").GetProperty("target").GetProperty("id").GetGuid());
        Assert.Equal("none", missing.GetProperty("proposal").GetProperty("op").GetString());
        Assert.True(missing.GetProperty("evidenceCount").GetInt32() >= 1);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/catalog/{itemId}", UriKind.Relative))).StatusCode);
    }

    [Theory]
    [InlineData("detector-sin-correr")]
    [InlineData("detector-que-fallo")]
    [InlineData("limitacion-en-su-archivo")]
    [InlineData("fuera-del-alcance")]
    [InlineData("analisis-cortado")]
    public async Task Sin_evidencia_suficiente_no_se_da_nada_por_desaparecido(string variant)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "database", "Base de la tienda");
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        await JsonAsync(await ApplyAsync(client, first, Link(Db, "catalogItem", itemId, 0)), HttpStatusCode.OK);

        var without = variant == "detector-sin-correr"
            ? Pack(withDatabase: false, extra: ["--source-id", WalkieSource.ToString(), "--detectors", "csproj,aspnetcore-endpoints"])
            : Alter(Pack(withDatabase: false, extra: ["--source-id", WalkieSource.ToString()]), (manifest, _) =>
            {
                manifest["completeness"] = "partial";
                var compose = manifest["detectors"]!.AsArray().First(d => d!["id"]!.GetValue<string>() == "compose")!;
                switch (variant)
                {
                    case "detector-que-fallo":
                        compose["status"] = "failed";
                        compose["reason"] = "Se cortó por tiempo.";
                        break;
                    case "limitacion-en-su-archivo":
                        manifest["limitations"]!.AsArray().Add(new JsonObject { ["code"] = "unparsed-file", ["message"] = "YAML inválido.", ["detector"] = "compose", ["path"] = "docker-compose.yml" });
                        break;
                    case "fuera-del-alcance":
                        manifest["scope"]!["include"] = new JsonArray("src/**");
                        break;
                    case "analisis-cortado":
                        manifest["limitations"]!.AsArray().Add(new JsonObject { ["code"] = "file-limit", ["message"] = "Se alcanzó el límite de archivos." });
                        break;
                }
            });
        var second = await UploadSnapshotAsync(client, appId, without);
        var review = await ReviewAsync(client, second);

        Assert.Equal(0, review.GetProperty("counts").GetProperty("missing").GetInt32());
        Assert.DoesNotContain(review.GetProperty("items").EnumerateArray(), i => i.GetProperty("key").GetString() == Db);
    }

    [Fact]
    public async Task La_paginacion_es_estable_y_cubre_todo_con_filtros_en_la_base()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack(extraEndpoint: true));
        var all = await ReviewAsync(client, snapshotId, "pageSize=500");
        var expected = all.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()).ToList();

        var paged = new List<string?>();
        for (var page = 0; page * 2 < expected.Count; page++)
        {
            var review = await ReviewAsync(client, snapshotId, $"page={page}&pageSize=2");
            Assert.Equal(expected.Count, review.GetProperty("page").GetProperty("total").GetInt32());
            paged.AddRange(review.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()));
        }

        Assert.Equal(expected, paged);
        Assert.Equal(expected, (await ReviewAsync(client, snapshotId, "pageSize=500")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()));
        var apis = await ReviewAsync(client, snapshotId, "kind=api");
        Assert.All(apis.GetProperty("items").EnumerateArray(), i => Assert.Equal("api", i.GetProperty("kind").GetString()));
        Assert.Equal(all.GetProperty("counts").ToString(), apis.GetProperty("counts").ToString()); // los conteos son del análisis completo
        Assert.Empty((await ReviewAsync(client, snapshotId, "page=99")).GetProperty("items").EnumerateArray());

        foreach (var bad in new[] { "kind=pantalla", "status=raro", "page=-1", "pageSize=0", "pageSize=501" })
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?{bad}", UriKind.Relative))).StatusCode);
        }
    }

    // ---------- Concurrencia e idempotencia ----------

    [Fact]
    public async Task Una_bindingVersion_vieja_responde_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        await JsonAsync(await ApplyAsync(client, snapshotId, Op("reject", Get, 0)), HttpStatusCode.OK);

        var problem = await JsonAsync(await ApplyAsync(client, snapshotId, Op("reject", Get, 0)), HttpStatusCode.Conflict);

        Assert.Contains("está en la 1", Error(problem, "/operations/0/bindingVersion"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Repetir_el_mismo_applyId_devuelve_el_mismo_resultado_y_con_otra_solicitud_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        var applyId = Guid.CreateVersion7();

        var first = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, Op("reject", Get, 0)), HttpStatusCode.OK);
        var again = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, Op("reject", Get, 0)), HttpStatusCode.OK);
        var other = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, Op("reject", Post, 0)), HttpStatusCode.Conflict);

        Assert.True(JsonElement.DeepEquals(first, again));
        Assert.Contains("ya se usó con otra solicitud", Error(other, "applyId"), StringComparison.Ordinal);
        Assert.Equal(1, ItemOf(await ReviewAsync(client, snapshotId), Get).GetProperty("binding").GetProperty("version").GetInt32());
        await AssertBindingsAsync(appId, 1);
    }

    [Fact]
    public async Task Decisiones_simultaneas_sobre_el_mismo_hallazgo_dejan_una_sola_y_el_resto_recibe_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Consultar pedido");
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(i =>
            ApplyAsync(client, snapshotId, i % 2 == 0 ? Link(Get, "catalogItem", itemId, 0) : Op("reject", Get, 0))));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        Assert.Equal(1, ItemOf(await ReviewAsync(client, snapshotId), Get).GetProperty("binding").GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Un_destino_ya_vinculado_a_otro_hallazgo_no_se_propone_ni_se_puede_vincular_otra_vez()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Pedidos");
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        await JsonAsync(await ApplyAsync(client, snapshotId, Link(Get, "catalogItem", itemId, 0)), HttpStatusCode.OK);

        var problem = await JsonAsync(await ApplyAsync(client, snapshotId, Link(Post, "catalogItem", itemId, 0)), HttpStatusCode.Conflict);

        Assert.Contains(Get, Error(problem, "/operations/0/target/id"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Decidir_sobre_un_analisis_que_no_es_el_ultimo_de_la_fuente_responde_409()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        await UploadSnapshotAsync(client, appId, Pack(extraEndpoint: true, extra: ["--source-id", WalkieSource.ToString()]));

        var problem = await JsonAsync(await ApplyAsync(client, first, Op("reject", Get, 0)), HttpStatusCode.Conflict);

        Assert.Contains("más nuevo", Error(problem, "snapshotId"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Con_dryRun_la_vista_previa_no_guarda_decisiones_ni_bitacora()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Pedidos");
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: true, Link(Get, "catalogItem", itemId, 0), Op("reject", Post, 0)), HttpStatusCode.OK);

        Assert.Equal("planned", preview.GetProperty("status").GetString());
        Assert.True(preview.GetProperty("dryRun").GetBoolean());
        Assert.Equal([Post], preview.GetProperty("rejected").EnumerateArray().Select(k => k.GetString()));
        await AssertBindingsAsync(appId, 0);
        await using var scope = factory.Services.CreateAsyncScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>().Applies.AnyAsync(a => a.AppId == appId));
    }

    // ---------- Fuentes ----------

    [Fact]
    public async Task Las_fuentes_de_una_app_traen_su_ultimo_analisis_y_nunca_las_de_otra_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var otherApp = await CreateAppAsync(client);
        await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        var latest = await UploadSnapshotAsync(client, appId, Pack(extraEndpoint: true, extra: ["--source-id", WalkieSource.ToString()]));
        await UploadSnapshotAsync(client, appId, Pack());
        await UploadSnapshotAsync(client, otherApp, Pack());

        var sources = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/sources", UriKind.Relative)), HttpStatusCode.OK);

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoverySources, sources));
        var list = sources.GetProperty("sources").EnumerateArray().ToList();
        Assert.Equal(2, list.Count);
        var walkie = list.Single(s => s.GetProperty("source").GetProperty("id").GetGuid() == WalkieSource);
        Assert.Equal(2, walkie.GetProperty("snapshotCount").GetInt32());
        Assert.Equal(latest, walkie.GetProperty("latestSnapshot").GetProperty("id").GetGuid());
        Assert.All(list, s => Assert.Equal(appId, s.GetProperty("latestSnapshot").GetProperty("appId").GetGuid()));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/apps/{Guid.NewGuid()}/sources", UriKind.Relative))).StatusCode);
    }

    // ---------- Seguridad y compatibilidad ----------

    [Fact]
    public async Task Sin_sesion_401_y_con_Discovery_apagado_404_en_revision_decisiones_y_fuentes()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());
        using var anonymous = factory.CreateClient();
        using var disabled = factory.WithWebHostBuilder(b => b.UseSetting("Discovery:Enabled", "false"));
        using var off = disabled.CreateClient();
        off.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken());

        foreach (var (http, expected) in new[] { (anonymous, HttpStatusCode.Unauthorized), (off, HttpStatusCode.NotFound) })
        {
            Assert.Equal(expected, (await http.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review", UriKind.Relative))).StatusCode);
            Assert.Equal(expected, (await ApplyAsync(http, snapshotId, Op("reject", Get, 0))).StatusCode);
            Assert.Equal(expected, (await http.GetAsync(new Uri($"/api/apps/{appId}/sources", UriKind.Relative))).StatusCode);
            Assert.Equal(expected, (await http.GetAsync(EvidenceUri(snapshotId, Get))).StatusCode);
        }

        await AssertBindingsAsync(appId, 0);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/snapshots/{Guid.NewGuid()}/review", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Vincular_rechazar_y_restablecer_no_tocan_catalogo_lienzos_modulos_features_ni_tours()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "api", "Consultar pedido", http: Http("GET", "/api/pedidos/{id}"));
        var moduleId = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative),
            new { id = moduleId, name = "Pedidos" })).StatusCode);
        var featureId = await FeatureWithCanvasAsync(client, appId, itemId);
        var before = await StateAsync(client, appId, featureId, moduleId);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        await JsonAsync(await ApplyAsync(client, snapshotId, Link(Get, "catalogItem", itemId, 0), Op("reject", Db, 0)), HttpStatusCode.OK);
        await JsonAsync(await ApplyAsync(client, snapshotId, Op("reset", Get, 1)), HttpStatusCode.OK);

        var after = await StateAsync(client, appId, featureId, moduleId);
        Assert.True(JsonElement.DeepEquals(before, after), $"Antes: {before}\nDespués: {after}");
    }

    // ---------- Evidencia de un hallazgo ----------

    [Fact]
    public async Task La_evidencia_de_un_hallazgo_es_la_que_cita_con_sus_relaciones_y_nada_mas()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var pack = Pack();
        var snapshotId = await UploadSnapshotAsync(client, appId, pack);
        var (_, discovery) = Open(pack);
        var entity = discovery["entities"]!.AsArray().Single(e => e!["key"]!.GetValue<string>() == Get)!;
        var cited = entity["evidence"]!.AsArray().Select(e => e!.GetValue<string>()).ToHashSet();

        var evidence = await JsonAsync(await client.GetAsync(EvidenceUri(snapshotId, Get)), HttpStatusCode.OK);

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryEvidence, evidence));
        Assert.Equal(snapshotId, evidence.GetProperty("foundIn").GetGuid());
        Assert.Equal(cited, evidence.GetProperty("evidence").EnumerateArray().Select(e => e.GetProperty("id").GetString()!).ToHashSet());
        Assert.All(evidence.GetProperty("evidence").EnumerateArray(), e => Assert.Equal("src/Tienda.Api/Program.cs", e.GetProperty("path").GetString()));
        Assert.All(evidence.GetProperty("relations").EnumerateArray(), r =>
            Assert.True(r.GetProperty("from").GetString() == Get || r.GetProperty("to").GetString() == Get));
        Assert.NotEmpty(evidence.GetProperty("relations").EnumerateArray());
    }

    [Fact]
    public async Task La_evidencia_de_algo_que_ya_no_aparece_viene_del_analisis_anterior()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var itemId = await CatalogAsync(client, appId, "database", "Base de la tienda");
        var first = await UploadSnapshotAsync(client, appId, Pack(extra: ["--source-id", WalkieSource.ToString()]));
        await JsonAsync(await ApplyAsync(client, first, Link(Db, "catalogItem", itemId, 0)), HttpStatusCode.OK);
        var second = await UploadSnapshotAsync(client, appId, Pack(withDatabase: false, extra: ["--source-id", WalkieSource.ToString()]));

        var evidence = await JsonAsync(await client.GetAsync(EvidenceUri(second, Db)), HttpStatusCode.OK);

        Assert.Equal(second, evidence.GetProperty("snapshotId").GetGuid());
        Assert.Equal(first, evidence.GetProperty("foundIn").GetGuid());
        Assert.Equal("docker-compose.yml", evidence.GetProperty("evidence")[0].GetProperty("path").GetString());
    }

    [Fact]
    public async Task Pedir_evidencia_sin_clave_400_y_de_algo_que_no_esta_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadSnapshotAsync(client, appId, Pack());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/evidence", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(EvidenceUri(snapshotId, "api:GET /no-existe"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(EvidenceUri(Guid.NewGuid(), Get))).StatusCode);
    }

    private static Uri EvidenceUri(Guid snapshotId, string key) =>
        new($"/api/snapshots/{snapshotId}/evidence?entityKey={Uri.EscapeDataString(key)}", UriKind.Relative);

    [Fact]
    public async Task Los_endpoints_aparecen_en_OpenAPI()
    {
        using var client = factory.CreateClient();

        var document = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("/api/snapshots/{snapshotId}/review", document, StringComparison.Ordinal);
        Assert.Contains("/api/snapshots/{snapshotId}/apply", document, StringComparison.Ordinal);
        Assert.Contains("/api/apps/{appId}/sources", document, StringComparison.Ordinal);
        Assert.Contains("/api/snapshots/{snapshotId}/evidence", document, StringComparison.Ordinal);
    }

    // ---------- Ayudas ----------

    /// <summary>El proyecto ficticio de las pruebas, con variaciones para un segundo análisis de la misma fuente.</summary>
    private static byte[] Pack(bool extraEndpoint = false, bool withDatabase = true, string parameter = "id", string[]? extra = null) =>
        Scan(new Dictionary<string, string>
        {
            ["src/Tienda.Api/Tienda.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
            ["src/Tienda.Api/Program.cs"] =
                "var app = WebApplication.CreateBuilder(args).Build();\nvar pedidos = app.MapGroup(\"/api/pedidos\");\n"
                + $"pedidos.MapGet(\"/{{{parameter}:guid}}\", (Guid {parameter}) => 1);\npedidos.MapPost(\"/\", () => 1);\n"
                + (extraEndpoint ? "pedidos.MapDelete(\"/{id:guid}\", (Guid id) => 1);\n" : "")
                + "app.Run();\n",
            ["docker-compose.yml"] = withDatabase
                ? "services:\n  api:\n    build: ./src/Tienda.Api\n    depends_on: [db, cache]\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_DB: tienda\n  cache:\n    image: redis:7\n"
                : "services:\n  api:\n    build: ./src/Tienda.Api\n    depends_on: [cache]\n  cache:\n    image: redis:7\n",
        }, extra ?? []);



    private static async Task<Guid> UploadSnapshotAsync(HttpClient client, Guid appId, byte[] pack)
    {
        var response = await UploadAsync(client, appId, pack);
        var body = await JsonAsync(response, HttpStatusCode.Created);
        return body.GetProperty("snapshot").GetProperty("id").GetGuid();
    }

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId, string query = "")
    {
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?{query}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryReview, review));
        return review;
    }

    private static JsonElement ItemOf(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, params JsonObject[] operations) =>
        ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun: false, operations);

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, Guid applyId, params JsonObject[] operations) =>
        ApplyAsync(client, snapshotId, applyId, dryRun: false, operations);

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, Guid applyId, bool dryRun, params JsonObject[] operations)
    {
        var body = new JsonObject { ["applyId"] = applyId.ToString(), ["operations"] = new JsonArray([.. operations.Select(o => (JsonNode)o.DeepClone())]) };
        return client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative), body);
    }

    private static JsonObject Op(string op, string key, int? version = null, string? note = null)
    {
        var operation = new JsonObject { ["op"] = op, ["entityKey"] = key };
        if (version is { } v)
        {
            operation["bindingVersion"] = v;
        }

        if (note is not null)
        {
            operation["note"] = note;
        }

        return operation;
    }

    private static JsonObject Link(string key, string kind, Guid id, int version) =>
        new() { ["op"] = "link", ["entityKey"] = key, ["target"] = new JsonObject { ["kind"] = kind, ["id"] = id.ToString() }, ["bindingVersion"] = version };

    private static string Error(JsonElement problem, string path) =>
        string.Join(" ", problem.GetProperty("errors").GetProperty(path).EnumerateArray().Select(m => m.GetString()));

    private static JsonElement Http(string method, string path) => TestJson.Http(method, path);

    private static async Task<Guid> CatalogAsync(HttpClient client, Guid appId, string type, string title, JsonElement? http = null)
    {
        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
            new CreateCatalogItemRequest(type, title, null, http));
        var body = await JsonAsync(response, HttpStatusCode.Created);
        return body.GetProperty("id").GetGuid();
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
                ["r1"] = new JsonObject { ["id"] = "r1", ["type"] = "ref", ["title"] = "Consultar pedido", ["catalogId"] = itemId.ToString() },
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

    /// <summary>Todo lo que Discovery no debe tocar: catálogo, features, módulos y lienzos (con sus tours).</summary>
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

    private async Task AssertBindingsAsync(Guid appId, int expected)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.Equal(expected, await db.Bindings.CountAsync(b => b.AppId == appId && b.Decision != null));
    }
}
