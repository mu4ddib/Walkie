using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Features;
using Walkie.Modules.Apps.Persistence;
using Walkie.Modules.Canvas.Persistence;
using Walkie.Modules.Discovery.Features;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Modules.Files.Persistence;
using Walkie.Modules.Files.Storage;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Modules.Sharing.Persistence;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Eliminar features y apps (spec eliminar-apps-y-features, ADR-0017): impacto, bloqueos, autorización, limpieza en cada
/// módulo (y en S3) sin tocar lo de otras features ni otras apps, Walkie Live, reintentos, fallos a mitad con
/// recuperación y concurrencia. Cada prueba crea sus propias apps.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DeletionTests(WalkieApiFactory factory)
{
    // ---------- Feature ----------

    [Fact]
    public async Task Una_feature_vacia_se_elimina_y_desaparece()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Vacía");
        var feature = await FeatureAsync(client, app, "Sin lienzo");

        var impact = await ImpactAsync(client, $"/api/features/{feature}/deletion");
        Assert.Equal("Sin lienzo", impact.GetProperty("name").GetString());
        Assert.False(impact.GetProperty("reversible").GetBoolean());
        Assert.Equal(0, impact.GetProperty("canvasVersion").GetInt32());
        Assert.Empty(impact.GetProperty("blockers").EnumerateArray());

        var deletionId = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteFeatureAsync(client, feature, deletionId, 0)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/features/{feature}/canvas", UriKind.Relative))).StatusCode);
        Assert.Empty((await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{app}/features", UriKind.Relative)), HttpStatusCode.OK)).EnumerateArray());
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.Id == feature)));

        // Reintento con el mismo id: la feature ya no existe (404); el estado lo da la bitácora, solo a quien la pidió.
        Assert.Equal(HttpStatusCode.NotFound, (await DeleteFeatureAsync(client, feature, deletionId, 0)).StatusCode);
        var status = await JsonAsync(await client.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Deletion, status));
        Assert.Equal("completed", status.GetProperty("status").GetString());
        using var other = await Members.PersonAsync(factory, "curioso-" + Suffix());
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Una_feature_completa_se_lleva_lo_suyo_y_deja_intacto_lo_compartido_y_lo_ajeno()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Completa");
        var target = await FeatureAsync(client, app, "Pedidos");
        var neighbour = await FeatureAsync(client, app, "Clientes");
        var item = await ItemAsync(client, app);
        var exclusive = await AssetAsync(client, app);
        var shared = await AssetAsync(client, app);

        // El lienzo de la feature: 2 pantallas con imagen (una exclusiva, otra compartida), una referencia al catálogo,
        // conexiones, un tour y un recorrido. El de la vecina usa la imagen compartida.
        await PutCanvasAsync(client, target, Graph(exclusive, shared, item));
        await PutCanvasAsync(client, neighbour, Graph(null, shared, item, prefix: "v"));
        var neighbourBefore = await JsonAsync(await client.GetAsync(new Uri($"/api/features/{neighbour}/canvas", UriKind.Relative)), HttpStatusCode.OK);
        var share = await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/features/{target}/shares", UriKind.Relative), new CreateShareRequest(7)), HttpStatusCode.Created);
        var token = share.GetProperty("token").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/public/shares/{token}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/apps/{app}/map/layout", UriKind.Relative),
            new { version = 0, positions = new Dictionary<string, object> { [target.ToString()] = new { x = 0, y = 0 }, [neighbour.ToString()] = new { x = 400, y = 0 } } })).StatusCode);
        var storageKeys = await FilesAsync(db => db.Assets.Where(a => a.Id == exclusive || a.Id == shared).ToDictionaryAsync(a => a.Id, a => a.StorageKey));

        var impact = await ImpactAsync(client, $"/api/features/{target}/deletion");
        var counts = impact.GetProperty("counts");
        Assert.Equal(3, counts.GetProperty("nodes").GetInt32());
        Assert.Equal(2, counts.GetProperty("edges").GetInt32());
        Assert.Equal(1, counts.GetProperty("tours").GetInt32());
        Assert.Equal(1, counts.GetProperty("flows").GetInt32());
        Assert.Equal(1, counts.GetProperty("shares").GetInt32());
        Assert.Equal(1, counts.GetProperty("images").GetInt32());
        Assert.Equal(1, counts.GetProperty("imagesShared").GetInt32());
        Assert.Equal(1, counts.GetProperty("mapPosition").GetInt32());

        var version = impact.GetProperty("canvasVersion").GetInt32();
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteFeatureAsync(client, target, Guid.CreateVersion7(), version)).StatusCode);

        // Lo suyo: enlace, lienzo, imagen exclusiva (fila y bytes) y posición en el mapa.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/public/shares/{token}", UriKind.Relative))).StatusCode);
        Assert.False(await SharingAsync(db => db.Shares.AnyAsync(s => s.FeatureId == target)));
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == target)));
        Assert.False(await FilesAsync(db => db.Assets.AnyAsync(a => a.Id == exclusive)));
        Assert.Null(await ObjectAsync(storageKeys[exclusive]));
        var map = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{app}/map", UriKind.Relative)), HttpStatusCode.OK);
        Assert.False(map.GetProperty("layout").GetProperty("positions").TryGetProperty(target.ToString(), out _));
        Assert.True(map.GetProperty("layout").GetProperty("positions").TryGetProperty(neighbour.ToString(), out _));

        // Lo compartido y lo ajeno: la imagen de la vecina, el catálogo y el lienzo de la vecina, idénticos.
        Assert.True(await FilesAsync(db => db.Assets.AnyAsync(a => a.Id == shared)));
        Assert.NotNull(await ObjectAsync(storageKeys[shared]));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/catalog/{item}", UriKind.Relative))).StatusCode);
        var neighbourAfter = await JsonAsync(await client.GetAsync(new Uri($"/api/features/{neighbour}/canvas", UriKind.Relative)), HttpStatusCode.OK);
        Assert.True(JsonElement.DeepEquals(neighbourBefore, neighbourAfter));
    }

    [Fact]
    public async Task Una_feature_con_portales_hacia_ella_no_se_elimina_y_dice_cuales()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Portales");
        var target = await FeatureAsync(client, app, "Destino");
        var source = await FeatureAsync(client, app, "Origen");
        var portal = Guid.CreateVersion7().ToString();
        await PutCanvasAsync(client, source, new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0,
            ["nodes"] = new JsonObject { [portal] = new JsonObject { ["id"] = portal, ["type"] = "portal", ["title"] = "Ir", ["targetFeatureId"] = target.ToString() } },
            ["edges"] = new JsonObject(),
            ["layout"] = new JsonObject { [portal] = new JsonObject { ["x"] = 0, ["y"] = 0 } },
        });

        var impact = await ImpactAsync(client, $"/api/features/{target}/deletion");
        var blocker = Assert.Single(impact.GetProperty("blockers").EnumerateArray());
        Assert.Equal("portal", blocker.GetProperty("code").GetString());
        Assert.Equal("Origen", Assert.Single(blocker.GetProperty("references").EnumerateArray()).GetProperty("name").GetString());

        var response = await DeleteFeatureAsync(client, target, Guid.CreateVersion7(), 0);
        var problem = await JsonAsync(response, HttpStatusCode.Conflict);
        Assert.Equal("portal", problem.GetProperty("impact").GetProperty("blockers")[0].GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/features/{target}/canvas", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Un_modulo_no_se_elimina_como_feature()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Módulo");
        var module = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(new Uri($"/api/apps/{app}/modules", UriKind.Relative), new { id = module, name = "Pagos" })).StatusCode);
        var problem = await JsonAsync(await DeleteFeatureAsync(client, module, Guid.CreateVersion7(), 0), HttpStatusCode.Conflict);
        Assert.Equal("module", problem.GetProperty("impact").GetProperty("blockers")[0].GetProperty("code").GetString());
    }

    [Fact]
    public async Task Si_alguien_guardo_despues_del_resumen_no_se_elimina()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Edición concurrente");
        var feature = await FeatureAsync(client, app, "Viva");
        await PutCanvasAsync(client, feature, Graph(null, null, null));
        var seen = (await ImpactAsync(client, $"/api/features/{feature}/deletion")).GetProperty("canvasVersion").GetInt32();
        await PutCanvasAsync(client, feature, Graph(null, null, null, prefix: "otra"), seen);

        var problem = await JsonAsync(await DeleteFeatureAsync(client, feature, Guid.CreateVersion7(), seen), HttpStatusCode.Conflict);
        Assert.Contains("cambió", problem.GetProperty("title").GetString(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/features/{feature}/canvas", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Solo_el_owner_elimina_y_nadie_de_fuera_sabe_que_existe()
    {
        using var owner = factory.CreateAuthenticatedClient();
        var app = await AppAsync(owner, "Permisos");
        var feature = await FeatureAsync(owner, app, "Protegida");
        var suffix = Suffix();
        using var viewer = await Members.PersonAsync(factory, "viewer-" + suffix);
        using var editor = await Members.PersonAsync(factory, "editor-" + suffix);
        using var stranger = await Members.PersonAsync(factory, "extraño-" + suffix);
        await Members.GrantAsync(owner, app, "viewer-" + suffix, "viewer");
        await Members.GrantAsync(owner, app, "editor-" + suffix, "editor");

        foreach (var (client, expected) in new[] { (viewer, HttpStatusCode.Forbidden), (editor, HttpStatusCode.Forbidden), (stranger, HttpStatusCode.NotFound) })
        {
            Assert.Equal(expected, (await client.GetAsync(new Uri($"/api/features/{feature}/deletion", UriKind.Relative))).StatusCode);
            Assert.Equal(expected, (await DeleteFeatureAsync(client, feature, Guid.CreateVersion7(), 0)).StatusCode);
            Assert.Equal(expected, (await client.GetAsync(new Uri($"/api/apps/{app}/deletion", UriKind.Relative))).StatusCode);
            Assert.Equal(expected, (await DeleteAppAsync(client, app, Guid.CreateVersion7(), "Permisos")).StatusCode);
        }

        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.DeleteAsync(new Uri($"/api/features/{feature}?deletionId={Guid.CreateVersion7()}&canvasVersion=0", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync(new Uri($"/api/features/{feature}/canvas", UriKind.Relative))).StatusCode);

        // Sin id de eliminación o sin versión: 400.
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.DeleteAsync(new Uri($"/api/features/{feature}?canvasVersion=0", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.DeleteAsync(new Uri($"/api/features/{feature}?deletionId={Guid.CreateVersion7()}", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Una_feature_de_Walkie_Live_se_elimina_sin_tocar_el_analisis_y_la_revision_lo_advierte()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Con procedencia");
        var feature = await FeatureAsync(client, app, "Pedidos a mano");
        var snapshotId = (await JsonAsync(await UploadAsync(client, app, Shop()), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        var link = new JsonObject
        {
            ["applyId"] = Guid.CreateVersion7().ToString(),
            ["operations"] = new JsonArray(new JsonObject
            {
                ["op"] = "link", ["entityKey"] = "feature:web:Pedidos", ["bindingVersion"] = 0,
                ["target"] = new JsonObject { ["kind"] = "feature", ["id"] = feature.ToString() },
            }),
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative), link)).StatusCode);
        var entitiesBefore = await DiscoveryAsync(db => db.Entities.CountAsync(e => e.SnapshotId == snapshotId));

        var impact = await ImpactAsync(client, $"/api/features/{feature}/deletion");
        Assert.Equal(1, impact.GetProperty("counts").GetProperty("provenance").GetInt32());
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteFeatureAsync(client, feature, Guid.CreateVersion7(), impact.GetProperty("canvasVersion").GetInt32())).StatusCode);

        // El análisis no cambió; el vínculo sigue, y la revisión dice que su destino ya no existe.
        Assert.Equal(entitiesBefore, await DiscoveryAsync(db => db.Entities.CountAsync(e => e.SnapshotId == snapshotId)));
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?kind=feature", UriKind.Relative)), HttpStatusCode.OK);
        var item = Assert.Single(review.GetProperty("items").EnumerateArray());
        Assert.True(item.GetProperty("targetMissing").GetBoolean());
        Assert.Equal("linked", item.GetProperty("binding").GetProperty("decision").GetString());

        // Una persona decide de nuevo (restablecer); nada se recreó solo.
        var reset = new JsonObject
        {
            ["applyId"] = Guid.CreateVersion7().ToString(),
            ["operations"] = new JsonArray(new JsonObject
            {
                ["op"] = "reset", ["entityKey"] = "feature:web:Pedidos", ["bindingVersion"] = item.GetProperty("binding").GetProperty("version").GetInt32(),
            }),
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative), reset)).StatusCode);
        Assert.Empty((await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{app}/features", UriKind.Relative)), HttpStatusCode.OK)).EnumerateArray());
    }

    [Fact]
    public async Task Un_fallo_a_mitad_de_una_feature_la_deja_inaccesible_y_la_recuperacion_la_termina()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Feature con fallo");
        var feature = await FeatureAsync(client, app, "Frágil");
        await PutCanvasAsync(client, feature, Graph(null, null, null));
        var version = (await ImpactAsync(client, $"/api/features/{feature}/deletion")).GetProperty("canvasVersion").GetInt32();

        var fail = true;
        using var faulty = WithCheckpoints((step, _) => fail && step == "canvas" ? throw new InvalidOperationException("caída simulada del lienzo") : Task.CompletedTask);
        using var failing = Authenticated(faulty);
        var deletionId = Guid.CreateVersion7();
        var pending = await JsonAsync(await DeleteFeatureAsync(failing, feature, deletionId, version), HttpStatusCode.Accepted);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Deletion, pending));
        Assert.Equal("pending", pending.GetProperty("status").GetString());
        Assert.Contains("canvas", pending.GetProperty("error").GetString(), StringComparison.Ordinal);
        // Ya no es accesible, aunque su lienzo siga en la base.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/features/{feature}/canvas", UriKind.Relative))).StatusCode);
        Assert.True(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == feature)));

        // La recuperación la retoma cuando vence la espera.
        fail = false;
        await ExpireLeaseAsync(deletionId);
        Assert.True(await DeletionRecovery.RecoverOnceAsync(faulty.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None) >= 1);
        var done = await JsonAsync(await client.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal("completed", done.GetProperty("status").GetString());
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == feature)));
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.Id == feature)));
    }

    // ---------- App ----------

    [Fact]
    public async Task Una_app_vacia_se_elimina_con_su_nombre_y_desaparece_para_todos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "Vacía para borrar " + Suffix();
        var app = await AppExactAsync(client, name);

        var impact = await ImpactAsync(client, $"/api/apps/{app}/deletion");
        Assert.Equal(name, impact.GetProperty("name").GetString());
        Assert.Equal(1, impact.GetProperty("counts").GetProperty("members").GetInt32());

        Assert.Equal(HttpStatusCode.BadRequest, (await DeleteAppAsync(client, app, Guid.CreateVersion7(), "otro nombre")).StatusCode);
        var deletionId = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAppAsync(client, app, deletionId, name)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
        Assert.DoesNotContain((await JsonAsync(await client.GetAsync(new Uri("/api/apps", UriKind.Relative)), HttpStatusCode.OK)).EnumerateArray(),
            a => a.GetProperty("id").GetGuid() == app);
        Assert.False(await AppsAsync(db => db.Apps.AnyAsync(a => a.Id == app)));
        // Reintento: 404 en la app; la bitácora dice que terminó.
        Assert.Equal(HttpStatusCode.NotFound, (await DeleteAppAsync(client, app, deletionId, name)).StatusCode);
        Assert.Equal("completed", (await JsonAsync(await client.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative)), HttpStatusCode.OK)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Una_app_completa_no_deja_huerfanos_en_ningun_modulo_ni_en_S3_y_otra_app_sigue_intacta()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "Completa para borrar " + Suffix();
        var app = await AppExactAsync(client, name);
        var keep = await AppAsync(client, "Otra que se queda");
        var keepFeature = await FeatureAsync(client, keep, "Intacta");
        var keepAsset = await AssetAsync(client, keep);
        await PutCanvasAsync(client, keepFeature, Graph(keepAsset, null, null));
        var keepCanvas = await JsonAsync(await client.GetAsync(new Uri($"/api/features/{keepFeature}/canvas", UriKind.Relative)), HttpStatusCode.OK);

        var item = await ItemAsync(client, app);
        var asset1 = await AssetAsync(client, app);
        var asset2 = await AssetAsync(client, app);
        var features = new[] { await FeatureAsync(client, app, "Uno"), await FeatureAsync(client, app, "Dos") };
        await PutCanvasAsync(client, features[0], Graph(asset1, asset2, item));
        await PutCanvasAsync(client, features[1], Graph(null, asset2, item, prefix: "b"));
        var module = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(new Uri($"/api/apps/{app}/modules", UriKind.Relative), new { id = module, name = "Pagos" })).StatusCode);
        var token = (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/features/{features[0]}/shares", UriKind.Relative), new CreateShareRequest(7)), HttpStatusCode.Created))
            .GetProperty("token").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/apps/{app}/map/layout", UriKind.Relative),
            new { version = 0, positions = new Dictionary<string, object> { [features[0].ToString()] = new { x = 0, y = 0 } } })).StatusCode);
        var memberSub = "miembro-" + Suffix();
        using var member = await Members.PersonAsync(factory, memberSub);
        await Members.GrantAsync(client, app, memberSub, "editor");
        var snapshotId = (await JsonAsync(await UploadAsync(client, app, Shop()), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        var reject = new JsonObject
        {
            ["applyId"] = Guid.CreateVersion7().ToString(),
            ["operations"] = new JsonArray(new JsonObject { ["op"] = "reject", ["entityKey"] = "api:GET /api/pedidos", ["bindingVersion"] = 0 }),
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative), reject)).StatusCode);
        var keys = await FilesAsync(db => db.Assets.Where(a => a.AppId == app).Select(a => a.StorageKey).ToListAsync());
        var keepKey = await FilesAsync(db => db.Assets.Where(a => a.Id == keepAsset).Select(a => a.StorageKey).SingleAsync());

        var impact = await ImpactAsync(client, $"/api/apps/{app}/deletion");
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DeletionImpact, impact));
        var counts = impact.GetProperty("counts");
        Assert.Equal(2, counts.GetProperty("features").GetInt32());
        Assert.Equal(1, counts.GetProperty("modules").GetInt32());
        Assert.Equal(1, counts.GetProperty("catalogItems").GetInt32());
        Assert.Equal(2, counts.GetProperty("members").GetInt32());
        Assert.Equal(2, counts.GetProperty("images").GetInt32());
        Assert.Equal(1, counts.GetProperty("shares").GetInt32());
        Assert.Equal(1, counts.GetProperty("snapshots").GetInt32());
        Assert.Equal(1, counts.GetProperty("decisions").GetInt32());
        Assert.Equal(1, counts.GetProperty("map").GetInt32());

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAppAsync(client, app, Guid.CreateVersion7(), name)).StatusCode);

        // Nadie la ve: ni el owner, ni el miembro, ni el enlace público.
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/features/{features[0]}/canvas", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/public/shares/{token}", UriKind.Relative))).StatusCode);

        // Ningún huérfano, módulo por módulo.
        var ids = features.Append(module).ToList();
        Assert.False(await AppsAsync(db => db.Apps.AnyAsync(a => a.Id == app)));
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.AppId == app)));
        Assert.False(await AppsAsync(db => db.CatalogItems.AnyAsync(i => i.AppId == app)));
        Assert.False(await AppsAsync(db => db.Memberships.AnyAsync(m => m.AppId == app)));
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => ids.Contains(c.FeatureId))));
        Assert.False(await CanvasAsync(db => db.AppMaps.AnyAsync(m => m.AppId == app)));
        Assert.False(await SharingAsync(db => db.Shares.AnyAsync(s => ids.Contains(s.FeatureId))));
        Assert.False(await FilesAsync(db => db.Assets.AnyAsync(a => a.AppId == app)));
        foreach (var key in keys)
        {
            Assert.Null(await ObjectAsync(key));
        }

        Assert.False(await DiscoveryAsync(db => db.Snapshots.AnyAsync(s => s.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Sources.AnyAsync(s => s.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Bindings.AnyAsync(b => b.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Applies.AnyAsync(a => a.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Entities.AnyAsync(e => e.SnapshotId == snapshotId)));
        Assert.False(await DiscoveryAsync(db => db.Evidence.AnyAsync(e => e.SnapshotId == snapshotId)));
        Assert.False(await DiscoveryAsync(db => db.Relations.AnyAsync(r => r.SnapshotId == snapshotId)));

        // La otra app, intacta (lienzo, imagen y bytes).
        Assert.True(JsonElement.DeepEquals(keepCanvas, await JsonAsync(await client.GetAsync(new Uri($"/api/features/{keepFeature}/canvas", UriKind.Relative)), HttpStatusCode.OK)));
        Assert.NotNull(await ObjectAsync(keepKey));
        // La bitácora queda como registro de lo borrado.
        Assert.True(await AppsAsync(db => db.Deletions.AnyAsync(d => d.AppId == app && d.Status == "completed")));
    }

    [Fact]
    public async Task Una_operacion_de_Walkie_Live_en_curso_bloquea_la_eliminacion_de_la_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "Con operación " + Suffix();
        var app = await AppExactAsync(client, name);
        var snapshotId = (await JsonAsync(await UploadAsync(client, app, Shop()), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        var applyId = Guid.CreateVersion7();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
            var sourceId = await db.Snapshots.Where(s => s.Id == snapshotId).Select(s => s.SourceId).SingleAsync();
            db.Applies.Add(new Walkie.Modules.Discovery.Domain.ApplyRecord
            {
                ApplyId = applyId, AppId = app, SourceId = sourceId, SnapshotId = snapshotId, RequestHash = "x",
                Status = "pending", CreatedBy = "usuario-de-prueba", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();

            // Otra ejecución la tiene tomada: bloquea.
            await using (var held = await ApplyLock.TryAcquireAsync(db, applyId, CancellationToken.None))
            {
                Assert.NotNull(held);
                var problem = await JsonAsync(await DeleteAppAsync(client, app, Guid.CreateVersion7(), name), HttpStatusCode.Conflict);
                Assert.Equal("discovery-in-progress", problem.GetProperty("impact").GetProperty("blockers")[0].GetProperty("code").GetString());
                Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
            }
        }

        // Pendiente pero sin nadie que la ejecute (una caída): no bloquea y se purga con la app.
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAppAsync(client, app, Guid.CreateVersion7(), name)).StatusCode);
        Assert.False(await DiscoveryAsync(db => db.Applies.AnyAsync(a => a.ApplyId == applyId)));
    }

    [Fact]
    public async Task Un_fallo_a_mitad_de_una_app_la_deja_inaccesible_y_reintentar_la_termina()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "App con fallo " + Suffix();
        var app = await AppExactAsync(client, name);
        var feature = await FeatureAsync(client, app, "Una");
        var asset = await AssetAsync(client, app);
        await PutCanvasAsync(client, feature, Graph(asset, null, null));
        var token = (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/features/{feature}/shares", UriKind.Relative), new CreateShareRequest(7)), HttpStatusCode.Created))
            .GetProperty("token").GetString()!;

        var fail = true;
        using var faulty = WithCheckpoints((step, _) => fail && step == "files" ? throw new InvalidOperationException("S3 no responde") : Task.CompletedTask);
        using var failing = Authenticated(faulty);
        var deletionId = Guid.CreateVersion7();
        var pending = await JsonAsync(await DeleteAppAsync(failing, app, deletionId, name), HttpStatusCode.Accepted);
        Assert.Equal("pending", pending.GetProperty("status").GetString());
        Assert.Contains(pending.GetProperty("steps").EnumerateArray(), s => s.GetProperty("step").GetString() == "files" && s.GetProperty("status").GetString() == "failed");

        // A mitad: ya no es accesible por ninguna ruta (ni el enlace), aunque las imágenes sigan.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/public/shares/{token}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/assets/{asset}", UriKind.Relative))).StatusCode);
        Assert.True(await FilesAsync(db => db.Assets.AnyAsync(a => a.Id == asset)));

        // Mientras la espera no vence, consultar no la repite; después, la consulta la termina.
        Assert.Equal("pending", (await JsonAsync(await client.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative)), HttpStatusCode.OK)).GetProperty("status").GetString());
        fail = false;
        await ExpireLeaseAsync(deletionId);
        var done = await JsonAsync(await failing.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal("completed", done.GetProperty("status").GetString());
        Assert.False(await FilesAsync(db => db.Assets.AnyAsync(a => a.AppId == app)));
        Assert.False(await AppsAsync(db => db.Apps.AnyAsync(a => a.Id == app)));
        Assert.True(await AppsAsync(db => db.Deletions.Where(d => d.Id == deletionId).Select(d => d.Attempts).SingleAsync()) >= 2);
    }

    [Fact]
    public async Task Crear_features_mientras_se_elimina_la_app_no_deja_huerfanos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "Carrera " + Suffix();
        var app = await AppExactAsync(client, name);
        await FeatureAsync(client, app, "Antes");

        var creations = Enumerable.Range(0, 5).Select(i =>
            client.PostAsJsonAsync(new Uri($"/api/apps/{app}/features", UriKind.Relative), new { name = $"Durante {i}" }));
        var deletion = DeleteAppAsync(client, app, Guid.CreateVersion7(), name);
        var results = await Task.WhenAll(creations.Append(deletion));

        Assert.Equal(HttpStatusCode.NoContent, results[^1].StatusCode);
        Assert.All(results[..^1], r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.Created, HttpStatusCode.NotFound }));
        // Una feature creada en vuelo la retoma un reintento (la fase 2 vuelve a buscar las de la app).
        await DeletionRecovery.RecoverOnceAsync(factory.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None);
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.AppId == app)));
        Assert.False(await AppsAsync(db => db.Apps.AnyAsync(a => a.Id == app)));
    }

    // ---------- Ayudas ----------

    private static string Suffix() => Guid.NewGuid().ToString("N")[..8];

    private static async Task<Guid> AppAsync(HttpClient client, string name) => await AppExactAsync(client, name + " " + Suffix());

    private static async Task<Guid> AppExactAsync(HttpClient client, string name) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new { name }), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<Guid> FeatureAsync(HttpClient client, Guid app, string name) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{app}/features", UriKind.Relative), new { name }), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<Guid> ItemAsync(HttpClient client, Guid app) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{app}/catalog", UriKind.Relative),
            new { type = "api", title = "Pedidos", http = new { method = "GET", path = "/api/pedidos" } }), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<Guid> AssetAsync(HttpClient client, Guid app)
    {
        using var file = new ByteArrayContent(TestImages.Create("png", 8, 8));
        file.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        using var content = new MultipartFormDataContent { { file, "file", "pantalla.png" } };
        return (await JsonAsync(await client.PostAsync(new Uri($"/api/apps/{app}/assets", UriKind.Relative), content), HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    private static async Task PutCanvasAsync(HttpClient client, Guid feature, JsonObject graph, int version = 0)
    {
        graph["version"] = version;
        var response = await client.PutAsJsonAsync(new Uri($"/api/features/{feature}/canvas", UriKind.Relative), graph);
        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    /// <summary>Dos pantallas (con imagen si se da), un componente del catálogo, 2 conexiones, un tour y un recorrido.</summary>
    private static JsonObject Graph(Guid? image1, Guid? image2, Guid? item, string prefix = "a")
    {
        string Id(string name) => DeterministicId(prefix + name);
        var a = Id("pantalla1");
        var b = Id("pantalla2");
        var c = Id("api");
        var e1 = Id("e1");
        var e2 = Id("e2");
        JsonObject Screen(string id, string title, Guid? asset)
        {
            var node = new JsonObject { ["id"] = id, ["type"] = "screen", ["title"] = title };
            if (asset is { } value)
            {
                node["assetId"] = value.ToString();
            }

            return node;
        }

        var nodes = new JsonObject { [a] = Screen(a, "Lista", image1), [b] = Screen(b, "Detalle", image2) };
        nodes[c] = item is { } catalogId
            ? new JsonObject { ["id"] = c, ["type"] = "ref", ["title"] = "Pedidos", ["catalogId"] = catalogId.ToString() }
            : new JsonObject { ["id"] = c, ["type"] = "api", ["title"] = "Pedidos" };
        return new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = 0,
            ["nodes"] = nodes,
            ["edges"] = new JsonObject
            {
                [e1] = new JsonObject { ["id"] = e1, ["from"] = a, ["to"] = b, ["kind"] = "navigation" },
                [e2] = new JsonObject { ["id"] = e2, ["from"] = a, ["to"] = c, ["kind"] = "request" },
            },
            ["layout"] = new JsonObject
            {
                [a] = new JsonObject { ["x"] = 0, ["y"] = 0 },
                [b] = new JsonObject { ["x"] = 300, ["y"] = 0 },
                [c] = new JsonObject { ["x"] = 0, ["y"] = 200 },
            },
            ["tours"] = new JsonObject
            {
                ["t1"] = new JsonObject { ["id"] = "t1", ["name"] = "Guía", ["kind"] = "guide", ["steps"] = new JsonArray(new JsonObject { ["id"] = "s1", ["nodeId"] = a }) },
                ["t2"] = new JsonObject { ["id"] = "t2", ["name"] = "Recorrido", ["kind"] = "flow", ["steps"] = new JsonArray(new JsonObject { ["id"] = "s2", ["edgeId"] = e1 }) },
            },
        };
    }

    private static string DeterministicId(string seed)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed));
        return new Guid(bytes[..16]).ToString();
    }

    private static async Task<JsonElement> ImpactAsync(HttpClient client, string url)
    {
        var impact = await JsonAsync(await client.GetAsync(new Uri(url, UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DeletionImpact, impact));
        return impact;
    }

    private static Task<HttpResponseMessage> DeleteFeatureAsync(HttpClient client, Guid feature, Guid deletionId, int canvasVersion) =>
        client.DeleteAsync(new Uri($"/api/features/{feature}?deletionId={deletionId}&canvasVersion={canvasVersion}", UriKind.Relative));

    private static Task<HttpResponseMessage> DeleteAppAsync(HttpClient client, Guid app, Guid deletionId, string confirmName) =>
        client.DeleteAsync(new Uri($"/api/apps/{app}?deletionId={deletionId}&confirmName={Uri.EscapeDataString(confirmName)}", UriKind.Relative));

    private WebApplicationFactory<Program> WithCheckpoints(Func<string, Guid, Task> reached) =>
        factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IDeletionCheckpoints>(new Checkpoints(reached))));

    private static HttpClient Authenticated(WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken());
        return client;
    }

    private sealed class Checkpoints(Func<string, Guid, Task> reached) : IDeletionCheckpoints
    {
        public Task ReachedAsync(Guid deletionId, string step, CancellationToken cancellationToken) => reached(step, deletionId);
    }

    private Task<int> ExpireLeaseAsync(Guid deletionId) =>
        AppsAsync(db => db.Deletions.Where(d => d.Id == deletionId).ExecuteUpdateAsync(s => s.SetProperty(d => d.LeaseUntil, (DateTimeOffset?)null)));

    private async Task<T> AppsAsync<T>(Func<AppsDbContext, Task<T>> query) => await QueryAsync(query);

    private async Task<T> CanvasAsync<T>(Func<CanvasDbContext, Task<T>> query) => await QueryAsync(query);

    private async Task<T> FilesAsync<T>(Func<FilesDbContext, Task<T>> query) => await QueryAsync(query);

    private async Task<T> SharingAsync<T>(Func<SharingDbContext, Task<T>> query) => await QueryAsync(query);

    private async Task<T> DiscoveryAsync<T>(Func<DiscoveryDbContext, Task<T>> query) => await QueryAsync(query);

    private async Task<T> QueryAsync<TContext, T>(Func<TContext, Task<T>> query) where TContext : notnull
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<TContext>());
    }

    /// <summary>Los bytes de un objeto en S3, o null si ya no está.</summary>
    private async Task<Stream?> ObjectAsync(string key)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IFileStorage>().GetAsync(key, CancellationToken.None);
    }

    /// <summary>Una tienda ficticia React + .NET con la propuesta «Pedidos» (feature:web:Pedidos).</summary>
    private static byte[] Shop() => Scan(new Dictionary<string, string>
    {
        ["api/Tienda.Api/Tienda.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
        ["api/Tienda.Api/Program.cs"] = """
            var app = WebApplication.CreateBuilder(args).Build();
            var pedidos = app.MapGroup("/api/pedidos");
            pedidos.MapGet("/", () => Results.Ok());
            pedidos.MapGet("/{id:guid}", (Guid id) => Results.Ok());
            app.Run();
            """,
        ["web/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""",
        ["web/src/rutas.tsx"] = """
            import { createBrowserRouter } from 'react-router-dom';
            import { PedidosPage, PedidoPage } from './paginas';
            export const router = createBrowserRouter([
              { path: '/pedidos', element: <PedidosPage /> },
              { path: '/pedidos/:id', element: <PedidoPage /> },
            ]);
            """,
        ["web/src/paginas.tsx"] = """
            import { Link } from 'react-router-dom';
            export function PedidosPage() { fetch('/api/pedidos'); return <Link to="/pedidos/1">Ver</Link>; }
            export function PedidoPage() { fetch('/api/pedidos/1'); return <Link to="/pedidos">Volver</Link>; }
            """,
    }, "--source-id", Guid.CreateVersion7().ToString());
}
