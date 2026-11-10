using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Tours del lienzo (spec modo-tour, criterios 11 y 12 en la API). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class ToursTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task Un_lienzo_con_tours_se_guarda_y_recarga_identico()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);

        var saved = await client.PutAsJsonAsync(CanvasUri(feature), Graph(0));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        using var expected = JsonDocument.Parse(Graph(1).ToJsonString());
        Assert.True(JsonElement.DeepEquals(
            expected.RootElement, await client.GetFromJsonAsync<JsonElement>(CanvasUri(feature))));
    }

    [Fact]
    public async Task Un_paso_a_un_nodo_inexistente_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var graph = Graph(0);
        graph["tours"]!["t1"]!["steps"]!.AsArray().Add(new JsonObject { ["nodeId"] = "fantasma" });

        await AssertErrorAsync(await client.PutAsJsonAsync(CanvasUri(feature), graph), "/tours/t1/steps/2/nodeId");
    }

    [Fact]
    public async Task Un_recorrido_por_conexiones_se_guarda_con_repeticiones_y_pasos_de_conexiones_eliminadas()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);

        var saved = await client.PutAsJsonAsync(CanvasUri(feature), FlowGraph(0));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        using var expected = JsonDocument.Parse(FlowGraph(1).ToJsonString());
        Assert.True(JsonElement.DeepEquals(
            expected.RootElement, await client.GetFromJsonAsync<JsonElement>(CanvasUri(feature))));
    }

    [Fact]
    public async Task Un_paso_a_una_conexion_inexistente_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var graph = FlowGraph(0);
        graph["tours"]!["f1"]!["steps"]!.AsArray().Add(new JsonObject { ["edgeId"] = "fantasma" });

        await AssertErrorAsync(await client.PutAsJsonAsync(CanvasUri(feature), graph), "/tours/f1/steps/4/edgeId");
    }

    [Fact]
    public async Task Un_tour_guiado_con_un_paso_de_conexion_responde_400_y_un_recorrido_declarado_se_guarda()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var graph = FlowGraph(0);
        graph["tours"]!["f1"]!["kind"] = "guide";

        await AssertErrorAsync(await client.PutAsJsonAsync(CanvasUri(feature), graph), "/tours/f1/steps/0");

        graph["tours"]!["f1"]!["kind"] = "flow";
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(CanvasUri(feature), graph)).StatusCode);
    }

    [Fact]
    public async Task Un_paso_con_nodo_y_conexion_a_la_vez_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var graph = FlowGraph(0);
        graph["tours"]!["f1"]!["steps"]![0]!["nodeId"] = "s1";

        var response = await client.PutAsJsonAsync(CanvasUri(feature), graph);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Un_tour_cuya_clave_no_es_su_id_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var graph = Graph(0);
        graph["tours"]!["t1"]!["id"] = "otro";

        await AssertErrorAsync(await client.PutAsJsonAsync(CanvasUri(feature), graph), "/tours/t1/id");
    }

    [Theory]
    [InlineData("name", "", "/tours/t1/name")]
    [InlineData("name", 61, "/tours/t1/name")]
    [InlineData("note", 501, "/tours/t1/steps/0/note")]
    [InlineData("extra", 1, "/tours/t1")]
    public async Task Tours_que_no_cumplen_el_schema_responden_400(string field, object value, string errorPath)
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client);
        var graph = Graph(0);
        var text = value is int length ? new string('x', length) : (string)value;
        if (field == "note")
        {
            graph["tours"]!["t1"]!["steps"]![0]!["note"] = text;
        }
        else
        {
            graph["tours"]!["t1"]![field] = text;
        }

        await AssertErrorAsync(await client.PutAsJsonAsync(CanvasUri(feature), graph), errorPath);
    }

    /// <summary>Una pantalla y una regla con un tour de dos pasos (datos ficticios).</summary>
    private static JsonObject Graph(int version) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = version,
        ["nodes"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login" },
            ["r1"] = new JsonObject { ["id"] = "r1", ["type"] = "rule", ["title"] = "Documento válido" },
        },
        ["edges"] = new JsonObject(),
        ["layout"] = new JsonObject(),
        ["tours"] = new JsonObject
        {
            ["t1"] = new JsonObject
            {
                ["id"] = "t1",
                ["name"] = "Iniciar sesión",
                ["steps"] = new JsonArray(
                    new JsonObject { ["nodeId"] = "s1", ["note"] = "Aquí empieza todo: el usuario escribe su documento." },
                    new JsonObject { ["nodeId"] = "r1" }),
            },
        },
    };

    /// <summary>
    /// Pantalla → API (solicitud) y API → Pantalla (respuesta), con un recorrido que repite la solicitud (reintento) y
    /// un paso cuya conexión ya se eliminó (datos ficticios).
    /// </summary>
    private static JsonObject FlowGraph(int version) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = version,
        ["nodes"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Creación de cuenta" },
            ["a1"] = new JsonObject { ["id"] = "a1", ["type"] = "api", ["title"] = "API usuarios" },
        },
        ["edges"] = new JsonObject
        {
            ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "a1", ["kind"] = "request" },
            ["e2"] = new JsonObject { ["id"] = "e2", ["from"] = "a1", ["to"] = "s1", ["kind"] = "response", ["replyTo"] = "e1" },
        },
        ["layout"] = new JsonObject(),
        ["tours"] = new JsonObject
        {
            ["f1"] = new JsonObject
            {
                ["id"] = "f1",
                ["name"] = "Alta con reintento",
                ["steps"] = new JsonArray(
                    new JsonObject { ["edgeId"] = "e1", ["note"] = "Envía el formulario" },
                    new JsonObject { ["edgeId"] = "e1", ["note"] = "Reintenta" },
                    new JsonObject { ["edgeId"] = "e2" },
                    new JsonObject
                    {
                        ["removedEdge"] = new JsonObject { ["from"] = "a1", ["to"] = "x9", ["kind"] = "request" },
                    }),
            },
        },
    };

    private static Uri CanvasUri(Guid featureId) => new($"/api/features/{featureId}/canvas", UriKind.Relative);

    private static async Task AssertErrorAsync(HttpResponseMessage response, string path)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(path, problem!.Errors.Keys);
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client)
    {
        var app = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Tours"));
        var appId = (await app.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var feature = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión"));
        return (await feature.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }
}
