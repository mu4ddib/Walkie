using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;
using Walkie.Modules.Sharing.Contracts;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Autorización por app (spec autorizacion-por-app, ADR-0015): ningún endpoint con un recurso de app queda sin rol,
/// quien no es miembro recibe 404 en todos (IDOR), un rol menor recibe 403 y el suficiente pasa; el listado solo trae
/// las apps propias; los miembros siguen sus reglas; toda app nace con su owner, también las que ya existían.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class AppAuthorizationTests(WalkieApiFactory factory)
{
    private static readonly string[] ResourceKeys = ["appId", "featureId", "moduleId", "itemId", "assetId", "shareId", "snapshotId"];

    [Fact]
    public void Ningun_endpoint_con_un_recurso_de_app_en_la_ruta_queda_sin_rol()
    {
        _ = factory.CreateClient();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();
        var resolvers = factory.Services.CreateScope().ServiceProvider.GetServices<IAppScopeResolver>().Select(r => r.RouteKey).ToHashSet();
        Assert.True(ResourceKeys.All(resolvers.Contains), "Falta un IAppScopeResolver: " + string.Join(", ", ResourceKeys.Where(k => !resolvers.Contains(k))));

        var unprotected = endpoints
            .Where(e => e.Metadata.GetMetadata<IAllowAnonymous>() is null)
            .Where(e => e.RoutePattern.Parameters.Any(p => ResourceKeys.Contains(p.Name)))
            .Where(e => e.Metadata.GetMetadata<AppRoleRequirement>() is null)
            .Select(e => e.DisplayName ?? e.RoutePattern.RawText)
            .ToList();

        Assert.True(unprotected.Count == 0, "Sin RequireAppRole: " + string.Join("; ", unprotected));
        Assert.Contains(endpoints, e => e.Metadata.GetMetadata<AppRoleRequirement>() is { Minimum: AppRole.Owner });
    }

    [Fact]
    public async Task Cada_endpoint_responde_404_a_quien_no_es_miembro_403_a_un_rol_menor_y_deja_pasar_al_suficiente()
    {
        using var owner = factory.CreateAuthenticatedClient();
        var world = await WorldAsync(owner);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        using var stranger = await Members.PersonAsync(factory, "extrano-" + suffix);
        using var viewer = await Members.PersonAsync(factory, "viewer-" + suffix);
        using var editor = await Members.PersonAsync(factory, "editor-" + suffix);
        await Members.GrantAsync(owner, world.App, "viewer-" + suffix, "viewer");
        await Members.GrantAsync(owner, world.App, "editor-" + suffix, "editor");
        var clients = new Dictionary<AppRole, HttpClient> { [AppRole.Viewer] = viewer, [AppRole.Editor] = editor, [AppRole.Owner] = owner };

        foreach (var c in Cases(world, "editor-" + suffix))
        {
            var denied = await SendAsync(stranger, c);
            Assert.True(denied.StatusCode == HttpStatusCode.NotFound, $"{c.Method} {c.Url} sin membresía: {(int)denied.StatusCode}");

            foreach (var (role, client) in clients)
            {
                if (role >= c.Minimum && c.Destructive)
                {
                    continue; // se prueba al final, una sola vez
                }

                var response = await SendAsync(client, c);
                if (role < c.Minimum)
                {
                    Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{c.Method} {c.Url} como {role}: {(int)response.StatusCode}");
                }
                else
                {
                    Assert.True(response.StatusCode is not (HttpStatusCode.Forbidden or HttpStatusCode.NotFound or HttpStatusCode.Unauthorized),
                        $"{c.Method} {c.Url} como {role}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
                }
            }
        }

        // Lo destructivo, al final y solo con el owner: pasa.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync(new Uri($"/api/catalog/{world.SpareItem}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync(new Uri($"/api/modules/{world.SpareModule}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync(new Uri($"/api/shares/{world.Share}", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task El_listado_solo_trae_las_apps_propias_con_el_rol()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        using var ana = await Members.PersonAsync(factory, "ana-" + suffix);
        using var beto = await Members.PersonAsync(factory, "beto-" + suffix);
        var mine = await CreateAppAsync(ana, "De Ana " + suffix);
        var shared = await CreateAppAsync(ana, "Compartida " + suffix);
        await Members.GrantAsync(ana, shared, "beto-" + suffix, "viewer");

        var list = await beto.GetFromJsonAsync<JsonElement[]>(new Uri("/api/apps", UriKind.Relative));
        Assert.DoesNotContain(list!, a => a.GetProperty("id").GetGuid() == mine);
        var seen = Assert.Single(list!, a => a.GetProperty("id").GetGuid() == shared);
        Assert.Equal("viewer", seen.GetProperty("role").GetString());
        var own = (await ana.GetFromJsonAsync<JsonElement[]>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.All(own.Where(a => a.GetProperty("id").GetGuid() == mine || a.GetProperty("id").GetGuid() == shared),
            a => Assert.Equal("owner", a.GetProperty("role").GetString()));
        Assert.Equal(HttpStatusCode.NotFound, (await beto.GetAsync(new Uri($"/api/apps/{mine}", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Los_miembros_se_suman_por_correo_y_siempre_queda_un_owner()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        using var owner = await Members.PersonAsync(factory, "duena-" + suffix);
        using var other = await Members.PersonAsync(factory, "otro-" + suffix);
        var app = await CreateAppAsync(owner, "Miembros " + suffix);
        var members = new Uri($"/api/apps/{app}/members", UriKind.Relative);

        // Alguien que nunca entró: 400 con qué hacer. Un rol inventado: 400.
        var unknown = await owner.PostAsJsonAsync(members, new { email = "nadie-" + suffix + "@walkie.test", role = "viewer" });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Contains("inicie sesión", await unknown.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(members, new { email = Members.Email("otro-" + suffix), role = "admin" })).StatusCode);

        await Members.GrantAsync(owner, app, "otro-" + suffix, "viewer");
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(members, new { email = Members.Email("otro-" + suffix), role = "editor" })).StatusCode);
        var list = (await owner.GetFromJsonAsync<JsonElement[]>(members))!;
        Assert.Equal(["owner", "viewer"], list.Select(m => m.GetProperty("role").GetString()));
        Assert.All(list, m => Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AppMember, m)));
        Assert.Equal("Persona otro-" + suffix, list[1].GetProperty("name").GetString());

        // Un viewer no suma, no cambia roles ni quita a otros; sí se quita a sí mismo.
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync(members, new { email = Members.Email("duena-" + suffix), role = "viewer" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync(new Uri($"/api/apps/{app}/members/duena-{suffix}", UriKind.Relative))).StatusCode);

        // El único owner no se degrada ni se quita.
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.PutAsJsonAsync(new Uri($"/api/apps/{app}/members/duena-{suffix}", UriKind.Relative), new { role = "editor" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync(new Uri($"/api/apps/{app}/members/duena-{suffix}", UriKind.Relative))).StatusCode);

        // Con otro owner, sí; el rol nuevo se aplica de inmediato.
        Assert.Equal(HttpStatusCode.OK,
            (await owner.PutAsJsonAsync(new Uri($"/api/apps/{app}/members/otro-{suffix}", UriKind.Relative), new { role = "owner" })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await other.PostAsJsonAsync(new Uri($"/api/apps/{app}/features", UriKind.Relative), new { name = "Ahora puedo" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync(new Uri($"/api/apps/{app}/members/duena-{suffix}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Toda_app_nueva_nace_con_su_owner_vacia_importada_o_desde_un_proyecto_local()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        using var ana = await Members.PersonAsync(factory, "creadora-" + suffix);
        using var beto = await Members.PersonAsync(factory, "ajeno-" + suffix);

        var empty = await CreateAppAsync(ana, "Vacía " + suffix);
        using var form = new MultipartFormDataContent
        {
            { new ByteArrayContent(Tienda()), "file", "tienda.walkiepack" },
            { new StringContent("Desde proyecto " + suffix), "name" },
            { new StringContent(Guid.CreateVersion7().ToString()), "importId" },
        };
        var fromProject = (await JsonAsync(await ana.PostAsync(new Uri("/api/sources/import", UriKind.Relative), form), HttpStatusCode.Created))
            .GetProperty("app").GetProperty("id").GetGuid();
        // Un .walkie de app necesita al menos una feature.
        await JsonAsync(await ana.PostAsJsonAsync(new Uri($"/api/apps/{empty}/features", UriKind.Relative), new { name = "Login" }), HttpStatusCode.Created);
        var walkie = await ana.GetAsync(new Uri($"/api/apps/{empty}/export?format=walkie", UriKind.Relative));
        using var file = new ByteArrayContent(await walkie.Content.ReadAsByteArrayAsync());
        file.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var package = new MultipartFormDataContent { { file, "file", "app.walkie" } };
        var imported = (await JsonAsync(await ana.PostAsync(new Uri("/api/apps/import", UriKind.Relative), package), HttpStatusCode.Created))
            .GetProperty("app").GetProperty("id").GetGuid();

        foreach (var app in new[] { empty, fromProject, imported })
        {
            Assert.Equal("owner", (await JsonAsync(await ana.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative)), HttpStatusCode.OK)).GetProperty("role").GetString());
            Assert.Equal(HttpStatusCode.NotFound, (await beto.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
        }
    }

    [Fact]
    public async Task La_migracion_deja_como_owner_de_cada_app_existente_a_quien_la_creo()
    {
        var main = factory.Services.GetRequiredService<IConfiguration>().GetConnectionString("Walkie")!;
        var name = "walkie_membresias_" + Guid.NewGuid().ToString("N")[..12];
        await using (var admin = new NpgsqlConnection(main))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync();
        }

        var options = new DbContextOptionsBuilder<AppsDbContext>()
            .UseNpgsql(new NpgsqlConnectionStringBuilder(main) { Database = name }.ConnectionString,
                n => n.MigrationsHistoryTable("__ef_migrations_history", AppsDbContext.Schema))
            .Options;
        await using var db = new AppsDbContext(options);
        await db.GetService<IMigrator>().MigrateAsync("20261113045606_FeatureKind");
        var appId = Guid.CreateVersion7();
        await db.Database.ExecuteSqlAsync($"INSERT INTO apps.apps (id, name, created_by, created_at) VALUES ({appId}, 'Anterior', 'quien-la-creo', now())");

        await db.Database.MigrateAsync();

        var membership = await db.Memberships.SingleAsync(m => m.AppId == appId);
        Assert.Equal(("quien-la-creo", "owner"), (membership.UserId, membership.Role));
    }

    // ---------- Un mundo con un recurso de cada tipo ----------

    private sealed record World(Guid App, Guid Feature, Guid Module, Guid SpareModule, Guid Item, Guid SpareItem, Guid Asset, Guid Share, Guid Snapshot, string EntityKey);

    private sealed record Case(string Method, string Url, AppRole Minimum, Func<HttpContent?>? Body = null, bool Destructive = false);

    private static async Task<World> WorldAsync(HttpClient owner)
    {
        var app = await CreateAppAsync(owner, "Autorización " + Guid.NewGuid().ToString("N")[..6]);
        var feature = (await JsonAsync(await owner.PostAsJsonAsync(new Uri($"/api/apps/{app}/features", UriKind.Relative), new { name = "Login" }), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();
        var module = await ModuleAsync(owner, app, "Usuarios");
        var spareModule = await ModuleAsync(owner, app, "Para borrar");
        var item = await ItemAsync(owner, app, "Consultar");
        var spareItem = await ItemAsync(owner, app, "Para borrar");
        using var image = new ByteArrayContent(TestImages.Create("png", 8, 8));
        image.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        using var upload = new MultipartFormDataContent { { image, "file", "login.png" } };
        var asset = (await JsonAsync(await owner.PostAsync(new Uri($"/api/apps/{app}/assets", UriKind.Relative), upload), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();
        var share = (await JsonAsync(await owner.PostAsJsonAsync(new Uri($"/api/features/{feature}/shares", UriKind.Relative), new CreateShareRequest(7)), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();
        var snapshot = (await JsonAsync(await UploadAsync(owner, app, Tienda()), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        var review = await JsonAsync(await owner.GetAsync(new Uri($"/api/snapshots/{snapshot}/review", UriKind.Relative)), HttpStatusCode.OK);
        var key = review.GetProperty("items")[0].GetProperty("key").GetString()!;
        return new World(app, feature, module, spareModule, item, spareItem, asset, share, snapshot, key);
    }

    private static IEnumerable<Case> Cases(World w, string memberSub)
    {
        static HttpContent Json(object body) => JsonContent.Create(body);
        static HttpContent Form() => new MultipartFormDataContent { { new ByteArrayContent("no es un zip"u8.ToArray()), "file", "x.zip" } };

        // viewer: leer
        yield return new("GET", $"/api/apps/{w.App}", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/features", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/catalog", AppRole.Viewer);
        yield return new("GET", $"/api/catalog/{w.Item}", AppRole.Viewer);
        yield return new("GET", $"/api/catalog/{w.Item}/usages", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/modules", AppRole.Viewer);
        yield return new("GET", $"/api/modules/{w.Module}", AppRole.Viewer);
        yield return new("GET", $"/api/modules/{w.Module}/usages", AppRole.Viewer);
        yield return new("GET", $"/api/features/{w.Feature}/canvas", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/canvas-previews", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/map", AppRole.Viewer);
        yield return new("GET", $"/api/features/{w.Feature}/export", AppRole.Viewer);
        yield return new("POST", $"/api/features/{w.Feature}/export/pdf", AppRole.Viewer, () => new MultipartFormDataContent { { new StringContent("x"), "nota" } });
        yield return new("GET", $"/api/apps/{w.App}/export?format=ai", AppRole.Viewer);
        yield return new("GET", $"/api/assets/{w.Asset}", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/sources", AppRole.Viewer);
        yield return new("GET", $"/api/snapshots/{w.Snapshot}/review", AppRole.Viewer);
        yield return new("GET", $"/api/snapshots/{w.Snapshot}/evidence?entityKey={Uri.EscapeDataString(w.EntityKey)}", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/bindings?target=catalogItem:{w.Item}", AppRole.Viewer);
        yield return new("GET", $"/api/apps/{w.App}/members", AppRole.Viewer);

        // editor: crear y editar (cuerpos válidos o con un error de contenido: lo que importa es que pase la autorización)
        yield return new("POST", $"/api/apps/{w.App}/features", AppRole.Editor, () => Json(new { name = "Nueva" }));
        yield return new("PUT", $"/api/features/{w.Feature}", AppRole.Editor, () => Json(new { name = "Login" }));
        yield return new("POST", $"/api/apps/{w.App}/catalog", AppRole.Editor, () => Json(new { type = "service", title = "Servicio " + Guid.NewGuid().ToString("N")[..6] }));
        yield return new("PUT", $"/api/catalog/{w.Item}", AppRole.Editor, () => Json(new { title = "Consultar", version = 999 }));
        yield return new("POST", $"/api/apps/{w.App}/modules", AppRole.Editor, () => Json(new { name = "Otro módulo" }));
        yield return new("POST", $"/api/apps/{w.App}/modules/extract", AppRole.Editor, () => Json(new { }));
        yield return new("PUT", $"/api/features/{w.Feature}/canvas", AppRole.Editor, () => Json(new { schemaVersion = 0, version = 999, nodes = new { }, edges = new { }, layout = new { } }));
        yield return new("PUT", $"/api/apps/{w.App}/map/layout", AppRole.Editor, () => Json(new { version = 999, positions = new { } }));
        yield return new("POST", $"/api/apps/{w.App}/assets", AppRole.Editor, Form);
        yield return new("POST", $"/api/apps/{w.App}/import?dryRun=true", AppRole.Editor, Form);
        yield return new("POST", $"/api/apps/{w.App}/sources/snapshots?dryRun=true", AppRole.Editor, Form);
        yield return new("POST", $"/api/snapshots/{w.Snapshot}/apply", AppRole.Editor, () => Json(new { applyId = "no-es-un-uuid", operations = Array.Empty<object>() }));

        // owner: borrar, enlaces y miembros
        yield return new("DELETE", $"/api/catalog/{w.SpareItem}", AppRole.Owner, Destructive: true);
        yield return new("DELETE", $"/api/modules/{w.SpareModule}", AppRole.Owner, Destructive: true);
        yield return new("POST", $"/api/features/{w.Feature}/shares", AppRole.Owner, () => Json(new CreateShareRequest(7)));
        yield return new("GET", $"/api/features/{w.Feature}/shares", AppRole.Owner);
        yield return new("DELETE", $"/api/shares/{w.Share}", AppRole.Owner, Destructive: true);
        // Eliminar (ADR-0017): solo el owner. Lo destructivo con el owner lo prueba DeletionTests.
        yield return new("GET", $"/api/features/{w.Feature}/deletion", AppRole.Owner);
        yield return new("GET", $"/api/apps/{w.App}/deletion", AppRole.Owner);
        yield return new("DELETE", $"/api/features/{w.Feature}?deletionId={Guid.CreateVersion7()}&canvasVersion=0", AppRole.Owner, Destructive: true);
        yield return new("DELETE", $"/api/apps/{w.App}?deletionId={Guid.CreateVersion7()}&confirmName=x", AppRole.Owner, Destructive: true);
        yield return new("POST", $"/api/apps/{w.App}/members", AppRole.Owner, () => Json(new { email = "nadie@walkie.test", role = "viewer" }));
        yield return new("PUT", $"/api/apps/{w.App}/members/{memberSub}", AppRole.Owner, () => Json(new { role = "editor" }));
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, Case c)
    {
        using var request = new HttpRequestMessage(new HttpMethod(c.Method), new Uri(c.Url, UriKind.Relative)) { Content = c.Body?.Invoke() };
        return await client.SendAsync(request);
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client, string name) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(name)), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<Guid> ModuleAsync(HttpClient client, Guid app, string name) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{app}/modules", UriKind.Relative), new { name }), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<Guid> ItemAsync(HttpClient client, Guid app, string title) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{app}/catalog", UriKind.Relative),
            new { type = "api", title, http = new { method = "GET", path = "/api/" + Guid.NewGuid().ToString("N")[..6] } }), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();
}
