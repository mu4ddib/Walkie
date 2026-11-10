using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Mapa de la app (spec mapa-de-la-app, tarea 1). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class AppMapTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task El_mapa_tiene_las_features_sus_conexiones_por_portal_y_el_catalogo_compartido()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var login = await CreateFeatureAsync(client, appId, "Login");
        var events = await CreateFeatureAsync(client, appId, "Conectar cuentas para eventos");
        var empty = await CreateFeatureAsync(client, appId, "Sin lienzo");
        var item = await CreateCatalogItemAsync(client, appId, "API usuarios");

        await SaveAsync(client, login, new JsonObject
        {
            ["home"] = Node("home", "screen", "Home"),
            ["settings"] = Node("settings", "screen", "Ajustes"),
            ["p1"] = Portal("p1", events),
            ["p2"] = Portal("p2", events),
            ["lost"] = Portal("lost", null),
            ["users"] = Ref("users", item),
        }, new JsonObject
        {
            ["e1"] = Edge("e1", "home", "p1"),
            ["e2"] = Edge("e2", "settings", "p2"),
            ["e3"] = Edge("e3", "home", "users"),
        });
        await SaveAsync(client, events, new JsonObject
        {
            ["s"] = Node("s", "screen", "Calendarios"),
            ["users"] = Ref("users", item),
            ["back"] = Portal("back", login),
        }, new JsonObject());

        var map = (await client.GetFromJsonAsync<AppMap>(new Uri($"/api/apps/{appId}/map", UriKind.Relative)))!;

        Assert.Equal(appId, map.AppId);
        Assert.Equal(3, map.Features.Count);
        var loginSummary = map.Features.Single(f => f.Id == login);
        Assert.Equal(2, loginSummary.Screens);
        Assert.Equal(1, loginSummary.Apis);
        Assert.Equal(1, loginSummary.UnresolvedPortals);
        Assert.Equal(new MapFeature(empty, 0, 0, 0, 0, 0), map.Features.Single(f => f.Id == empty));

        // Dos portales Login → Eventos en una conexión, cada uno con la caja desde la que se llega; y la vuelta.
        var forward = map.Links.Single(l => l.From == login && l.To == events);
        Assert.Equal(["Home"], forward.Portals.Single(p => p.NodeId == "p1").Sources);
        Assert.Equal(["Ajustes"], forward.Portals.Single(p => p.NodeId == "p2").Sources);
        Assert.Single(map.Links, l => l.From == events && l.To == login);

        // El elemento del catálogo lo usan las dos features.
        var shared = Assert.Single(map.Catalog);
        Assert.Equal(item, shared.ItemId);
        Assert.Equal("api", shared.Type);
        Assert.Equal("API usuarios", shared.Title);
        Assert.Equal(new[] { login, events }.Order(), shared.Features.Order());

        Assert.Equal(0, map.Layout.Version);
        Assert.Empty(map.Layout.Positions);
    }

    [Fact]
    public async Task La_distribucion_se_guarda_con_version_y_responde_409_y_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, appId, "Login");
        var uri = new Uri($"/api/apps/{appId}/map/layout", UriKind.Relative);
        var positions = new JsonObject { [feature.ToString()] = new JsonObject { ["x"] = 120, ["y"] = -40.5 } };

        var saved = await client.PutAsJsonAsync(uri, new JsonObject { ["version"] = 0, ["positions"] = positions });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var layout = (await saved.Content.ReadFromJsonAsync<MapLayout>())!;
        Assert.Equal(1, layout.Version);
        var map = (await client.GetFromJsonAsync<AppMap>(new Uri($"/api/apps/{appId}/map", UriKind.Relative)))!;
        Assert.Equal(new MapPosition(120, -40.5), map.Layout.Positions[feature.ToString()]);

        // Con la versión vieja: 409 con la actual.
        var stale = await client.PutAsJsonAsync(uri, new JsonObject { ["version"] = 0, ["positions"] = new JsonObject() });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(1, (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("currentVersion").GetInt32());

        // Una posición que no es un punto: 400 con la ruta.
        var invalid = await client.PutAsJsonAsync(uri, new JsonObject
        {
            ["version"] = 1,
            ["positions"] = new JsonObject { ["f"] = new JsonObject { ["x"] = "lejos" } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var problem = await invalid.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(problem!.Errors.Keys, k => k.StartsWith("/positions/f", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Una_app_inexistente_responde_404_y_sin_token_401()
    {
        using var client = factory.CreateAuthenticatedClient();
        var missing = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/apps/{missing}/map", UriKind.Relative))).StatusCode);
        var put = await client.PutAsJsonAsync(
            new Uri($"/api/apps/{missing}/map/layout", UriKind.Relative), new JsonObject { ["version"] = 0, ["positions"] = new JsonObject() });
        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);

        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(new Uri($"/api/apps/{missing}/map", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Los_endpoints_del_mapa_estan_en_OpenAPI()
    {
        using var client = factory.CreateAuthenticatedClient();
        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));
        Assert.Contains("/api/apps/{appId}/map", doc, StringComparison.Ordinal);
        Assert.Contains("/api/apps/{appId}/map/layout", doc, StringComparison.Ordinal);
    }

    private static JsonObject Node(string id, string type, string title) => new() { ["id"] = id, ["type"] = type, ["title"] = title };

    private static JsonObject Portal(string id, Guid? target)
    {
        var node = Node(id, "portal", "Portal");
        if (target is { } t)
        {
            node["targetFeatureId"] = t.ToString();
        }

        return node;
    }

    private static JsonObject Ref(string id, Guid catalogId)
    {
        var node = Node(id, "ref", "API usuarios");
        node["catalogId"] = catalogId.ToString();
        return node;
    }

    private static JsonObject Edge(string id, string from, string to) =>
        new() { ["id"] = id, ["from"] = from, ["to"] = to, ["kind"] = "navigation" };

    private static async Task SaveAsync(HttpClient client, Guid featureId, JsonObject nodes, JsonObject edges)
    {
        var layout = new JsonObject();
        foreach (var (id, _) in nodes)
        {
            layout[id] = new JsonObject { ["x"] = 0, ["y"] = 0 };
        }

        var graph = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = nodes, ["edges"] = edges, ["layout"] = layout,
        };
        var response = await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Vekipper de prueba"));
        return (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var feature = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest(name));
        return (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }

    private static async Task<Guid> CreateCatalogItemAsync(HttpClient client, Guid appId, string title)
    {
        var item = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), new CreateCatalogItemRequest("api", title, null, null));
        return (await item.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
    }
}
