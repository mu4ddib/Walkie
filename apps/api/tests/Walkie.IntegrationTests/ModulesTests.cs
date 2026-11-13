using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Shared.Schemas;

namespace Walkie.IntegrationTests;

/// <summary>
/// Módulos compartidos (spec modulos-compartidos, ADR-0010): resúmenes, crear, borrar, usos, reasignar interfaces,
/// validación de referencias y ciclos, y convertir una selección en módulo. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class ModulesTests(WalkieApiFactory factory)
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Sin_token_responde_401()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri($"/api/apps/{Guid.CreateVersion7()}/modules", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Un_modulo_tiene_interfaces_con_el_contrato_de_su_caja_y_no_aparece_entre_las_features()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var item = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
            new CreateCatalogItemRequest("api", "Perfil", null, TestJson.Http("PUT", "/usuarios/{id}/perfil")));
        var itemId = (await item.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
        var module = await CreateModuleAsync(client, appId, "Usuarios");
        var feature = await CreateFeatureAsync(client, appId, "Registro");

        var graph = ModuleGraph(itemId);
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, module.Id, graph)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, feature, FeatureUsing(module.Id, "get"))).StatusCode);

        var list = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/apps/{appId}/modules", UriKind.Relative));
        var summary = list.EnumerateArray().Single();
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.ModuleSummary, summary));
        Assert.Equal("Usuarios", summary.GetProperty("name").GetString());
        Assert.Equal(1, summary.GetProperty("version").GetInt32());
        Assert.Equal(feature, summary.GetProperty("usedBy")[0].GetGuid());
        var interfaces = summary.GetProperty("interfaces").EnumerateArray().ToList();
        Assert.Equal(["Actualizar perfil", "Obtener usuario"], interfaces.Select(i => i.GetProperty("name").GetString()));
        Assert.Equal("PUT", interfaces[0].GetProperty("method").GetString());
        Assert.Equal("api", interfaces[0].GetProperty("nodeType").GetString());
        Assert.Equal("/usuarios/{id}", interfaces[1].GetProperty("path").GetString());

        // Ni la galería ni el conteo de la app lo ven como feature.
        var features = await client.GetFromJsonAsync<List<FeatureResponse>>(new Uri($"/api/apps/{appId}/features", UriKind.Relative));
        Assert.Equal(["Registro"], features!.Select(f => f.Name));
        var app = await client.GetFromJsonAsync<AppResponse>(new Uri($"/api/apps/{appId}", UriKind.Relative));
        Assert.Equal(1, app!.FeatureCount);
    }

    [Fact]
    public async Task Crear_valida_el_nombre_responde_404_sin_app_y_409_con_un_id_repetido()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var invalid = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative), new CreateModuleRequest(" "));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var missing = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{Guid.CreateVersion7()}/modules", UriKind.Relative), new CreateModuleRequest("Usuarios"));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        var id = Guid.CreateVersion7();
        var first = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative), new CreateModuleRequest("Usuarios", "Cuentas", id));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(id, (await first.Content.ReadFromJsonAsync<ModuleSummary>())!.Id);
        var again = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative), new CreateModuleRequest("Usuarios", null, id));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task La_api_rechaza_referencias_que_no_son_modulos_de_la_app_e_interfaces_fuera_de_un_modulo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var otherApp = await CreateAppAsync(client);
        var foreign = await CreateModuleAsync(client, otherApp, "Ajeno");
        var plain = await CreateFeatureAsync(client, appId, "Perfil");
        var feature = await CreateFeatureAsync(client, appId, "Registro");
        var module = await CreateModuleAsync(client, appId, "Usuarios");

        var other = await PutAsync(client, feature, FeatureUsing(foreign.Id, null));
        Assert.Contains("/nodes/m1/moduleId", (await Problem(other)).Errors.Keys);
        var notModule = await PutAsync(client, feature, FeatureUsing(plain, null));
        Assert.Contains("/nodes/m1/moduleId", (await Problem(notModule)).Errors.Keys);

        // Un módulo que ya no existe es una referencia pendiente: se guarda.
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, feature, FeatureUsing(Guid.CreateVersion7(), "get"))).StatusCode);

        var withInterfaces = ModuleGraph(null);
        Assert.Contains("/interfaces", (await Problem(await PutAsync(client, feature, withInterfaces))).Errors.Keys);

        // Integridad: la caja de la interfaz existe y la interfaz solo va en el extremo que es un módulo.
        var broken = ModuleGraph(null);
        broken["interfaces"]!["get"]!["nodeId"] = "nada";
        Assert.Contains("/interfaces/get/nodeId", (await Problem(await PutAsync(client, module.Id, broken))).Errors.Keys);
        var wrongEnd = FeatureUsing(module.Id, "get");
        wrongEnd["edges"]!["e1"]!["fromInterface"] = new JsonObject { ["id"] = "x", ["name"] = "X" };
        Assert.Contains("/edges/e1/fromInterface", (await Problem(await PutAsync(client, feature, wrongEnd))).Errors.Keys);

        // Un portal no lleva a un módulo.
        var portal = Empty();
        portal["nodes"]!["p"] = new JsonObject { ["id"] = "p", ["type"] = "portal", ["title"] = "Ir", ["targetFeatureId"] = module.Id.ToString() };
        portal["layout"]!["p"] = new JsonObject { ["x"] = 0, ["y"] = 0 };
        Assert.Contains("/nodes/p/targetFeatureId", (await Problem(await PutAsync(client, feature, portal))).Errors.Keys);
    }

    [Fact]
    public async Task Un_modulo_no_puede_contenerse_pero_dos_modulos_pueden_llamarse()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var a = await CreateModuleAsync(client, appId, "A");
        var b = await CreateModuleAsync(client, appId, "B");

        Assert.Contains("/nodes/m1/moduleId", (await Problem(await PutAsync(client, a.Id, FeatureUsing(a.Id, null)))).Errors.Keys);
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, a.Id, FeatureUsing(b.Id, null))).StatusCode);
        var cycle = await PutAsync(client, b.Id, FeatureUsing(a.Id, null));
        Assert.Contains("Ciclo", (await Problem(cycle)).Errors["/nodes/m1/moduleId"][0], StringComparison.Ordinal);

        // Una feature con los dos módulos conectados en ambos sentidos es válida: interacción, no contención.
        var feature = await CreateFeatureAsync(client, appId, "Panel");
        var both = Empty();
        foreach (var (id, module) in new[] { ("ma", a.Id), ("mb", b.Id) })
        {
            both["nodes"]![id] = new JsonObject { ["id"] = id, ["type"] = "module", ["title"] = "M", ["moduleId"] = module.ToString() };
            both["layout"]![id] = new JsonObject { ["x"] = 0, ["y"] = 0 };
        }

        both["edges"]!["ab"] = new JsonObject { ["id"] = "ab", ["from"] = "ma", ["to"] = "mb", ["kind"] = "uses" };
        both["edges"]!["ba"] = new JsonObject { ["id"] = "ba", ["from"] = "mb", ["to"] = "ma", ["kind"] = "uses" };
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, feature, both)).StatusCode);
    }

    [Fact]
    public async Task Usos_reasignar_una_interfaz_y_borrar_el_modulo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var module = await CreateModuleAsync(client, appId, "Usuarios");
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, module.Id, ModuleGraph(null))).StatusCode);
        var first = await CreateFeatureAsync(client, appId, "Registro");
        var second = await CreateFeatureAsync(client, appId, "Login");
        await PutAsync(client, first, FeatureUsing(module.Id, "get"));
        await PutAsync(client, second, FeatureUsing(module.Id, "get"));

        var usages = await client.GetFromJsonAsync<List<ModuleUsage>>(new Uri($"/api/modules/{module.Id}/usages", UriKind.Relative), Web);
        Assert.Equal(["Login", "Registro"], usages!.Select(u => u.Name));
        Assert.Equal("get", usages![0].Edges.Single().InterfaceId);
        Assert.Equal("to", usages![0].Edges.Single().End);

        var bad = await client.PostAsJsonAsync(new Uri($"/api/modules/{module.Id}/interfaces/get/reassign", UriKind.Relative), new ReassignInterfaceRequest("nada"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var reassigned = await client.PostAsJsonAsync(new Uri($"/api/modules/{module.Id}/interfaces/get/reassign", UriKind.Relative), new ReassignInterfaceRequest("put"));
        var result = (await reassigned.Content.ReadFromJsonAsync<ReassignInterfaceResponse>())!;
        Assert.Equal(2, result.Edges);
        var graph = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{first}/canvas", UriKind.Relative));
        Assert.Equal(2, graph.GetProperty("version").GetInt32());
        Assert.Equal("Actualizar perfil", graph.GetProperty("edges").GetProperty("e1").GetProperty("toInterface").GetProperty("name").GetString());

        // Al módulo completo: la conexión pierde la interfaz.
        await client.PostAsJsonAsync(new Uri($"/api/modules/{module.Id}/interfaces/put/reassign", UriKind.Relative), new ReassignInterfaceRequest(null));
        graph = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{first}/canvas", UriKind.Relative));
        Assert.False(graph.GetProperty("edges").GetProperty("e1").TryGetProperty("toInterface", out _));

        var inUse = await client.DeleteAsync(new Uri($"/api/modules/{module.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Conflict, inUse.StatusCode);
        var forced = await client.DeleteAsync(new Uri($"/api/modules/{module.Id}?force=true", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NoContent, forced.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/modules/{module.Id}", UriKind.Relative))).StatusCode);
        // Las features siguen guardándose con la caja pendiente.
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, first, Versioned(FeatureUsing(module.Id, null), 3))).StatusCode);
    }

    [Fact]
    public async Task Convertir_crea_el_modulo_y_guarda_la_feature_y_un_reintento_no_duplica()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, appId, "Registro");
        var moduleId = Guid.CreateVersion7();
        var request = new ExtractModuleRequest(
            moduleId, "Usuarios", "Cuentas", Parse(ModuleGraph(null)), feature, Parse(FeatureUsing(moduleId, "get")));

        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules/extract", UriKind.Relative), request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var done = (await response.Content.ReadFromJsonAsync<ExtractModuleResponse>())!;
        Assert.Equal(1, done.Feature.GetProperty("version").GetInt32());
        Assert.Equal(2, done.Module.Interfaces.Count);

        var retry = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules/extract", UriKind.Relative), request);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var list = await client.GetFromJsonAsync<List<ModuleSummary>>(new Uri($"/api/apps/{appId}/modules", UriKind.Relative));
        Assert.Single(list!);
        var saved = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{feature}/canvas", UriKind.Relative));
        Assert.Equal(1, saved.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Si_la_feature_cambio_la_conversion_no_deja_nada_a_medias()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, appId, "Registro");
        Assert.Equal(HttpStatusCode.OK, (await PutAsync(client, feature, Empty())).StatusCode);
        var moduleId = Guid.CreateVersion7();

        // La feature está en la versión 1: el pedido trae la 0 (alguien guardó entretanto).
        var stale = new ExtractModuleRequest(moduleId, "Usuarios", null, Parse(ModuleGraph(null)), feature, Parse(FeatureUsing(moduleId, "get")));
        var conflict = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules/extract", UriKind.Relative), stale);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<ModuleSummary>>(new Uri($"/api/apps/{appId}/modules", UriKind.Relative)))!);

        var invalidModule = ModuleGraph(null);
        invalidModule["interfaces"]!["get"]!["nodeId"] = "nada";
        var invalid = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/modules/extract", UriKind.Relative),
            stale with { Module = Parse(invalidModule), Feature = Parse(Versioned(FeatureUsing(moduleId, "get"), 1)) });
        Assert.Contains("/module/interfaces/get/nodeId", (await Problem(invalid)).Errors.Keys);
        Assert.Empty((await client.GetFromJsonAsync<List<ModuleSummary>>(new Uri($"/api/apps/{appId}/modules", UriKind.Relative)))!);

        // Con la versión correcta, el mismo id funciona.
        var ok = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/modules/extract", UriKind.Relative),
            stale with { Feature = Parse(Versioned(FeatureUsing(moduleId, "get"), 1)) });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public async Task El_walkie_de_una_feature_trae_sus_modulos_y_al_importarlo_en_otra_app_se_reconstruyen()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var outer = await CreateModuleAsync(client, appId, "Usuarios");
        var inner = await CreateModuleAsync(client, appId, "Auditoría");
        var feature = await CreateFeatureAsync(client, appId, "Registro");
        var outerGraph = ModuleGraph(null);
        outerGraph["nodes"]!["m9"] = new JsonObject { ["id"] = "m9", ["type"] = "module", ["title"] = "Auditoría", ["moduleId"] = inner.Id.ToString() };
        outerGraph["layout"]!["m9"] = new JsonObject { ["x"] = 320, ["y"] = 0 };
        await PutAsync(client, outer.Id, outerGraph);
        await PutAsync(client, feature, FeatureUsing(outer.Id, "get"));

        var file = await client.GetByteArrayAsync(new Uri($"/api/features/{feature}/export?format=walkie", UriKind.Relative));
        using (var zip = new System.IO.Compression.ZipArchive(new MemoryStream(file)))
        {
            var manifest = JsonDocument.Parse(zip.GetEntry("manifest.json")!.Open()).RootElement;
            Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Package, manifest));
            Assert.Equal(2, manifest.GetProperty("modules").GetArrayLength());
            Assert.NotNull(zip.GetEntry($"modules/{outer.Id}/canvas.json"));
        }

        // En la misma app, los módulos se reutilizan.
        var same = await ImportAsync(client, appId, file);
        Assert.All(same.GetProperty("modules").EnumerateArray(), m => Assert.True(m.GetProperty("reused").GetBoolean()));

        // En otra app, se crean con ids nuevos y la feature y el módulo de fuera apuntan a ellos.
        var target = await CreateAppAsync(client);
        var summary = await ImportAsync(client, target, file);
        Assert.All(summary.GetProperty("modules").EnumerateArray(), m => Assert.False(m.GetProperty("reused").GetBoolean()));
        var modules = (await client.GetFromJsonAsync<List<ModuleSummary>>(new Uri($"/api/apps/{target}/modules", UriKind.Relative)))!;
        var usuarios = modules.Single(m => m.Name == "Usuarios");
        var auditoria = modules.Single(m => m.Name == "Auditoría");
        Assert.Equal([auditoria.Id], usuarios.Modules);
        Assert.Equal(2, usuarios.Interfaces.Count);
        var imported = summary.GetProperty("features")[0].GetProperty("id").GetGuid();
        var graph = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{imported}/canvas", UriKind.Relative));
        Assert.Equal(usuarios.Id.ToString(), graph.GetProperty("nodes").GetProperty("m1").GetProperty("moduleId").GetString());
        Assert.Equal("get", graph.GetProperty("edges").GetProperty("e1").GetProperty("toInterface").GetProperty("id").GetString());
        Assert.Equal([imported], usuarios.UsedBy);
    }

    private static async Task<JsonElement> ImportAsync(HttpClient client, Guid appId, byte[] file)
    {
        using var part = new ByteArrayContent(file);
        part.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse("application/zip");
        using var content = new MultipartFormDataContent { { part, "file", "feature.walkie" } };
        var response = await client.PostAsync(new Uri($"/api/apps/{appId}/import", UriKind.Relative), content);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var summary = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.ImportSummary, summary));
        return summary;
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_OpenAPI()
    {
        using var client = factory.CreateClient();

        var openApi = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        foreach (var name in new[] { "ListModules", "CreateModule", "ExtractModule", "GetModule", "DeleteModule", "GetModuleUsages", "ReassignModuleInterface" })
        {
            Assert.Contains(name, openApi, StringComparison.Ordinal);
        }
    }

    /// <summary>Lienzo de un módulo: dos APIs (una propia y, con <paramref name="catalogId"/>, un ref) expuestas.</summary>
    private static JsonObject ModuleGraph(Guid? catalogId)
    {
        var graph = Empty();
        graph["nodes"]!["a1"] = new JsonObject
        {
            ["id"] = "a1", ["type"] = "api", ["title"] = "GET usuario",
            ["http"] = new JsonObject { ["method"] = "GET", ["path"] = "/usuarios/{id}" },
        };
        graph["nodes"]!["a2"] = catalogId is { } id
            ? new JsonObject { ["id"] = "a2", ["type"] = "ref", ["title"] = "Perfil", ["catalogId"] = id.ToString() }
            : new JsonObject { ["id"] = "a2", ["type"] = "api", ["title"] = "PUT perfil", ["http"] = new JsonObject { ["method"] = "PUT", ["path"] = "/perfil" } };
        graph["layout"]!["a1"] = new JsonObject { ["x"] = 0, ["y"] = 0 };
        graph["layout"]!["a2"] = new JsonObject { ["x"] = 0, ["y"] = 160 };
        graph["interfaces"] = new JsonObject
        {
            ["get"] = new JsonObject { ["id"] = "get", ["name"] = "Obtener usuario", ["kind"] = "provides", ["nodeId"] = "a1" },
            ["put"] = new JsonObject { ["id"] = "put", ["name"] = "Actualizar perfil", ["kind"] = "provides", ["nodeId"] = "a2" },
        };
        return graph;
    }

    /// <summary>Lienzo de una feature: una pantalla que llama al módulo (a la interfaz dada o al módulo completo).</summary>
    private static JsonObject FeatureUsing(Guid moduleId, string? interfaceId)
    {
        var graph = Empty();
        graph["nodes"]!["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Formulario" };
        graph["nodes"]!["m1"] = new JsonObject { ["id"] = "m1", ["type"] = "module", ["title"] = "Usuarios", ["moduleId"] = moduleId.ToString() };
        graph["layout"]!["s1"] = new JsonObject { ["x"] = 0, ["y"] = 0 };
        graph["layout"]!["m1"] = new JsonObject { ["x"] = 320, ["y"] = 0, ["w"] = 240 };
        var edge = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "m1", ["kind"] = "request" };
        if (interfaceId is not null)
        {
            edge["toInterface"] = new JsonObject { ["id"] = interfaceId, ["name"] = "Obtener usuario" };
        }

        graph["edges"]!["e1"] = edge;
        return graph;
    }

    private static JsonObject Empty() => new()
    {
        ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = new JsonObject(), ["edges"] = new JsonObject(), ["layout"] = new JsonObject(),
    };

    private static JsonObject Versioned(JsonObject graph, int version)
    {
        graph["version"] = version;
        return graph;
    }

    private static JsonElement Parse(JsonObject graph) => TestJson.Parse(graph.ToJsonString());

    private static async Task<HttpResponseMessage> PutAsync(HttpClient client, Guid featureId, JsonObject graph)
    {
        // Cada guardado sigue la versión que tiene el lienzo en la base.
        var current = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative));
        if (graph["version"]!.GetValue<int>() == 0)
        {
            graph["version"] = current.GetProperty("version").GetInt32();
        }

        return await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph);
    }

    private static async Task<ValidationProblemDetails> Problem(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!;
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Módulos " + Guid.NewGuid().ToString("N")[..6]));
        return (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var feature = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest(name));
        return (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }

    private static async Task<ModuleSummary> CreateModuleAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/modules", UriKind.Relative), new CreateModuleRequest(name));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ModuleSummary>())!;
    }
}
