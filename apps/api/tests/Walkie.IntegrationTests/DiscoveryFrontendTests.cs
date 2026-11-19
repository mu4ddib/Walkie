using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Un análisis de front (spec walkie-live, tarea 8) entra por la API de siempre: la subida lo valida, la revisión muestra
/// pantallas y candidatos a feature con su evidencia y, en un reanálisis, lo decidido que ya no aparece se marca sin
/// borrar nada. Crear pantallas o features sigue fuera (tarea 9). Paquetes de la CLI real; datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryFrontendTests(WalkieApiFactory factory)
{
    private readonly string source = Guid.CreateVersion7().ToString();

    [Fact]
    public async Task Un_paquete_de_front_se_sube_y_se_revisa_con_pantallas_features_y_su_evidencia()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var snapshotId = await UploadAsync(client, appId, Pack(withLogin: true));
        var review = await ReviewAsync(client, snapshotId);

        var screens = Keys(review, "screen");
        Assert.Equal(["screen:web:/login", "screen:web:/pedidos", "screen:web:/pedidos/{}"], screens);
        var feature = Item(review, "feature:web:Pedidos");
        Assert.Equal("inferred", feature.GetProperty("basis").GetString());
        Assert.Equal("create", feature.GetProperty("proposal").GetProperty("op").GetString());
        Assert.Equal("none", Item(review, "screen:web:/pedidos").GetProperty("proposal").GetProperty("op").GetString()); // entra con su feature
        Assert.Equal("new", Item(review, "api:GET /api/pedidos").GetProperty("status").GetString());

        var evidence = await JsonAsync(await client.GetAsync(new Uri(
            $"/api/snapshots/{snapshotId}/evidence?entityKey={Uri.EscapeDataString("screen:web:/pedidos/{}")}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryEvidence, evidence));
        Assert.Equal("react-router", evidence.GetProperty("evidence")[0].GetProperty("detector").GetString());
        Assert.Equal("web/src/main.tsx", evidence.GetProperty("evidence")[0].GetProperty("path").GetString());

        // Una pantalla no se crea sola, y una feature no se crea sin su lienzo inicial (tarea 9: ids y posiciones del cliente).
        foreach (var key in new[] { "screen:web:/pedidos", "feature:web:Pedidos" })
        {
            var refused = await ApplyAsync(client, snapshotId, new JsonObject { ["op"] = "create", ["entityKey"] = key, ["id"] = Guid.CreateVersion7().ToString() });
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        }

        Assert.Empty(await client.GetFromJsonAsync<JsonElement[]>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)) ?? []);
    }

    [Fact]
    public async Task Una_pantalla_decidida_que_ya_no_esta_en_el_codigo_se_marca_sin_borrar_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var first = await UploadAsync(client, appId, Pack(withLogin: true));
        var decided = await ApplyAsync(client, first, new JsonObject { ["op"] = "reject", ["entityKey"] = "screen:web:/login", ["bindingVersion"] = 0 });
        Assert.Equal(HttpStatusCode.OK, decided.StatusCode);

        var second = await UploadAsync(client, appId, Pack(withLogin: false));
        var review = await ReviewAsync(client, second);

        var missing = Item(review, "screen:web:/login");
        Assert.Equal("missing", missing.GetProperty("status").GetString()); // react-router corrió y miró ese archivo
        Assert.Equal("rejected", missing.GetProperty("binding").GetProperty("decision").GetString());
        Assert.Equal("new", Item(review, "screen:web:/pedidos").GetProperty("status").GetString());
    }

    private byte[] Pack(bool withLogin) => Scan(new Dictionary<string, string>
    {
        ["web/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["web/src/main.tsx"] =
            "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos, Pedido, Login } from './pages';\n"
            + "export const router = createBrowserRouter([\n"
            + "  { path: '/pedidos', element: <Pedidos /> },\n"
            + "  { path: '/pedidos/:id', element: <Pedido /> },\n"
            + (withLogin ? "  { path: '/login', element: <Login /> },\n" : "")
            + "]);\n",
        ["web/src/pages.tsx"] =
            "export function Pedidos() { fetch('/api/pedidos'); return null; }\nexport const Pedido = () => null;\nexport const Login = () => null;\n",
    }, "--source-id", source);

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Tienda de prueba"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> UploadAsync(HttpClient client, Guid appId, byte[] pack) =>
        (await JsonAsync(await DiscoveryPacks.UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId)
    {
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryReview, review));
        return review;
    }

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, JsonObject operation) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative),
            new JsonObject { ["applyId"] = Guid.CreateVersion7().ToString(), ["operations"] = new JsonArray(operation) });

    private static string[] Keys(JsonElement review, string kind) =>
        [.. review.GetProperty("items").EnumerateArray().Where(i => i.GetProperty("kind").GetString() == kind).Select(i => i.GetProperty("key").GetString()!)];

    private static JsonElement Item(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);
}
