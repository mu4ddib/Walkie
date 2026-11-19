using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Verificación no destructiva de Walkie Live (spec walkie-live, tarea 11, punto 4): una app ya documentada a mano
/// (catálogo editado, un módulo con interfaces, features con grupos, notas, tours, portal, conexión a una interfaz,
/// posiciones manuales y el mapa acomodado) recibe varios análisis y decisiones compatibles —vincular, descartar, crear
/// en el catálogo, crear un módulo y una feature—, reintentos con el mismo <c>applyId</c>, una decisión sobre un análisis
/// viejo y cambios manuales posteriores. Se compara contenido y versión de todo lo que existía y de lo editado después:
/// la evidencia nunca reemplaza documentación humana.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryNonDestructiveTests(WalkieApiFactory factory)
{
    private const string ListApi = "api:GET /api/pedidos";
    private const string DetailApi = "api:GET /api/pedidos/{}";
    private const string CreateApi = "api:POST /api/pedidos";
    private const string HealthApi = "api:GET /api/salud";
    private const string Feature = "feature:tienda:Pedidos";
    private const string Module = "module:Pedidos";

    private readonly Guid source = Guid.CreateVersion7();

    [Fact]
    public async Task Analisis_y_decisiones_compatibles_no_cambian_nada_de_lo_documentado_a_mano()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = (await JsonAsync(await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Documentada a mano")), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();

        // ---------- Lo documentado a mano ----------
        var listItem = await CatalogAsync(client, appId, new { type = "api", title = "Lista de pedidos", http = new { method = "GET", path = "/api/pedidos" } });
        await EditCatalogAsync(client, listItem, "Listado paginado; lo escribió el equipo.");
        var dbItem = await CatalogAsync(client, appId, new { type = "database", title = "Base de pedidos" });

        var moduleId = Guid.CreateVersion7();
        await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative), new { id = moduleId, name = "Pedidos (a mano)" }), HttpStatusCode.Created);
        await SaveTwiceAsync(client, moduleId, ModuleGraph(listItem));

        var other = await FeatureAsync(client, appId, "Perfil");
        await SaveTwiceAsync(client, other, Simple("Mi perfil"));
        var checkout = await FeatureAsync(client, appId, "Checkout");
        await SaveTwiceAsync(client, checkout, Documented(listItem, dbItem, moduleId, other));

        var map = new JsonObject { ["version"] = 0, ["positions"] = new JsonObject { [checkout.ToString()] = new JsonObject { ["x"] = 640, ["y"] = 320 } } };
        await JsonAsync(await client.PutAsJsonAsync(new Uri($"/api/apps/{appId}/map/layout", UriKind.Relative), map), HttpStatusCode.OK);

        var before = await StateAsync(client, appId);
        Assert.All(before.Canvases.Values, c => Assert.Equal(2, c.GetProperty("version").GetInt32()));

        // ---------- Análisis y decisiones compatibles ----------
        var first = await UploadAsync(client, appId, Project(extraRoute: false));
        await JsonAsync(await ApplyAsync(client, first, Guid.CreateVersion7(), Link(ListApi, listItem), Reject(HealthApi)), HttpStatusCode.OK);

        var detailId = Guid.CreateVersion7();
        var createId = Guid.CreateVersion7();
        var featureId = Guid.CreateVersion7();
        var newModuleId = Guid.CreateVersion7();
        var moduleDraft = await DraftAsync(client, first, Create(DetailApi, detailId), Create(CreateApi, createId), Create(Module, newModuleId));
        var featureDraft = await DraftAsync(client, first, Create(DetailApi, detailId), Create(CreateApi, createId), Create(Module, newModuleId), Create(Feature, featureId));
        JsonObject[] operations = [Create(DetailApi, detailId), Create(CreateApi, createId), Create(Module, newModuleId, Canvas(moduleDraft)), Create(Feature, featureId, Canvas(featureDraft))];
        var applyId = Guid.CreateVersion7();
        var done = await JsonAsync(await ApplyAsync(client, first, applyId, operations), HttpStatusCode.OK);
        Assert.Equal("completed", done.GetProperty("status").GetString());

        // El mismo applyId otra vez (reintento, doble clic): el resultado guardado, nada nuevo.
        var again = await JsonAsync(await ApplyAsync(client, first, applyId, operations), HttpStatusCode.OK);
        Assert.True(JsonElement.DeepEquals(done.GetProperty("created"), again.GetProperty("created")));
        // Lo mismo con otro applyId: los hallazgos ya están decididos (409), no se crea un segundo elemento.
        Assert.Equal(HttpStatusCode.Conflict, (await ApplyAsync(client, first, Guid.CreateVersion7(), Create(DetailApi, Guid.CreateVersion7()))).StatusCode);

        // Lo creado se edita a mano después de crearlo.
        await EditCatalogAsync(client, detailId, "Detalle con el estado del envío; corregido a mano.");
        await RenameAsync(client, featureId, "Pedidos (revisada)");
        var created = await GraphAsync(client, featureId);
        var edited = JsonNode.Parse(created.GetRawText())!.AsObject();
        var note = Guid.CreateVersion7().ToString();
        edited["stickyNotes"] = new JsonObject { [note] = new JsonObject { ["id"] = note, ["text"] = "Revisado con el equipo" } };
        edited["layout"]![note] = new JsonObject { ["x"] = 900, ["y"] = 40 };
        await JsonAsync(await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), edited), HttpStatusCode.OK);
        var after = await StateAsync(client, appId);

        // Reanálisis: una pantalla nueva y el mismo contenido para lo demás.
        var second = await UploadAsync(client, appId, Project(extraRoute: true));
        // El análisis anterior ya no acepta decisiones; el nuevo sí, y solo sobre lo que no estaba decidido.
        Assert.Equal(HttpStatusCode.Conflict, (await ApplyAsync(client, first, Guid.CreateVersion7(), Reject("screen:tienda:/pedidos"))).StatusCode);
        var review = await ReviewAsync(client, second);
        Assert.Equal("linked", Item(review, ListApi).GetProperty("status").GetString());
        Assert.Equal("rejected", Item(review, HealthApi).GetProperty("status").GetString());
        Assert.Equal("created", Item(review, DetailApi).GetProperty("status").GetString());
        Assert.Equal("created", Item(review, Feature).GetProperty("status").GetString());
        Assert.Equal("added", Item(review, "screen:tienda:/ayuda").GetProperty("change").GetString());
        await JsonAsync(await ApplyAsync(client, second, Guid.CreateVersion7(), Reject("screen:tienda:/ayuda")), HttpStatusCode.OK);

        // El mismo paquete otra vez: el análisis existente, nada nuevo.
        var repeat = await JsonAsync(await DiscoveryPacks.UploadAsync(client, appId, Project(extraRoute: true)), HttpStatusCode.OK);
        Assert.Equal("existing", repeat.GetProperty("status").GetString());

        // ---------- Nada de lo documentado cambió ----------
        var final = await StateAsync(client, appId);
        foreach (var (id, canvas) in before.Canvases)
        {
            Assert.True(JsonElement.DeepEquals(canvas, final.Canvases[id]), $"El lienzo {id} cambió");
        }

        foreach (var (id, item) in before.Catalog)
        {
            Assert.True(JsonElement.DeepEquals(item, final.Catalog[id]), $"El elemento {id} del catálogo cambió");
        }

        Assert.True(JsonElement.DeepEquals(before.Map, final.Map));
        Assert.True(before.Features.All(f => final.Features.Contains(f)));
        // Ni lo editado después de crearlo: nombre, lienzo con su nota y elemento corregido.
        Assert.True(JsonElement.DeepEquals(after.Canvases[featureId], final.Canvases[featureId]));
        Assert.Equal(2, final.Canvases[featureId].GetProperty("version").GetInt32());
        Assert.True(JsonElement.DeepEquals(after.Catalog[detailId], final.Catalog[detailId]));
        Assert.Contains("Pedidos (revisada)", final.Features);
        // Lo único nuevo es lo que se aprobó: dos APIs en el catálogo, un módulo y una feature.
        Assert.Equal(before.Catalog.Count + 2, final.Catalog.Count);
        Assert.Equal(before.Canvases.Count + 2, final.Canvases.Count);
    }

    // ---------- Proyecto ficticio: backend con un módulo de pedidos y un front React ----------

    private byte[] Project(bool extraRoute) => Scan(new Dictionary<string, string>
    {
        ["src/Tienda.Api/Tienda.Api.csproj"] = """
            <Project Sdk="Microsoft.NET.Sdk.Web">
              <ItemGroup><ProjectReference Include="..\Pedidos\Pedidos.csproj" /></ItemGroup>
            </Project>
            """,
        ["src/Tienda.Api/Program.cs"] = "var app = WebApplication.CreateBuilder(args).Build();\nPedidos.Endpoints.Map(app);\napp.MapGet(\"/api/salud\", () => \"ok\");\napp.Run();\n",
        ["src/Pedidos/Pedidos.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
        ["src/Pedidos/Endpoints.cs"] = """
            namespace Pedidos;
            public static class Endpoints
            {
                public static void Map(WebApplication app)
                {
                    app.MapGet("/api/pedidos", () => 1);
                    app.MapGet("/api/pedidos/{id}", (int id) => 1);
                    app.MapPost("/api/pedidos", () => 1);
                }
            }
            """,
        ["tienda/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["tienda/src/main.tsx"] =
            "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos, Pedido, Ayuda } from './pages';\n"
            + "export const router = createBrowserRouter([\n"
            + "  { path: '/pedidos', element: <Pedidos /> },\n  { path: '/pedidos/:id', element: <Pedido /> },\n"
            + (extraRoute ? "  { path: '/ayuda', element: <Ayuda /> },\n" : "")
            + "]);\n",
        ["tienda/src/pages.tsx"] = """
            import { Link } from 'react-router-dom';
            export function Pedidos() { fetch('/api/pedidos'); return <Link to="/pedidos/1">ver</Link>; }
            export function Pedido({ id }: { id: string }) { fetch(`/api/pedidos/${id}`); return <Link to="/pedidos">volver</Link>; }
            export const Ayuda = () => null;
            """,
    }, "--source-id", source.ToString());

    // ---------- Lienzos documentados a mano ----------

    private static JsonObject Simple(string title) => Graph(
        new JsonObject { ["p1"] = new JsonObject { ["id"] = "p1", ["type"] = "screen", ["title"] = title } },
        new JsonObject(),
        new JsonObject { ["p1"] = Pos(56, 104) });

    private static JsonObject ModuleGraph(Guid listItem)
    {
        var graph = Graph(
            new JsonObject
            {
                ["a1"] = new JsonObject { ["id"] = "a1", ["type"] = "ref", ["title"] = "Lista de pedidos", ["catalogId"] = listItem.ToString() },
                ["a2"] = new JsonObject { ["id"] = "a2", ["type"] = "api", ["title"] = "Anular pedido", ["http"] = new JsonObject { ["method"] = "DELETE", ["path"] = "/api/pedidos/{id}" } },
            },
            new JsonObject(),
            new JsonObject { ["a1"] = Pos(24, 40), ["a2"] = Pos(24, 216) });
        graph["interfaces"] = new JsonObject
        {
            ["listar"] = new JsonObject { ["id"] = "listar", ["name"] = "Listar pedidos", ["kind"] = "provides", ["nodeId"] = "a1" },
            ["anular"] = new JsonObject { ["id"] = "anular", ["name"] = "Anular pedido", ["kind"] = "provides", ["nodeId"] = "a2" },
        };
        return graph;
    }

    /// <summary>Una feature con pantalla, `ref`, base, módulo (por su interfaz), portal, grupo, nota, tour y posiciones a mano.</summary>
    private static JsonObject Documented(Guid listItem, Guid dbItem, Guid moduleId, Guid portalTarget)
    {
        var graph = Graph(
            new JsonObject
            {
                ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Carrito", ["description"] = "Lo que el cliente ve antes de pagar.", ["groupId"] = "g1" },
                ["r1"] = new JsonObject { ["id"] = "r1", ["type"] = "ref", ["title"] = "Lista de pedidos", ["catalogId"] = listItem.ToString() },
                ["d1"] = new JsonObject { ["id"] = "d1", ["type"] = "ref", ["title"] = "Base de pedidos", ["catalogId"] = dbItem.ToString() },
                ["m1"] = new JsonObject { ["id"] = "m1", ["type"] = "module", ["title"] = "Pedidos (a mano)", ["moduleId"] = moduleId.ToString() },
                ["p1"] = new JsonObject { ["id"] = "p1", ["type"] = "portal", ["title"] = "Perfil", ["targetFeatureId"] = portalTarget.ToString() },
                ["rule"] = new JsonObject { ["id"] = "rule", ["type"] = "rule", ["title"] = "Monto mínimo", ["expression"] = "total >= 10" },
            },
            new JsonObject
            {
                ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "r1", ["kind"] = "request", ["label"] = "carga la lista" },
                ["e2"] = new JsonObject { ["id"] = "e2", ["from"] = "s1", ["to"] = "m1", ["kind"] = "request", ["toInterface"] = new JsonObject { ["id"] = "anular", ["name"] = "Anular pedido" } },
                ["e3"] = new JsonObject { ["id"] = "e3", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" },
                ["e4"] = new JsonObject { ["id"] = "e4", ["from"] = "r1", ["to"] = "d1", ["kind"] = "reads" },
            },
            new JsonObject
            {
                ["s1"] = Pos(72, 96), ["r1"] = Pos(424, 72), ["d1"] = Pos(744, 72), ["m1"] = new JsonObject { ["x"] = 424, ["y"] = 296, ["w"] = 280 },
                ["p1"] = Pos(72, 400), ["rule"] = Pos(744, 312), ["k1"] = Pos(744, 504),
                ["g1"] = new JsonObject { ["x"] = 40, ["y"] = 40, ["w"] = 296, ["h"] = 224 },
            });
        graph["groups"] = new JsonObject { ["g1"] = new JsonObject { ["id"] = "g1", ["title"] = "Front", ["kind"] = "frontend" } };
        graph["stickyNotes"] = new JsonObject { ["k1"] = new JsonObject { ["id"] = "k1", ["text"] = "Acordado con negocio: el monto mínimo es 10." } };
        graph["groupNesting"] = "explicit";
        graph["tours"] = new JsonObject
        {
            ["t1"] = new JsonObject
            {
                ["id"] = "t1", ["name"] = "Primer pedido", ["kind"] = "guide",
                ["steps"] = new JsonArray(
                    new JsonObject { ["id"] = "st1", ["nodeId"] = "s1", ["note"] = "Empieza en el carrito." },
                    new JsonObject { ["id"] = "st2", ["nodeId"] = "r1", ["note"] = "Carga los pedidos." }),
            },
        };
        return graph;
    }

    private static JsonObject Graph(JsonObject nodes, JsonObject edges, JsonObject layout) => new()
    {
        ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = nodes, ["edges"] = edges, ["layout"] = layout,
    };

    private static JsonObject Pos(int x, int y) => new() { ["x"] = x, ["y"] = y };

    // ---------- Estado de la app: todo lo que no debe cambiar ----------

    private sealed record AppState(Dictionary<Guid, JsonElement> Canvases, Dictionary<Guid, JsonElement> Catalog, List<string> Features, JsonElement Map);

    private static async Task<AppState> StateAsync(HttpClient client, Guid appId)
    {
        var features = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative)), HttpStatusCode.OK);
        var modules = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative)), HttpStatusCode.OK);
        var ids = features.EnumerateArray().Select(f => f.GetProperty("id").GetGuid())
            .Concat(modules.EnumerateArray().Select(m => m.GetProperty("id").GetGuid()));
        var canvases = new Dictionary<Guid, JsonElement>();
        foreach (var id in ids)
        {
            var response = await client.GetAsync(new Uri($"/api/features/{id}/canvas", UriKind.Relative));
            if (response.StatusCode == HttpStatusCode.OK)
            {
                canvases[id] = await response.Content.ReadFromJsonAsync<JsonElement>();
            }
        }

        var catalog = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);
        var map = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/map", UriKind.Relative)), HttpStatusCode.OK);
        return new AppState(
            canvases,
            catalog.EnumerateArray().ToDictionary(i => i.GetProperty("id").GetGuid(), i => i.Clone()),
            [.. features.EnumerateArray().Select(f => f.GetProperty("name").GetString()!)
                .Concat(modules.EnumerateArray().Select(m => m.GetProperty("name").GetString()!))],
            map.GetProperty("layout").Clone());
    }

    // ---------- API ----------

    private static async Task<Guid> CatalogAsync(HttpClient client, Guid appId, object item) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), item), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task EditCatalogAsync(HttpClient client, Guid itemId, string description)
    {
        var item = await JsonAsync(await client.GetAsync(new Uri($"/api/catalog/{itemId}", UriKind.Relative)), HttpStatusCode.OK);
        var body = JsonNode.Parse(item.GetRawText())!.AsObject();
        body["description"] = description;
        await JsonAsync(await client.PutAsJsonAsync(new Uri($"/api/catalog/{itemId}", UriKind.Relative), body), HttpStatusCode.OK);
    }

    private static async Task<Guid> FeatureAsync(HttpClient client, Guid appId, string name) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new { name }), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task RenameAsync(HttpClient client, Guid featureId, string name) =>
        await JsonAsync(await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}", UriKind.Relative), new { name }), HttpStatusCode.OK);

    /// <summary>Guarda el lienzo y lo vuelve a guardar movido (versión 2): un lienzo trabajado, no el primero.</summary>
    private static async Task SaveTwiceAsync(HttpClient client, Guid featureId, JsonObject graph)
    {
        var uri = new Uri($"/api/features/{featureId}/canvas", UriKind.Relative);
        await JsonAsync(await client.PutAsJsonAsync(uri, graph), HttpStatusCode.OK);
        var moved = graph.DeepClone().AsObject();
        moved["version"] = 1;
        foreach (var (_, position) in moved["layout"]!.AsObject())
        {
            position!["x"] = position["x"]!.GetValue<int>() + 8;
        }

        await JsonAsync(await client.PutAsJsonAsync(uri, moved), HttpStatusCode.OK);
    }

    private static async Task<JsonElement> GraphAsync(HttpClient client, Guid featureId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)), HttpStatusCode.OK);

    private static async Task<Guid> UploadAsync(HttpClient client, Guid appId, byte[] pack) =>
        (await JsonAsync(await DiscoveryPacks.UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500", UriKind.Relative)), HttpStatusCode.OK);

    private static JsonElement Item(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, Guid applyId, params JsonObject[] operations) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative),
            new JsonObject { ["applyId"] = applyId.ToString(), ["operations"] = new JsonArray([.. operations.Select(o => o.DeepClone())]) });

    private static async Task<JsonElement> DraftAsync(HttpClient client, Guid snapshotId, params JsonObject[] operations)
    {
        var preview = await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply?dryRun=true", UriKind.Relative),
            new JsonObject { ["applyId"] = Guid.CreateVersion7().ToString(), ["operations"] = new JsonArray([.. operations.Select(o => o.DeepClone())]) }), HttpStatusCode.OK);
        var key = operations[^1]["entityKey"]!.GetValue<string>();
        return preview.GetProperty("created").EnumerateArray().Single(c => c.GetProperty("entityKey").GetString() == key).GetProperty("canvas");
    }

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

    private static JsonObject Reject(string key) => new() { ["op"] = "reject", ["entityKey"] = key, ["bindingVersion"] = 0 };
}
