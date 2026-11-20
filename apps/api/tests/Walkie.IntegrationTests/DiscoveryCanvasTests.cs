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
using Walkie.Modules.Discovery.Features;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Crear módulos y features con su lienzo inicial desde un análisis (spec walkie-live, tarea 9; ADR-0012): solo lo
/// aprobado, solo lo que el análisis observó, sin tocar lienzos existentes, y con la bitácora de la tarea 6 frente a
/// fallos y caídas. Monorepo ficticio: dos apps React con /pedidos, un backend con un módulo de pedidos y dos backends
/// que publican la misma API.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryCanvasTests(WalkieApiFactory factory)
{
    private const string TiendaFeature = "feature:tienda:Pedidos";
    private const string AdminFeature = "feature:admin:Pedidos";
    private const string ListApi = "api:GET /api/pedidos";
    private const string DetailApi = "api:GET /api/pedidos/{}";
    private const string HealthApi = "api:GET /api/salud";

    private readonly Guid source = Guid.CreateVersion7();

    [Fact]
    public async Task Una_feature_se_crea_con_sus_pantallas_su_navegacion_y_sus_llamadas_decididas_sin_tocar_otros_lienzos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var (untouched, before) = await FeatureWithCanvasAsync(client, appId);
        var existing = await CatalogItemAsync(client, appId, "Lista de pedidos", "GET", "/api/pedidos");
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        // La lista se vincula a lo que ya estaba en el catálogo; el detalle se crea en la misma solicitud que la feature.
        await JsonAsync(await ApplyAsync(client, snapshotId, Link(ListApi, existing)), HttpStatusCode.OK);
        var detailId = Guid.CreateVersion7();

        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, dryRun: true,
            Create(DetailApi, detailId), Create(TiendaFeature, Guid.CreateVersion7())), HttpStatusCode.OK);
        var draft = Created(preview, TiendaFeature).GetProperty("canvas");

        Assert.Equal(["api:GET /api/pedidos", "api:GET /api/pedidos/{}", "screen:tienda:/pedidos", "screen:tienda:/pedidos/{}"],
            Strings(draft.GetProperty("nodes"), "key").Order(StringComparer.Ordinal));
        Assert.All(draft.GetProperty("nodes").EnumerateArray().Where(n => n.GetProperty("key").GetString()!.StartsWith("screen:", StringComparison.Ordinal)),
            n => Assert.StartsWith("screen:tienda:", n.GetProperty("key").GetString(), StringComparison.Ordinal)); // nunca las de admin
        var edges = draft.GetProperty("edges").EnumerateArray().ToList();
        Assert.Contains(edges, e => e.GetProperty("kind").GetString() == "navigation" && e.GetProperty("operation").GetString() == "navigation");
        Assert.Equal(2, edges.Count(e => e.GetProperty("operation").GetString() == "http.request"));
        // La llamada a la API que publican dos backends no se dibuja: se avisa.
        var ambiguous = Assert.Single(draft.GetProperty("omitted").EnumerateArray(), o => o.GetProperty("code").GetString() == "ambiguous-api");
        Assert.Contains("Compras.Api", ambiguous.GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Contains(Warnings(preview), w => w == "ambiguous-api");
        Assert.False(draft.TryGetProperty("graph", out _));

        // Sin lienzo no se aplica; con ids y posiciones, sí.
        var missing = await JsonAsync(await ApplyAsync(client, snapshotId, Create(DetailApi, detailId), Create(TiendaFeature, Guid.CreateVersion7())), HttpStatusCode.BadRequest);
        Assert.True(missing.GetProperty("errors").TryGetProperty("/operations/1/canvas", out _));

        var featureId = Guid.CreateVersion7();
        var canvas = Canvas(draft);
        var result = await JsonAsync(await ApplyAsync(client, snapshotId,
            Create(DetailApi, detailId), Create(TiendaFeature, featureId, canvas)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryApplyResult, result));
        Assert.Equal("completed", result.GetProperty("status").GetString());

        var graph = await GraphAsync(client, featureId);
        Assert.Equal(1, graph.GetProperty("version").GetInt32());
        Assert.Equal(4, graph.GetProperty("nodes").EnumerateObject().Count());
        var nodes = graph.GetProperty("nodes").EnumerateObject().Select(p => p.Value).ToList();
        Assert.Contains(nodes, n => n.GetProperty("type").GetString() == "ref" && n.GetProperty("catalogId").GetGuid() == existing);
        Assert.Contains(nodes, n => n.GetProperty("type").GetString() == "ref" && n.GetProperty("catalogId").GetGuid() == detailId);
        Assert.Contains(nodes, n => n.GetProperty("type").GetString() == "screen" && n.GetProperty("description").GetString() == "Ruta: /pedidos/:id");
        // Solo lo observado: ni respuestas ni códigos.
        Assert.DoesNotContain(graph.GetProperty("edges").EnumerateObject(), e => e.Value.GetProperty("kind").GetString() == "response");

        // La feature, sus pantallas y lo creado quedan vinculados; el resto de la app no cambió.
        var review = await ReviewAsync(client, snapshotId);
        Assert.Equal("created", Item(review, TiendaFeature).GetProperty("status").GetString());
        Assert.Equal("created", Item(review, "screen:tienda:/pedidos").GetProperty("status").GetString());
        Assert.Equal("new", Item(review, "screen:admin:/pedidos").GetProperty("status").GetString());
        var after = await GraphAsync(client, untouched);
        Assert.True(JsonElement.DeepEquals(before, after));
        var provenance = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/bindings?target=feature:{featureId}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(3, provenance.GetProperty("bindings").GetArrayLength()); // la feature y sus dos pantallas
    }

    [Fact]
    public async Task Dos_candidatos_Pedidos_de_dos_apps_dan_dos_features_con_nombres_distintos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());

        await CreateWithCanvasAsync(client, snapshotId, TiendaFeature, Guid.CreateVersion7());
        var second = await CreateWithCanvasAsync(client, snapshotId, AdminFeature, Guid.CreateVersion7());

        var names = (await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!
            .Select(f => f.GetProperty("name").GetString()).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(["Pedidos", "Pedidos (admin)"], names);
        Assert.Equal("Pedidos (admin)", Created(second, AdminFeature).GetProperty("target").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Un_modulo_se_crea_con_sus_interfaces_y_una_feature_despues_llama_a_su_interfaz()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var review = await ReviewAsync(client, snapshotId);
        var moduleKey = review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "module").GetProperty("key").GetString()!;
        var (list, detail, moduleId) = (Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());

        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, dryRun: true,
            Create(ListApi, list), Create(DetailApi, detail), Create(moduleKey, moduleId)), HttpStatusCode.OK);
        var draft = Created(preview, moduleKey).GetProperty("canvas");
        Assert.Equal(2, draft.GetProperty("interfaces").GetArrayLength());
        Assert.All(draft.GetProperty("interfaces").EnumerateArray(), i => Assert.Equal("provides", i.GetProperty("kind").GetString()));
        Assert.Contains(Warnings(preview), w => w == "inferred");

        await JsonAsync(await ApplyAsync(client, snapshotId,
            Create(ListApi, list), Create(DetailApi, detail), Create(moduleKey, moduleId, Canvas(draft))), HttpStatusCode.OK);
        var module = await GraphAsync(client, moduleId);
        Assert.Equal(2, module.GetProperty("interfaces").EnumerateObject().Count());
        var summaries = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Contains(summaries.EnumerateArray(), m => m.GetProperty("id").GetGuid() == moduleId);

        // La feature llama a las APIs del módulo por sus interfaces (una sola las ofrece): no a un ref suelto.
        var featureId = Guid.CreateVersion7();
        await CreateWithCanvasAsync(client, snapshotId, TiendaFeature, featureId);
        var feature = await GraphAsync(client, featureId);
        var moduleNode = Assert.Single(feature.GetProperty("nodes").EnumerateObject(), n => n.Value.GetProperty("type").GetString() == "module").Value;
        Assert.Equal(moduleId, moduleNode.GetProperty("moduleId").GetGuid());
        var calls = feature.GetProperty("edges").EnumerateObject().Select(e => e.Value).Where(e => e.GetProperty("operation").GetString() == "http.request").ToList();
        Assert.Equal(2, calls.Count);
        Assert.All(calls, c => Assert.True(c.TryGetProperty("toInterface", out _)));
    }

    [Theory]
    [InlineData("created:1")]
    [InlineData("canvas:1")]
    [InlineData("finalize")]
    public async Task Una_caida_al_crear_se_retoma_con_el_mismo_applyId_sin_duplicar(string checkpoint)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var detail = Guid.CreateVersion7();
        var featureId = Guid.CreateVersion7();
        var draft = await DraftAsync(client, snapshotId, Create(DetailApi, detail), Create(TiendaFeature, featureId));
        var applyId = Guid.CreateVersion7();
        JsonObject[] operations = [Create(DetailApi, detail), Create(TiendaFeature, featureId, Canvas(draft))];

        using (var crashing = WithCheckpoints((reached, _) => reached == checkpoint ? throw new ApplyAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ApplyWithIdAsync(dying, snapshotId, applyId, operations));
        }

        Assert.Equal("pending", await ApplyStatusAsync(applyId));
        var done = await JsonAsync(await ApplyWithIdAsync(client, snapshotId, applyId, operations), HttpStatusCode.OK);

        Assert.Equal("completed", done.GetProperty("status").GetString());
        var names = (await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!;
        Assert.Single(names);
        Assert.Equal(1, (await GraphAsync(client, featureId)).GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Si_alguien_guarda_el_lienzo_de_la_feature_durante_la_caida_el_reintento_no_lo_pisa()
    {
        // Tarea 11 (integridad): la feature quedó creada y su lienzo todavía no; una persona la abre y guarda el suyo.
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var detail = Guid.CreateVersion7();
        var featureId = Guid.CreateVersion7();
        var draft = await DraftAsync(client, snapshotId, Create(DetailApi, detail), Create(TiendaFeature, featureId));
        var applyId = Guid.CreateVersion7();
        JsonObject[] operations = [Create(DetailApi, detail), Create(TiendaFeature, featureId, Canvas(draft))];

        using (var crashing = WithCheckpoints((reached, _) => reached == "created:1" ? throw new ApplyAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ApplyWithIdAsync(dying, snapshotId, applyId, operations));
        }

        var human = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0,
            ["nodes"] = new JsonObject { ["h1"] = new JsonObject { ["id"] = "h1", ["type"] = "screen", ["title"] = "Lo que dibujó una persona" } },
            ["edges"] = new JsonObject(),
            ["layout"] = new JsonObject { ["h1"] = new JsonObject { ["x"] = 40, ["y"] = 40 } },
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), human)).StatusCode);
        var saved = await GraphAsync(client, featureId);

        var done = await JsonAsync(await ApplyWithIdAsync(client, snapshotId, applyId, operations), HttpStatusCode.OK);

        Assert.Equal("completed", done.GetProperty("status").GetString());
        Assert.True(JsonElement.DeepEquals(saved, await GraphAsync(client, featureId))); // su lienzo, no el borrador
    }

    [Fact]
    public async Task Un_reintento_no_se_atribuye_un_modulo_ajeno_creado_con_el_mismo_id_mientras_estaba_pendiente()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var moduleKey = (await ReviewAsync(client, snapshotId)).GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("kind").GetString() == "module").GetProperty("key").GetString()!;
        var (list, detail, moduleId) = (Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());
        var draft = await DraftAsync(client, snapshotId, Create(ListApi, list), Create(DetailApi, detail), Create(moduleKey, moduleId));
        var applyId = Guid.CreateVersion7();
        JsonObject[] operations = [Create(ListApi, list), Create(DetailApi, detail), Create(moduleKey, moduleId, Canvas(draft))];

        // Se cae después de reservar los ids y antes de crear nada.
        using (var crashing = WithCheckpoints((reached, _) => reached == "pending" ? throw new ApplyAbandonedException(reached) : Task.CompletedTask))
        using (var dying = Authenticated(crashing))
        {
            await CrashAsync(() => ApplyWithIdAsync(dying, snapshotId, applyId, operations));
        }

        // Mientras tanto, otra persona crea un módulo con ese mismo id (la API de módulos acepta el id del cliente).
        // (Una persona de la app: desde ADR-0015, alguien de afuera ni siquiera la ve.)
        var sub = "otra-persona-" + Guid.NewGuid().ToString("N")[..8];
        using var other = await Members.PersonAsync(factory, sub);
        await Members.GrantAsync(client, appId, sub, "editor");
        var foreign = await other.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative), new { name = "Ajeno", id = moduleId });
        Assert.Equal(HttpStatusCode.Created, foreign.StatusCode);

        var result = await JsonAsync(await ApplyWithIdAsync(client, snapshotId, applyId, operations), HttpStatusCode.OK);

        // No se lo atribuye: se deshace lo suyo y el módulo ajeno queda como estaba, sin lienzo ni vínculo.
        Assert.Equal("compensated", result.GetProperty("status").GetString());
        var modules = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal("Ajeno", Assert.Single(modules.EnumerateArray()).GetProperty("name").GetString());
        Assert.Equal(0, (await GraphAsync(client, moduleId)).GetProperty("version").GetInt32());
        await AssertBindingsAsync(appId, 0);
        var catalog = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(catalog.EnumerateArray());
    }

    [Fact]
    public async Task Si_falla_despues_de_que_alguien_edito_el_lienzo_se_compensa_sin_borrar_lo_editado()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var featureId = Guid.CreateVersion7();
        var draft = await DraftAsync(client, snapshotId, Create(TiendaFeature, featureId));

        using var faulty = WithCheckpoints(async (checkpoint, _) =>
        {
            if (checkpoint != "finalize")
            {
                return;
            }

            // Antes de terminar, una persona abre la feature y guarda un cambio.
            var graph = JsonNode.Parse((await GraphAsync(client, featureId)).GetRawText())!.AsObject();
            graph["nodes"]!.AsObject().First().Value!["title"] = "Escrito por una persona";
            var saved = await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph);
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
            throw new InvalidOperationException("fallo simulado");
        });
        using var failing = Authenticated(faulty);

        var result = await JsonAsync(await ApplyAsync(failing, snapshotId, Create(TiendaFeature, featureId, Canvas(draft))), HttpStatusCode.OK);

        Assert.Equal("compensated", result.GetProperty("status").GetString());
        Assert.Contains(Warnings(result), w => w == "compensation-kept");
        var graph = await GraphAsync(client, featureId);
        Assert.Equal(2, graph.GetProperty("version").GetInt32());
        Assert.Contains(graph.GetProperty("nodes").EnumerateObject(), n => n.Value.GetProperty("title").GetString() == "Escrito por una persona");
        await AssertBindingsAsync(appId, 0);
    }

    [Fact]
    public async Task Si_falla_sin_que_nadie_toque_nada_se_deshace_la_feature_y_su_lienzo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var featureId = Guid.CreateVersion7();
        var draft = await DraftAsync(client, snapshotId, Create(TiendaFeature, featureId));
        using var faulty = WithCheckpoints((checkpoint, _) => checkpoint == "finalize" ? throw new InvalidOperationException("fallo simulado") : Task.CompletedTask);
        using var failing = Authenticated(faulty);

        var result = await JsonAsync(await ApplyAsync(failing, snapshotId, Create(TiendaFeature, featureId, Canvas(draft))), HttpStatusCode.OK);

        Assert.Equal("compensated", result.GetProperty("status").GetString());
        Assert.Empty((await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Reanalizar_despues_de_editar_el_lienzo_no_lo_sobrescribe_ni_lo_crea_otra_vez()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var first = await UploadAsync(client, appId, Monorepo());
        var featureId = Guid.CreateVersion7();
        await CreateWithCanvasAsync(client, first, TiendaFeature, featureId);
        var graph = JsonNode.Parse((await GraphAsync(client, featureId)).GetRawText())!.AsObject();
        graph["nodes"]!.AsObject().First().Value!["notes"] = "Nota de una persona";
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph)).StatusCode);
        var edited = await GraphAsync(client, featureId);

        var second = await UploadAsync(client, appId, Monorepo(extraRoute: true));
        var review = await ReviewAsync(client, second);

        Assert.Equal("created", Item(review, "screen:tienda:/pedidos").GetProperty("status").GetString());
        Assert.True(JsonElement.DeepEquals(edited, await GraphAsync(client, featureId)));
        var again = await ApplyAsync(client, second, dryRun: true, Create(TiendaFeature, Guid.CreateVersion7()));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode); // ya tiene una decisión: no se crea otra vez
    }

    [Theory]
    [InlineData("encimadas")]
    [InlineData("claves")]
    [InlineData("id-v4")]
    [InlineData("pantalla-aparte")]
    public async Task Un_lienzo_mal_armado_se_rechaza_sin_escribir(string variant)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var snapshotId = await UploadAsync(client, appId, Monorepo());
        var featureId = Guid.CreateVersion7();
        var draft = await DraftAsync(client, snapshotId, Create(TiendaFeature, featureId));
        var canvas = Canvas(draft);
        var extra = new List<JsonObject>();
        switch (variant)
        {
            case "encimadas":
                foreach (var (_, position) in canvas["layout"]!.AsObject())
                {
                    position!["x"] = 0;
                    position["y"] = 0;
                }

                break;
            case "claves": canvas["nodes"]!.AsObject().Remove(canvas["nodes"]!.AsObject().First().Key); break;
            case "id-v4": canvas["nodes"]!.AsObject()[canvas["nodes"]!.AsObject().First().Key] = Guid.NewGuid().ToString(); break;
            case "pantalla-aparte": extra.Add(new JsonObject { ["op"] = "reject", ["entityKey"] = "screen:tienda:/pedidos", ["bindingVersion"] = 0 }); break;
        }

        var response = await ApplyAsync(client, snapshotId, [Create(TiendaFeature, featureId, canvas), .. extra]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!);
    }

    // ---------- El proyecto ----------

    private byte[] Monorepo(bool extraRoute = false) => Scan(new Dictionary<string, string>
    {
        ["src/Ventas.Api/Ventas.Api.csproj"] = """
            <Project Sdk="Microsoft.NET.Sdk.Web">
              <ItemGroup><ProjectReference Include="..\Pedidos\Pedidos.csproj" /></ItemGroup>
            </Project>
            """,
        ["src/Ventas.Api/Program.cs"] = "var app = WebApplication.CreateBuilder(args).Build();\nPedidos.Endpoints.Map(app);\napp.MapGet(\"/api/salud\", () => \"ok\");\napp.Run();\n",
        ["src/Pedidos/Pedidos.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
        ["src/Pedidos/Endpoints.cs"] = """
            namespace Pedidos;
            public static class Endpoints
            {
                public static void Map(WebApplication app)
                {
                    app.MapGet("/api/pedidos", () => 1);
                    app.MapGet("/api/pedidos/{id}", (int id) => 1);
                }
            }
            """,
        ["src/Compras.Api/Compras.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>",
        ["src/Compras.Api/Program.cs"] = "var app = WebApplication.CreateBuilder(args).Build();\napp.MapGet(\"/api/salud\", () => \"ok\");\napp.Run();\n",
        ["tienda/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["tienda/src/main.tsx"] = Routes(extraRoute),
        ["tienda/src/pages.tsx"] = """
            import { Link } from 'react-router-dom';
            export function Pedidos() {
              fetch('/api/pedidos');
              fetch('/api/salud');
              return <Link to="/pedidos/1">ver</Link>;
            }
            export function Pedido({ id }: { id: string }) {
              fetch(`/api/pedidos/${id}`);
              return <Link to="/pedidos">volver</Link>;
            }
            export const Ayuda = () => null;
            """,
        ["admin/package.json"] = """{ "name": "admin-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["admin/src/main.tsx"] = Routes(false),
        ["admin/src/pages.tsx"] = "export function Pedidos() { fetch('/api/pedidos'); return null; }\nexport const Pedido = () => null;\nexport const Ayuda = () => null;\n",
    }, "--source-id", source.ToString());

    private static string Routes(bool extra) =>
        "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos, Pedido, Ayuda } from './pages';\n"
        + "export const router = createBrowserRouter([\n"
        + "  { path: '/pedidos', element: <Pedidos /> },\n  { path: '/pedidos/:id', element: <Pedido /> },\n"
        + (extra ? "  { path: '/ayuda', element: <Ayuda /> },\n" : "")
        + "]);\n";

    // ---------- Lienzo: ids del cliente y posiciones en grilla ----------

    /// <summary>Lo que haría la web: un UUID v7 por clave del borrador y cajas en una grilla sin encimarse.</summary>
    private static JsonObject Canvas(JsonElement draft)
    {
        JsonObject Ids(string name) => new([.. draft.GetProperty(name).EnumerateArray()
            .Select(i => KeyValuePair.Create(i.GetProperty("key").GetString()!, (JsonNode?)Guid.CreateVersion7().ToString()))]);
        var layout = new JsonObject();
        var index = 0;
        foreach (var node in draft.GetProperty("nodes").EnumerateArray())
        {
            layout[node.GetProperty("key").GetString()!] = new JsonObject { ["x"] = index % 3 * 264, ["y"] = index / 3 * 160 };
            index++;
        }

        return new JsonObject { ["nodes"] = Ids("nodes"), ["edges"] = Ids("edges"), ["interfaces"] = Ids("interfaces"), ["layout"] = layout };
    }

    private static async Task<JsonElement> DraftAsync(HttpClient client, Guid snapshotId, params JsonObject[] operations)
    {
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, dryRun: true, operations), HttpStatusCode.OK);
        return Created(preview, operations[^1]["entityKey"]!.GetValue<string>()).GetProperty("canvas");
    }

    private static async Task<JsonElement> CreateWithCanvasAsync(HttpClient client, Guid snapshotId, string key, Guid id)
    {
        var draft = await DraftAsync(client, snapshotId, Create(key, id));
        return await JsonAsync(await ApplyAsync(client, snapshotId, Create(key, id, Canvas(draft))), HttpStatusCode.OK);
    }

    // ---------- API ----------

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Monorepo de prueba"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<(Guid Id, JsonElement Graph)> FeatureWithCanvasAsync(HttpClient client, Guid appId)
    {
        var feature = await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new { name = "Hecha a mano" }), HttpStatusCode.Created);
        var id = feature.GetProperty("id").GetGuid();
        var node = Guid.CreateVersion7().ToString();
        var graph = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0,
            ["nodes"] = new JsonObject { [node] = new JsonObject { ["id"] = node, ["type"] = "screen", ["title"] = "Inicio" } },
            ["edges"] = new JsonObject(),
            ["layout"] = new JsonObject { [node] = new JsonObject { ["x"] = 0, ["y"] = 0 } },
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{id}/canvas", UriKind.Relative), graph)).StatusCode);
        return (id, await GraphAsync(client, id));
    }

    private static async Task<Guid> CatalogItemAsync(HttpClient client, Guid appId, string title, string method, string path)
    {
        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
            new { type = "api", title, http = new { method, path } });
        return (await JsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    private static async Task<JsonElement> GraphAsync(HttpClient client, Guid featureId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)), HttpStatusCode.OK);

    private static async Task<Guid> UploadAsync(HttpClient client, Guid appId, byte[] pack) =>
        (await JsonAsync(await DiscoveryPacks.UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId)
    {
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryReview, review));
        return review;
    }

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, params JsonObject[] operations) =>
        ApplyAsync(client, snapshotId, dryRun: false, operations);

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, bool dryRun, params JsonObject[] operations) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative),
            new JsonObject { ["applyId"] = Guid.CreateVersion7().ToString(), ["operations"] = new JsonArray([.. operations.Select(o => o.DeepClone())]) });

    private static Task<HttpResponseMessage> ApplyWithIdAsync(HttpClient client, Guid snapshotId, Guid applyId, JsonObject[] operations) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative),
            new JsonObject { ["applyId"] = applyId.ToString(), ["operations"] = new JsonArray([.. operations.Select(o => o.DeepClone())]) });

    private static JsonObject Create(string key, Guid id, JsonObject? canvas = null)
    {
        var op = new JsonObject { ["op"] = "create", ["entityKey"] = key, ["id"] = id.ToString(), ["bindingVersion"] = 0 };
        if (canvas is not null)
        {
            op["canvas"] = canvas.DeepClone();
        }

        return op;
    }

    private static JsonObject Link(string key, Guid itemId) =>
        new() { ["op"] = "link", ["entityKey"] = key, ["target"] = new JsonObject { ["kind"] = "catalogItem", ["id"] = itemId.ToString() }, ["bindingVersion"] = 0 };

    private static JsonElement Created(JsonElement result, string key) =>
        result.GetProperty("created").EnumerateArray().Single(c => c.GetProperty("entityKey").GetString() == key);

    private static IEnumerable<string> Warnings(JsonElement result) =>
        result.GetProperty("warnings").EnumerateArray().Select(w => w.GetProperty("code").GetString()!);

    private static IEnumerable<string> Strings(JsonElement array, string field) =>
        array.EnumerateArray().Select(e => e.GetProperty(field).GetString()!);

    private static JsonElement Item(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);

    private WebApplicationFactory<Program> WithCheckpoints(Func<string, Guid, Task> reached) =>
        factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IApplyCheckpoints>(new TestCheckpoints(reached))));

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

    private sealed class TestCheckpoints(Func<string, Guid, Task> reached) : IApplyCheckpoints
    {
        public Task ReachedAsync(string checkpoint, Guid applyId) => reached(checkpoint, applyId);
    }
}
