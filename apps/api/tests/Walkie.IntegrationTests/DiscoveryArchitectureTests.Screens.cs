using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Features;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Pantallas independientes (spec walkie-live-documentacion, parte 2; ADR-0018): una pantalla que ninguna propuesta
/// incluye (la de inicio, <c>/</c>) se puede convertir en una feature o incorporar a una feature existente. Incorporar
/// solo agrega: nada de lo que ya está en el lienzo se mueve ni cambia, con la versión vista (409 si cambió), un reintento
/// no duplica y un fallo a mitad quita lo agregado si nadie lo tocó.
/// </summary>
public sealed partial class DiscoveryArchitectureTests
{
    private const string Home = "screen:web:/";
    private const string ListApi = "api:GET /api/pedidos";

    [Fact]
    public async Task Una_pantalla_suelta_se_convierte_en_una_feature_con_sus_llamadas_y_un_portal_a_lo_documentado()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (appId, snapshotId, pedidos, apis) = await ShopDocumentedAsync(client, "Inicio suelto");

        // La pantalla de inicio no está en ninguna propuesta.
        var proposals = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray();
        Assert.DoesNotContain(proposals, p => p.GetProperty("members").EnumerateArray().Any(m => m.GetString() == Home));

        // Vista previa: la pantalla con su ruta, su llamada a una API ya en el catálogo y un portal a la feature «Pedidos».
        var featureId = Guid.CreateVersion7();
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Create(Home, featureId)]), HttpStatusCode.OK);
        var draft = Created(preview, Home).GetProperty("canvas");
        var nodes = draft.GetProperty("nodes").EnumerateArray().ToList();
        Assert.Contains(nodes, n => n.GetProperty("type").GetString() == "screen" && n.GetProperty("route").GetString() == "/");
        Assert.Contains(nodes, n => n.GetProperty("type").GetString() == "ref" && n.GetProperty("catalogId").GetGuid() == apis[ListApi]);
        Assert.Contains(nodes, n => n.GetProperty("type").GetString() == "portal" && n.GetProperty("targetFeatureId").GetGuid() == pedidos);
        var kinds = draft.GetProperty("edges").EnumerateArray().Select(e => e.GetProperty("kind").GetString()).Order().ToList();
        Assert.Equal(["navigation", "request"], kinds);
        Assert.DoesNotContain(draft.GetProperty("omitted").EnumerateArray(), o => o.GetProperty("code").GetString() == "api-undecided");

        // Confirmar con otro nombre; un reintento con el mismo applyId no crea otra.
        var applyId = Guid.CreateVersion7();
        var create = Create(Home, featureId, Canvas(draft));
        create["name"] = "Inicio";
        var result = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, false, [create]), HttpStatusCode.OK);
        Assert.Equal("completed", result.GetProperty("status").GetString());
        Assert.Equal("Inicio", Created(result, Home).GetProperty("target").GetProperty("title").GetString());
        await JsonAsync(await ApplyAsync(client, snapshotId, applyId, false, [create]), HttpStatusCode.OK);
        var features = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Single(features.EnumerateArray(), f => f.GetProperty("name").GetString() == "Inicio");

        var graph = await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(3, graph.GetProperty("nodes").EnumerateObject().Count());
        Assert.Contains(graph.GetProperty("nodes").EnumerateObject(), n => n.Value.GetProperty("type").GetString() == "portal"
            && n.Value.GetProperty("targetFeatureId").GetGuid() == pedidos);

        // Procedencia: la pantalla queda creada hacia la feature y «De dónde viene» la encuentra.
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?key={Uri.EscapeDataString(Home)}", UriKind.Relative)), HttpStatusCode.OK);
        var item = review.GetProperty("items").EnumerateArray().Single();
        Assert.Equal("created", item.GetProperty("status").GetString());
        Assert.Equal(featureId, item.GetProperty("binding").GetProperty("target").GetProperty("id").GetGuid());
        var provenance = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/bindings?target=feature:{featureId}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Contains(provenance.GetProperty("bindings").EnumerateArray(), b => b.GetProperty("binding").GetProperty("entityKey").GetString() == Home);
    }

    [Fact]
    public async Task Incorporar_una_pantalla_a_una_feature_existente_solo_agrega_con_la_version_vista_y_sin_duplicar()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (appId, snapshotId, pedidos, apis) = await ShopDocumentedAsync(client, "Inicio incorporado");
        await PutTourAsync(client, pedidos);
        var before = await GraphAsync(client, pedidos);

        // Vista previa: lo que ya tiene el lienzo, lo nuevo y lo que se reutiliza (el ref de la lista ya está).
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, pedidos, null, null)]), HttpStatusCode.OK);
        Assert.Empty(Walkie.Shared.Schemas.WalkieSchemas.Errors(Walkie.Shared.Schemas.WalkieSchemas.DiscoveryApplyResult, preview));
        var attached = preview.GetProperty("attached").EnumerateArray().Single();
        Assert.Equal(before.GetProperty("version").GetInt32(), attached.GetProperty("canvasVersion").GetInt32());
        Assert.Equal(before.GetProperty("nodes").EnumerateObject().Count(), attached.GetProperty("existing").GetProperty("nodes").GetInt32());
        Assert.Equal(1, attached.GetProperty("existing").GetProperty("tours").GetInt32());
        var draft = attached.GetProperty("canvas");
        var listRef = draft.GetProperty("nodes").EnumerateArray().Single(n => n.GetProperty("type").GetString() == "ref");
        Assert.True(listRef.TryGetProperty("existing", out var reused)); // la API ya estaba: se reutiliza su caja
        Assert.Contains(before.GetProperty("nodes").EnumerateObject(), n => n.Name == reused.GetString());
        // Navegar a la lista de pedidos, que ya está en esta misma feature: no se adivina cuál de sus cajas es.
        Assert.Contains(draft.GetProperty("omitted").EnumerateArray(), o => o.GetProperty("code").GetString() == "navigation-same-feature");

        // Alguien guarda el lienzo entre la vista previa y la confirmación: 409 y nada se agrega.
        var stale = AttachCanvas(draft, before);
        var moved = before.Deserialize<JsonObject>()!;
        var firstNode = before.GetProperty("layout").EnumerateObject().First().Name;
        moved["layout"]![firstNode]!["x"] = 4000;
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{pedidos}/canvas", UriKind.Relative), moved)).StatusCode);
        var conflict = await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [Attach(Home, pedidos, before.GetProperty("version").GetInt32(), stale)]);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        var current = await GraphAsync(client, pedidos);
        Assert.Equal(before.GetProperty("nodes").EnumerateObject().Count(), current.GetProperty("nodes").EnumerateObject().Count());

        // Vista previa nueva y confirmación: lo de antes queda igual (cajas, posiciones, conexiones y tours).
        var fresh = (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, pedidos, null, null)]), HttpStatusCode.OK))
            .GetProperty("attached").EnumerateArray().Single();
        var input = AttachCanvas(fresh.GetProperty("canvas"), current);
        var applyId = Guid.CreateVersion7();
        var operation = Attach(Home, pedidos, fresh.GetProperty("canvasVersion").GetInt32(), input);
        var result = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, false, [operation]), HttpStatusCode.OK);
        Assert.Equal("completed", result.GetProperty("status").GetString());
        var after = await GraphAsync(client, pedidos);
        Assert.Equal(current.GetProperty("version").GetInt32() + 1, after.GetProperty("version").GetInt32());
        foreach (var section in new[] { "nodes", "edges", "layout", "tours" })
        {
            foreach (var existing in current.GetProperty(section).EnumerateObject())
            {
                Assert.True(JsonElement.DeepEquals(existing.Value, after.GetProperty(section).GetProperty(existing.Name)), $"{section}/{existing.Name} cambió");
            }
        }

        var added = after.GetProperty("nodes").EnumerateObject().Where(n => !current.GetProperty("nodes").TryGetProperty(n.Name, out _)).ToList();
        Assert.Single(added);
        Assert.Equal("screen", added[0].Value.GetProperty("type").GetString());
        Assert.Contains(after.GetProperty("edges").EnumerateObject(), e => e.Value.GetProperty("from").GetString() == added[0].Name
            && e.Value.GetProperty("to").GetString() == reused.GetString() && e.Value.GetProperty("kind").GetString() == "request");

        // Reintento con el mismo applyId: nada se duplica.
        await JsonAsync(await ApplyAsync(client, snapshotId, applyId, false, [operation]), HttpStatusCode.OK);
        Assert.True(JsonElement.DeepEquals(after, await GraphAsync(client, pedidos)));

        // Procedencia: vinculada a la feature.
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?key={Uri.EscapeDataString(Home)}", UriKind.Relative)), HttpStatusCode.OK);
        var item = review.GetProperty("items").EnumerateArray().Single();
        Assert.Equal("linked", item.GetProperty("status").GetString());
        Assert.Equal(pedidos, item.GetProperty("binding").GetProperty("target").GetProperty("id").GetGuid());
        var provenance = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/bindings?target=feature:{pedidos}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Contains(provenance.GetProperty("bindings").EnumerateArray(), b => b.GetProperty("binding").GetProperty("entityKey").GetString() == Home);
        _ = apis;
    }

    [Fact]
    public async Task Si_incorporar_falla_a_mitad_se_quita_lo_agregado_y_no_queda_ninguna_decision()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (_, snapshotId, pedidos, _) = await ShopDocumentedAsync(client, "Inicio que falla");
        var before = await GraphAsync(client, pedidos);
        var preview = (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, pedidos, null, null)]), HttpStatusCode.OK))
            .GetProperty("attached").EnumerateArray().Single();

        using var failing = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddSingleton<IApplyCheckpoints>(new ScreenCheckpoints(c => c == "finalize" ? throw new InvalidOperationException("caída al cerrar") : Task.CompletedTask))));
        using var faulty = failing.CreateClient();
        faulty.DefaultRequestHeaders.Authorization = client.DefaultRequestHeaders.Authorization;
        var result = await JsonAsync(await ApplyAsync(faulty, snapshotId, Guid.CreateVersion7(), false,
            [Attach(Home, pedidos, preview.GetProperty("canvasVersion").GetInt32(), AttachCanvas(preview.GetProperty("canvas"), before))]), HttpStatusCode.OK);
        Assert.Equal("compensated", result.GetProperty("status").GetString());

        // El lienzo vuelve a tener exactamente lo de antes (su versión sube: agregar y quitar son dos guardados).
        var after = await GraphAsync(client, pedidos);
        foreach (var section in new[] { "nodes", "edges", "layout" })
        {
            Assert.True(JsonElement.DeepEquals(before.GetProperty(section), after.GetProperty(section)), section);
        }

        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?key={Uri.EscapeDataString(Home)}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal("new", review.GetProperty("items").EnumerateArray().Single().GetProperty("status").GetString());
    }

    [Fact]
    public async Task Dos_incorporaciones_a_la_misma_feature_en_una_solicitud_se_rechazan_enteras_sin_aplicar_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (_, snapshotId, pedidos, _) = await ShopDocumentedAsync(client, "Dos incorporaciones", help: true);
        const string Help = "screen:web:/ayuda";
        var before = await GraphAsync(client, pedidos);

        // Vista previa de las dos juntas: 400 en la segunda, con el motivo y sin vista previa parcial.
        var both = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, pedidos, null, null), Attach(Help, pedidos, null, null)]), HttpStatusCode.BadRequest);
        var message = both.GetProperty("errors").GetProperty("/operations/1/target")[0].GetString()!;
        Assert.Contains("una pantalla por vez", message, StringComparison.Ordinal);
        Assert.Contains("No se aplicó nada", message, StringComparison.Ordinal);

        // Confirmar las dos (cada una con su lugar libre y la versión vista): tampoco se aplica ninguna.
        var homePreview = (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, pedidos, null, null)]), HttpStatusCode.OK)).GetProperty("attached")[0];
        var helpPreview = (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Help, pedidos, null, null)]), HttpStatusCode.OK)).GetProperty("attached")[0];
        var version = before.GetProperty("version").GetInt32();
        var helpCanvas = AttachCanvas(helpPreview.GetProperty("canvas"), before);
        helpCanvas["layout"]![Help]!["y"] = 1200;
        await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false,
            [Attach(Home, pedidos, version, AttachCanvas(homePreview.GetProperty("canvas"), before)), Attach(Help, pedidos, version, helpCanvas)]), HttpStatusCode.BadRequest);
        Assert.True(JsonElement.DeepEquals(before, await GraphAsync(client, pedidos)));
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?key={Uri.EscapeDataString(Home)}&key={Uri.EscapeDataString(Help)}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(2, review.GetProperty("items").GetArrayLength());
        Assert.All(review.GetProperty("items").EnumerateArray(), i => Assert.Equal("new", i.GetProperty("status").GetString()));

        // Una por vez sí: la segunda, con la vista previa del lienzo ya actualizado.
        Assert.Equal("completed", (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false,
            [Attach(Home, pedidos, version, AttachCanvas(homePreview.GetProperty("canvas"), before))]), HttpStatusCode.OK)).GetProperty("status").GetString());
        var middle = await GraphAsync(client, pedidos);
        var second = (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Help, pedidos, null, null)]), HttpStatusCode.OK)).GetProperty("attached")[0];
        Assert.Equal("completed", (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false,
            [Attach(Help, pedidos, second.GetProperty("canvasVersion").GetInt32(), AttachCanvas(second.GetProperty("canvas"), middle))]), HttpStatusCode.OK)).GetProperty("status").GetString());
        Assert.Equal(version + 2, (await GraphAsync(client, pedidos)).GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Incorporar_rechaza_una_caja_encima_de_una_existente_por_lo_que_mide_dibujada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (_, snapshotId, pedidos, _) = await ShopDocumentedAsync(client, "Incorporar con cajas reales");
        // Una API hecha a mano con una ruta larga: en el navegador mide 264 × 166, no 184 × 72.
        var graph = (await GraphAsync(client, pedidos)).Deserialize<JsonObject>()!;
        const string Big = "0198f0c0-2222-7000-8000-000000000001";
        graph["nodes"]![Big] = new JsonObject
        {
            ["id"] = Big, ["type"] = "api", ["title"] = "PUT /api/apps/{appId}/members/{userId}",
            ["http"] = new JsonObject { ["method"] = "PUT", ["path"] = "/api/apps/{appId}/members/{userId}" },
        };
        graph["layout"]![Big] = new JsonObject { ["x"] = 5000, ["y"] = 0 };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{pedidos}/canvas", UriKind.Relative), graph)).StatusCode);
        var before = await GraphAsync(client, pedidos);
        var preview = (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, pedidos, null, null)]), HttpStatusCode.OK)).GetProperty("attached")[0];

        // Justo debajo de la API, donde con 184 × 72 había lugar (y = 96): 400 con el tamaño y la posición de las dos.
        var canvas = AttachCanvas(preview.GetProperty("canvas"), before);
        canvas["layout"]![Home] = new JsonObject { ["x"] = 5000, ["y"] = 96 };
        var rejected = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false,
            [Attach(Home, pedidos, preview.GetProperty("canvasVersion").GetInt32(), canvas)]), HttpStatusCode.BadRequest);
        var message = rejected.GetProperty("errors").GetProperty($"/operations/0/canvas/layout/{Home}")[0].GetString()!;
        Assert.Contains("PUT /api/apps/{appId}/members/{userId}", message, StringComparison.Ordinal);
        Assert.Contains("264 × 167", message, StringComparison.Ordinal);
        Assert.True(JsonElement.DeepEquals(before, await GraphAsync(client, pedidos)));

        // Debajo de lo que mide de verdad, con aire: entra y nada de lo anterior se mueve.
        canvas["layout"]![Home] = new JsonObject { ["x"] = 5000, ["y"] = 200 };
        Assert.Equal("completed", (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false,
            [Attach(Home, pedidos, preview.GetProperty("canvasVersion").GetInt32(), canvas)]), HttpStatusCode.OK)).GetProperty("status").GetString());
        var after = await GraphAsync(client, pedidos);
        foreach (var box in before.GetProperty("layout").EnumerateObject())
        {
            Assert.True(JsonElement.DeepEquals(box.Value, after.GetProperty("layout").GetProperty(box.Name)));
        }
    }

    [Fact]
    public async Task Incorporar_exige_una_feature_de_la_app_y_una_pantalla_sin_decision()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (_, snapshotId, pedidos, _) = await ShopDocumentedAsync(client, "Inicio inválido");
        // Un servicio no se incorpora; un id que no es una feature de la app tampoco.
        var api = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach("service:Tienda.Api", pedidos, null, null)]), HttpStatusCode.BadRequest);
        Assert.Contains("Solo una pantalla", api.GetRawText(), StringComparison.Ordinal);
        await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach(Home, Guid.CreateVersion7(), null, null)]), HttpStatusCode.BadRequest);
        // Una pantalla que ya entró con su feature no se incorpora otra vez.
        await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Attach("screen:web:/pedidos", pedidos, null, null)]), HttpStatusCode.Conflict);
    }

    // ---------- Ayudas ----------

    /// <summary>La tienda con su pantalla de inicio, analizada, con la propuesta «Pedidos» creada (APIs y feature).</summary>
    private static async Task<(Guid App, Guid Snapshot, Guid Pedidos, Dictionary<string, Guid> Apis)> ShopDocumentedAsync(HttpClient client, string name, bool help = false)
    {
        var appId = await CreateAppAsync(client, name);
        var snapshotId = await UploadSnapshotAsync(client, appId, ShopWithHome(Guid.CreateVersion7(), help));
        var proposal = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single(p => p.GetProperty("key").GetString() == "feature:web:Pedidos");
        var apis = proposal.GetProperty("members").EnumerateArray().Select(m => m.GetString()!).Where(m => m.StartsWith("api:", StringComparison.Ordinal))
            .ToDictionary(a => a, _ => Guid.CreateVersion7());
        var pedidos = Guid.CreateVersion7();
        var operations = apis.Select(p => Create(p.Key, p.Value)).ToList();
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [.. operations, Create("feature:web:Pedidos", pedidos)]), HttpStatusCode.OK);
        operations.Add(Create("feature:web:Pedidos", pedidos, Canvas(Created(preview, "feature:web:Pedidos").GetProperty("canvas"))));
        Assert.Equal("completed", (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [.. operations]), HttpStatusCode.OK)).GetProperty("status").GetString());
        return (appId, snapshotId, pedidos, apis);
    }

    /// <summary>
    /// La misma tienda, más una pantalla de inicio en «/» que lista los pedidos y lleva a la lista (y, con
    /// <paramref name="help"/>, otra pantalla suelta en «/ayuda» que también lista los pedidos).
    /// </summary>
    private static byte[] ShopWithHome(Guid source, bool help = false)
    {
        var files = new Dictionary<string, string>(ShopFiles(), StringComparer.Ordinal)
        {
            ["web/src/rutas.tsx"] = """
                import { createBrowserRouter } from 'react-router-dom';
                import { InicioPage, PedidosPage, PedidoPage, EditarPedidoPage } from './paginas';
                export const router = createBrowserRouter([
                  { path: '/', element: <InicioPage /> },
                  { path: '/pedidos', element: <PedidosPage /> },
                  { path: '/pedidos/:id', element: <PedidoPage /> },
                  { path: '/pedidos/:id/editar', element: <EditarPedidoPage /> },
                ]);
                """,
            ["web/src/inicio.tsx"] = """
                import { Link } from 'react-router-dom';
                import { listar } from './api';
                export function InicioPage() { listar(); return <Link to="/pedidos">Pedidos</Link>; }
                """,
        };
        files["web/src/paginas.tsx"] = "export { InicioPage } from './inicio';\n" + files["web/src/paginas.tsx"];
        if (help)
        {
            files["web/src/rutas.tsx"] = files["web/src/rutas.tsx"]
                .Replace("{ InicioPage,", "{ InicioPage, AyudaPage,", StringComparison.Ordinal)
                .Replace("  { path: '/', element: <InicioPage /> },", "  { path: '/', element: <InicioPage /> },\n  { path: '/ayuda', element: <AyudaPage /> },", StringComparison.Ordinal);
            files["web/src/ayuda.tsx"] = """
                import { listar } from './api';
                export function AyudaPage() { listar(); return <p>Ayuda</p>; }
                """;
            files["web/src/paginas.tsx"] = "export { AyudaPage } from './ayuda';\n" + files["web/src/paginas.tsx"];
        }

        return Scan(files, "--source-id", source.ToString());
    }

    private static JsonObject Attach(string key, Guid featureId, int? version, JsonObject? canvas)
    {
        var op = new JsonObject
        {
            ["op"] = "attach", ["entityKey"] = key, ["target"] = new JsonObject { ["kind"] = "feature", ["id"] = featureId.ToString() }, ["bindingVersion"] = 0,
        };
        if (version is { } v)
        {
            op["canvasVersion"] = v;
        }

        if (canvas is not null)
        {
            op["canvas"] = canvas.DeepClone();
        }

        return op;
    }

    /// <summary>Ids nuevos y posiciones libres (a la derecha de lo que ya está) solo para lo que se agrega.</summary>
    private static JsonObject AttachCanvas(JsonElement draft, JsonElement graph)
    {
        var right = graph.GetProperty("layout").EnumerateObject().Select(p => p.Value.GetProperty("x").GetDouble() + (p.Value.TryGetProperty("w", out var w) ? w.GetDouble() : BoxSizes.MaxWidth)).DefaultIfEmpty(0).Max() + 80;
        var nodes = new JsonObject();
        var layout = new JsonObject();
        var row = 0;
        foreach (var node in draft.GetProperty("nodes").EnumerateArray().Where(n => !n.TryGetProperty("existing", out _)))
        {
            var key = node.GetProperty("key").GetString()!;
            nodes[key] = Guid.CreateVersion7().ToString();
            layout[key] = new JsonObject { ["x"] = right, ["y"] = row++ * 280 };
        }

        var edges = new JsonObject([.. draft.GetProperty("edges").EnumerateArray()
            .Select(e => KeyValuePair.Create(e.GetProperty("key").GetString()!, (JsonNode?)Guid.CreateVersion7().ToString()))]);
        return new JsonObject { ["nodes"] = nodes, ["edges"] = edges, ["layout"] = layout };
    }

    private static async Task<JsonElement> GraphAsync(HttpClient client, Guid featureId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)), HttpStatusCode.OK);

    /// <summary>Un tour hecho a mano en el lienzo (tiene que seguir igual después de incorporar).</summary>
    private static async Task PutTourAsync(HttpClient client, Guid featureId)
    {
        var graph = (await GraphAsync(client, featureId)).Deserialize<JsonObject>()!;
        var first = graph["nodes"]!.AsObject().First().Key;
        graph["tours"] = new JsonObject
        {
            ["t1"] = new JsonObject { ["id"] = "t1", ["name"] = "Guía", ["kind"] = "guide", ["steps"] = new JsonArray(new JsonObject { ["id"] = "s1", ["nodeId"] = first }) },
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph)).StatusCode);
    }

    private sealed class ScreenCheckpoints(Func<string, Task> reached) : IApplyCheckpoints
    {
        public Task ReachedAsync(string checkpoint, Guid applyId) => reached(checkpoint);
    }
}
