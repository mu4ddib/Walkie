using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Reanalizar un proyecto en una app (spec walkie-live, tarea 10): la revisión del análisis nuevo dice qué apareció,
/// qué cambió, qué sigue igual, qué ya no aparece con cobertura suficiente y qué no se puede concluir, sin tocar nada de
/// lo documentado. Cada variante cambia una cosa del proyecto y se reanaliza con la CLI real y la misma fuente.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryReanalysisTests(WalkieApiFactory factory)
{
    private const string ListApi = "api:GET /api/pedidos";
    private const string DetailApi = "api:GET /api/pedidos/{}";
    private const string List = "screen:tienda:/pedidos";
    private const string Detail = "screen:tienda:/pedidos/{}";

    private readonly Guid source = Guid.CreateVersion7();

    [Theory]
    [InlineData("renombrar-package")]
    [InlineData("mover-archivo")]
    [InlineData("mover-app-con-ambito-fijado")]
    public async Task Renombrar_o_mover_sin_cambiar_la_identidad_deja_las_pantallas_sin_cambios(string variant)
    {
        var (client, appId, first) = await StartAsync(Project(pin: variant == "mover-app-con-ambito-fijado"));

        var review = await ReanalyzeAsync(client, appId, variant switch
        {
            "renombrar-package" => Project(packageName: "tienda-renombrada"),
            "mover-archivo" => Project(pagesAt: "src/vistas/pages.tsx"),
            _ => Project(appDir: "apps/tienda", pin: true),
        }, first);

        Assert.Equal("unchanged", Item(review, List).GetProperty("change").GetString());
        Assert.Equal("rejected", Item(review, Detail).GetProperty("status").GetString()); // 23: la decisión sigue
        Assert.Equal("unchanged", Item(review, Detail).GetProperty("change").GetString());
        Assert.Equal(0, review.GetProperty("counts").GetProperty("missing").GetInt32());
        Assert.Equal(0, review.GetProperty("counts").GetProperty("changed").GetInt32()); // sin cambios falsos
    }

    [Fact]
    public async Task Una_ruta_nueva_aparece_y_un_contrato_que_cambio_se_marca_sin_tocar_el_catalogo()
    {
        var (client, appId, first) = await StartAsync(Project());
        var before = await CatalogAsync(client, appId);

        var review = await ReanalyzeAsync(client, appId, Project(extraRoute: true, detailContract: "{pedidoId}"), first);

        // 19: la entidad nueva; 20: el contrato que cambió (decidido: changed; su elemento no se toca).
        Assert.Equal("added", Item(review, "screen:tienda:/ayuda").GetProperty("change").GetString());
        Assert.True(Item(review, "screen:tienda:/ayuda").GetProperty("needsReview").GetBoolean());
        Assert.Equal("modified", Item(review, DetailApi).GetProperty("change").GetString());
        Assert.Equal("changed", Item(review, DetailApi).GetProperty("status").GetString());
        Assert.True(Item(review, DetailApi).GetProperty("needsReview").GetBoolean());
        Assert.Equal("unchanged", Item(review, ListApi).GetProperty("change").GetString());
        var comparison = review.GetProperty("comparison");
        Assert.True(comparison.GetProperty("added").GetInt32() >= 1);
        Assert.Equal(1, comparison.GetProperty("modified").GetInt32());
        Assert.True(JsonElement.DeepEquals(before, await CatalogAsync(client, appId)));

        // Filtros en la API: solo lo que apareció, solo lo que pide una decisión.
        var added = await ReviewAsync(client, review.GetProperty("snapshotId").GetGuid(), "&change=added");
        Assert.All(added.GetProperty("items").EnumerateArray(), i => Assert.Equal("added", i.GetProperty("change").GetString()));
        var needs = await ReviewAsync(client, review.GetProperty("snapshotId").GetGuid(), "&needsReview=true");
        Assert.All(needs.GetProperty("items").EnumerateArray(), i => Assert.True(i.GetProperty("needsReview").GetBoolean()));
        Assert.Equal(comparison.GetProperty("needsReview").GetInt32(), needs.GetProperty("page").GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Una_ruta_decidida_que_se_borro_ya_no_aparece_con_cobertura_y_no_se_borra_nada()
    {
        var (client, appId, first) = await StartAsync(Project());

        var review = await ReanalyzeAsync(client, appId, Project(withDetail: false), first);

        // 21: react-router corrió sobre su archivo y no la vio: missing, con la decisión vigente.
        var gone = Item(review, Detail);
        Assert.Equal("missing", gone.GetProperty("status").GetString());
        Assert.Equal("rejected", gone.GetProperty("binding").GetProperty("decision").GetString());
        Assert.False(gone.TryGetProperty("change", out _));
        Assert.Equal(1, review.GetProperty("counts").GetProperty("missing").GetInt32());
    }

    [Fact]
    public async Task Un_analisis_parcial_no_da_falsas_desapariciones()
    {
        var (client, appId, first) = await StartAsync(Project());

        // 22: solo el backend (sin detectores del front): la pantalla decidida no se ve, pero no se concluye nada.
        var review = await ReanalyzeAsync(client, appId, Project(extra: ["--detectors", "csproj,aspnetcore-endpoints"]), first);

        Assert.Equal(0, review.GetProperty("counts").GetProperty("missing").GetInt32());
        var unverified = Item(review, Detail);
        Assert.Equal("unverified", unverified.GetProperty("status").GetString());
        Assert.Contains("react-router", unverified.GetProperty("coverage").GetString(), StringComparison.Ordinal);
        Assert.False(unverified.GetProperty("needsReview").GetBoolean());
        Assert.Equal("partial", (await LatestAsync(client, appId)).GetProperty("completeness").GetString());
    }

    [Fact]
    public async Task Reimportar_el_mismo_paquete_no_crea_otro_analisis()
    {
        var pack = Project();
        var (client, appId, first) = await StartAsync(pack);

        var again = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.OK);

        Assert.Equal("existing", again.GetProperty("status").GetString());
        Assert.Equal(first, again.GetProperty("snapshot").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Cada_app_tecnica_se_compara_por_separado()
    {
        var (client, appId, first) = await StartAsync(Project());

        // 25: una ruta nueva solo en admin; /pedidos de tienda y de admin siguen siendo dos.
        var review = await ReanalyzeAsync(client, appId, Project(adminExtra: true), first);

        Assert.Equal("added", Item(review, "screen:admin:/reportes").GetProperty("change").GetString());
        Assert.Equal("unchanged", Item(review, "screen:admin:/pedidos").GetProperty("change").GetString());
        Assert.Equal("unchanged", Item(review, List).GetProperty("change").GetString());
        Assert.DoesNotContain(review.GetProperty("items").EnumerateArray(), i => i.GetProperty("key").GetString() == "screen:tienda:/reportes");
    }

    [Fact]
    public async Task Reanalizar_no_toca_lienzos_interfaces_ni_tours()
    {
        var (client, appId, first) = await StartAsync(Project());
        // 26 y 27: un módulo con su interfaz y una feature con un tour, documentados a mano.
        var module = await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative),
            new { name = "Pedidos", id = Guid.CreateVersion7() }), HttpStatusCode.Created);
        var moduleId = module.GetProperty("id").GetGuid();
        var node = Guid.CreateVersion7().ToString();
        var iface = Guid.CreateVersion7().ToString();
        await PutAsync(client, moduleId, new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0,
            ["nodes"] = new JsonObject { [node] = new JsonObject { ["id"] = node, ["type"] = "api", ["title"] = "Lista", ["http"] = new JsonObject { ["method"] = "GET", ["path"] = "/api/pedidos" } } },
            ["edges"] = new JsonObject(), ["layout"] = new JsonObject { [node] = new JsonObject { ["x"] = 0, ["y"] = 0 } },
            ["interfaces"] = new JsonObject { [iface] = new JsonObject { ["id"] = iface, ["name"] = "Lista", ["kind"] = "provides", ["nodeId"] = node } },
        });
        var feature = await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new { name = "A mano" }), HttpStatusCode.Created);
        var featureId = feature.GetProperty("id").GetGuid();
        var screen = Guid.CreateVersion7().ToString();
        var tour = Guid.CreateVersion7().ToString();
        await PutAsync(client, featureId, new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0,
            ["nodes"] = new JsonObject { [screen] = new JsonObject { ["id"] = screen, ["type"] = "screen", ["title"] = "Pedidos" } },
            ["edges"] = new JsonObject(), ["layout"] = new JsonObject { [screen] = new JsonObject { ["x"] = 16, ["y"] = 24 } },
            ["tours"] = new JsonObject
            {
                [tour] = new JsonObject
                {
                    ["id"] = tour, ["name"] = "Recorrido", ["kind"] = "guide",
                    ["steps"] = new JsonArray(new JsonObject { ["id"] = Guid.CreateVersion7().ToString(), ["nodeId"] = screen, ["note"] = "Aquí empieza" }),
                },
            },
        });
        var moduleBefore = await GraphAsync(client, moduleId);
        var featureBefore = await GraphAsync(client, featureId);

        await ReanalyzeAsync(client, appId, Project(extraRoute: true, withDetail: false, detailContract: "{pedidoId}"), first);

        Assert.True(JsonElement.DeepEquals(moduleBefore, await GraphAsync(client, moduleId)));
        Assert.True(JsonElement.DeepEquals(featureBefore, await GraphAsync(client, featureId)));
    }

    // ---------- El proyecto ----------

    private byte[] Project(
        string appDir = "tienda", string packageName = "tienda-web", string pagesAt = "src/pages.tsx", bool withDetail = true,
        bool extraRoute = false, string detailContract = "{id}", bool adminExtra = false, bool pin = false, params string[] extra)
    {
        var routes = "import { createBrowserRouter } from 'react-router-dom';\n"
            + $"import {{ Pedidos, Pedido, Ayuda }} from './{Path.ChangeExtension(pagesAt, null)!["src/".Length..]}';\n"
            + "export const router = createBrowserRouter([\n  { path: '/pedidos', element: <Pedidos /> },\n"
            + (withDetail ? "  { path: '/pedidos/:id', element: <Pedido /> },\n" : "")
            + (extraRoute ? "  { path: '/ayuda', element: <Ayuda /> },\n" : "")
            + "]);\n";
        var files = new Dictionary<string, string>
        {
            ["src/Tienda.Api/Tienda.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>",
            ["src/Tienda.Api/Program.cs"] = "var app = WebApplication.CreateBuilder(args).Build();\n"
                + "app.MapGet(\"/api/pedidos\", () => 1);\n"
                + $"app.MapGet(\"/api/pedidos/{detailContract}\", (int pedidoId) => 1);\napp.Run();\n",
            [$"{appDir}/package.json"] = $$"""{ "name": "{{packageName}}", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
            [$"{appDir}/src/main.tsx"] = routes,
            [$"{appDir}/{pagesAt}"] = "export function Pedidos() { fetch('/api/pedidos'); return null; }\nexport const Pedido = () => null;\nexport const Ayuda = () => null;\n",
            ["admin/package.json"] = """{ "name": "admin-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
            ["admin/src/main.tsx"] = "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos, Reportes } from './pages';\n"
                + "export const router = createBrowserRouter([\n  { path: '/pedidos', element: <Pedidos /> },\n"
                + (adminExtra ? "  { path: '/reportes', element: <Reportes /> },\n" : "") + "]);\n",
            ["admin/src/pages.tsx"] = "export const Pedidos = () => null;\nexport const Reportes = () => null;\n",
        };
        if (pin)
        {
            files[".walkie/source.json"] = $$"""{ "id": "{{source}}", "apps": { "{{appDir}}": "tienda" } }""";
        }

        return Scan(files, ["--source-id", source.ToString(), .. extra]);
    }

    // ---------- Flujo ----------

    /// <summary>Una app con el primer análisis y dos decisiones: la lista de la API creada en el catálogo y el detalle descartado.</summary>
    private async Task<(HttpClient Client, Guid AppId, Guid Snapshot)> StartAsync(byte[] pack)
    {
        var client = factory.CreateAuthenticatedClient();
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Reanálisis " + Guid.NewGuid().ToString("N")[..6]));
        var appId = (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var snapshot = (await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        var decided = await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshot}/apply", UriKind.Relative), new JsonObject
        {
            ["applyId"] = Guid.CreateVersion7().ToString(),
            ["operations"] = new JsonArray(
                new JsonObject { ["op"] = "create", ["entityKey"] = DetailApi, ["id"] = Guid.CreateVersion7().ToString(), ["bindingVersion"] = 0 },
                new JsonObject { ["op"] = "reject", ["entityKey"] = Detail, ["bindingVersion"] = 0 }),
        });
        Assert.Equal(HttpStatusCode.OK, decided.StatusCode);
        return (client, appId, snapshot);
    }

    private static async Task<JsonElement> ReanalyzeAsync(HttpClient client, Guid appId, byte[] pack, Guid previous)
    {
        var upload = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created);
        // El resumen de la subida ya dice con qué análisis se comparará.
        Assert.Equal(previous, upload.GetProperty("summary").GetProperty("previous").GetProperty("id").GetGuid());
        var review = await ReviewAsync(client, upload.GetProperty("snapshot").GetProperty("id").GetGuid(), "");
        Assert.Equal(previous, review.GetProperty("previous").GetProperty("id").GetGuid());
        return review;
    }

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId, string query)
    {
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500{query}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryReview, review));
        return review;
    }

    private static async Task<JsonElement> LatestAsync(HttpClient client, Guid appId) =>
        (await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/sources", UriKind.Relative)), HttpStatusCode.OK))
            .GetProperty("sources")[0].GetProperty("latestSnapshot");

    private static async Task<JsonElement> CatalogAsync(HttpClient client, Guid appId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);

    private static async Task<JsonElement> GraphAsync(HttpClient client, Guid featureId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)), HttpStatusCode.OK);

    private static async Task PutAsync(HttpClient client, Guid featureId, JsonObject graph) =>
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph)).StatusCode);

    private static JsonElement Item(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);
}
