using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Xunit.Abstractions;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Límites de Walkie Live (spec walkie-live, tarea 11, punto 5) por los dos caminos que reciben un paquete: cargar un
/// análisis en una app y crear una app desde un proyecto local. Cada rechazo dice dónde y por qué, no deja nada guardado
/// (ni una app a medias) y se mide cuánto tarda: un límite que corta antes de validar tiene que responder rápido.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryLimitsTests(WalkieApiFactory factory, ITestOutputHelper output)
{
    [Theory]
    [InlineData("relations")]
    [InlineData("evidence")]
    public async Task Mas_relaciones_o_evidencias_que_el_limite_se_rechazan_antes_de_validar(string part)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var max = part == "relations" ? DiscoveryLimits.MaxRelations : DiscoveryLimits.MaxEvidence;
        var pack = Alter(Tienda(), (_, discovery) =>
        {
            var list = discovery[part]!.AsArray();
            var template = list[0]!;
            for (var i = list.Count; i <= max; i++)
            {
                list.Add(template.DeepClone());
            }
        });

        var watch = Stopwatch.StartNew();
        var problem = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.BadRequest);
        output.WriteLine($"[límite] {part} > {max}: paquete de {pack.Length / 1024} KB rechazado en {watch.ElapsedMilliseconds} ms");

        Assert.Contains($"el máximo es {max}", string.Join(" ", problem.GetProperty("errors").GetProperty($"discovery.json/{part}").EnumerateArray().Select(e => e.GetString())), StringComparison.Ordinal);
        await AssertNothingSavedAsync(appId);
    }

    [Theory]
    [InlineData("zip-bomb")]
    [InlineData("zip-slip")]
    [InlineData("entrada-inesperada")]
    [InlineData("json-invalido")]
    [InlineData("referencia-rota")]
    [InlineData("demasiadas-entidades")]
    [InlineData("mas-de-50-mb")]
    public async Task Crear_una_app_con_un_paquete_que_no_se_acepta_no_deja_ninguna_app(string variant)
    {
        using var client = factory.CreateAuthenticatedClient();
        var (manifest, discovery) = Open(Tienda());
        var m = Encoding.UTF8.GetBytes(manifest.ToJsonString());
        var d = Encoding.UTF8.GetBytes(discovery.ToJsonString());
        var pack = variant switch
        {
            "zip-bomb" => Bomb(m, 201L * 1024 * 1024),
            "zip-slip" => Zip(("../manifest.json", m), (DiscoveryFormat.DiscoveryPath, d)),
            "entrada-inesperada" => Zip((DiscoveryFormat.ManifestPath, m), (DiscoveryFormat.DiscoveryPath, d), ("run.sh", "rm -rf /"u8.ToArray())),
            "json-invalido" => Zip((DiscoveryFormat.ManifestPath, m), (DiscoveryFormat.DiscoveryPath, "{\"entities\": ["u8.ToArray())),
            "referencia-rota" => Alter(Tienda(), (_, dd) => dd["relations"]![0]!["to"] = "api:GET /no-existe"),
            "demasiadas-entidades" => Alter(Tienda(), (_, dd) =>
            {
                var entities = dd["entities"]!.AsArray();
                for (var i = entities.Count; i <= DiscoveryLimits.MaxEntities; i++)
                {
                    entities.Add(entities[0]!.DeepClone());
                }
            }),
            "mas-de-50-mb" => new byte[(int)DiscoveryLimits.MaxPackBytes + 1],
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, null),
        };
        var name = "Límite " + Guid.NewGuid().ToString("N")[..8];

        var watch = Stopwatch.StartNew();
        var response = await ImportAsync(client, pack, name);
        output.WriteLine($"[límite] crear app con {variant}: {pack.Length / 1024} KB → {(int)response.StatusCode} en {watch.ElapsedMilliseconds} ms");

        Assert.Equal(variant == "mas-de-50-mb" ? HttpStatusCode.RequestEntityTooLarge : HttpStatusCode.BadRequest, response.StatusCode);
        var apps = (await client.GetFromJsonAsync<JsonNode[]>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.DoesNotContain(apps, a => a!["name"]!.GetValue<string>() == name);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.False(await db.SourceImports.AnyAsync(i => i.AppName == name)); // ni siquiera una bitácora pendiente
    }

    private static async Task<HttpResponseMessage> ImportAsync(HttpClient client, byte[] pack, string name)
    {
        using var part = new ByteArrayContent(pack);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var form = new MultipartFormDataContent
        {
            { part, "file", "architecture.walkiepack" },
            { new StringContent(name), "name" },
            { new StringContent(Guid.CreateVersion7().ToString()), "importId" },
        };
        return await client.PostAsync(new Uri("/api/sources/import", UriKind.Relative), form);
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client) =>
        (await JsonAsync(await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Límites")), HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private async Task AssertNothingSavedAsync(Guid appId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        Assert.False(await db.Snapshots.AnyAsync(s => s.AppId == appId));
        Assert.False(await db.Sources.AnyAsync(s => s.AppId == appId));
    }
}
