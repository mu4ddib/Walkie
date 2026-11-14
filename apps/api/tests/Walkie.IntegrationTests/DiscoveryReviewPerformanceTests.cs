using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Discovery;
using Xunit.Abstractions;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Escala de la revisión (spec walkie-live, tarea 4): un análisis en el límite de entidades (<c>DiscoveryLimits.MaxEntities</c>)
/// con miles de decisiones y cientos de elementos en el catálogo. El paquete es sintético porque ningún proyecto ficticio
/// de las pruebas llega a ese tamaño, pero cumple el contrato completo (pasa por el mismo validador al subirlo); la
/// corrección la prueban los paquetes de la CLI en <see cref="DiscoveryReviewTests"/>. Imprime los tiempos medidos.
/// Los umbrales son holgados a propósito: atrapan una degradación de orden (cuadrática, N+1), no ruido de la máquina.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryReviewPerformanceTests(WalkieApiFactory factory, ITestOutputHelper output)
{
    [Theory]
    [InlineData(2_000, 500, 50)]
    [InlineData(20_000, 5_000, 200)]
    public async Task La_revision_de_un_analisis_grande_pagina_sin_degradarse(int entities, int decisions, int catalogItems)
    {
        using var client = factory.CreateAuthenticatedClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Escala de prueba"));
        var appId = (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
        for (var i = 0; i < catalogItems; i++)
        {
            // La mitad coincide por firma con un hallazgo; la otra mitad no coincide con nada.
            var path = i % 2 == 0 ? Path(i) : $"/otra/{i}";
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
                new CreateCatalogItemRequest("api", $"Elemento {i}", null, TestJson.Http("GET", path)))).StatusCode);
        }

        var pack = SyntheticPack(entities);
        var (packManifest, packDiscovery) = Open(pack);
        var validation = Stopwatch.StartNew();
        Assert.Empty(DiscoveryPackValidator.Validate(JsonSerializer.SerializeToElement(packManifest), JsonSerializer.SerializeToElement(packDiscovery)));
        validation.Stop();
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"  validar el contrato (DiscoveryPackValidator): {validation.ElapsedMilliseconds} ms"));
        var upload = Stopwatch.StartNew();
        var created = await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created);
        upload.Stop();
        var snapshotId = created.GetProperty("snapshot").GetProperty("id").GetGuid();

        for (var start = catalogItems; start < catalogItems + decisions; start += 1000)
        {
            var operations = new JsonArray([.. Enumerable.Range(start, Math.Min(1000, catalogItems + decisions - start))
                .Select(i => (JsonNode)new JsonObject { ["op"] = "reject", ["entityKey"] = Key(i), ["bindingVersion"] = 0 })]);
            var applied = await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative),
                new JsonObject { ["applyId"] = Guid.CreateVersion7().ToString(), ["operations"] = operations });
            Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        }

        var first = await TimeAsync(client, $"/api/snapshots/{snapshotId}/review");
        var filtered = await TimeAsync(client, $"/api/snapshots/{snapshotId}/review?status=matched&pageSize=100");
        var last = await TimeAsync(client, $"/api/snapshots/{snapshotId}/review?page={(entities / 500) - 1}&pageSize=500");

        var review = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/snapshots/{snapshotId}/review", UriKind.Relative));
        var counts = review.GetProperty("counts");
        Assert.Equal(decisions, counts.GetProperty("rejected").GetInt32());
        Assert.Equal(catalogItems / 2, counts.GetProperty("matched").GetInt32());
        Assert.Equal(entities - decisions - (catalogItems / 2), counts.GetProperty("new").GetInt32());

        output.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"{entities} entidades, {decisions} decisiones, {catalogItems} elementos del catálogo; paquete {pack.Length / 1024} KB"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"  subir y guardar: {upload.ElapsedMilliseconds} ms"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"  revisión, primera página (50): mediana {first.Median} ms, máximo {first.Max} ms"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"  revisión filtrada (matched, 100): mediana {filtered.Median} ms, máximo {filtered.Max} ms"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"  revisión, última página (500): mediana {last.Median} ms, máximo {last.Max} ms"));
        Assert.True(first.Median < 5_000, $"La revisión tardó {first.Median} ms");
        Assert.True(last.Median < 5_000, $"La última página tardó {last.Median} ms");
    }

    private static async Task<(long Median, long Max)> TimeAsync(HttpClient client, string uri)
    {
        var times = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var watch = Stopwatch.StartNew();
            var response = await client.GetAsync(new Uri(uri, UriKind.Relative));
            await response.Content.ReadAsByteArrayAsync();
            watch.Stop();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            times.Add(watch.ElapsedMilliseconds);
        }

        times.Sort();
        return (times[times.Count / 2], times[^1]);
    }

    private static string Path(int i) => string.Create(CultureInfo.InvariantCulture, $"/escala/{i:D5}");

    private static string Key(int i) => DiscoveryKeys.Api("GET", Path(i));

    /// <summary>Un paquete válido con <paramref name="count"/> APIs, cada una con su evidencia.</summary>
    private static byte[] SyntheticPack(int count)
    {
        var entities = new JsonArray();
        var evidence = new JsonArray();
        for (var i = 0; i < count; i++)
        {
            var id = string.Create(CultureInfo.InvariantCulture, $"ev-{i:D5}");
            var entity = new JsonObject
            {
                ["key"] = Key(i),
                ["kind"] = "api",
                ["title"] = $"GET {Path(i)}",
                ["basis"] = "observed",
                ["confidence"] = "high",
                ["http"] = new JsonObject { ["method"] = "GET", ["path"] = Path(i) },
                ["evidence"] = new JsonArray(id),
            };
            entity["fingerprint"] = DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(entity));
            entities.Add(entity);
            evidence.Add(new JsonObject
            {
                ["id"] = id,
                ["detector"] = "aspnetcore-endpoints",
                ["path"] = string.Create(CultureInfo.InvariantCulture, $"src/Escala/Endpoints{i / 100:D3}.cs"),
                ["lines"] = new JsonObject { ["start"] = (i % 100) + 1, ["end"] = (i % 100) + 1 },
                ["confidence"] = "high",
            });
        }

        var manifest = new JsonObject
        {
            ["format"] = "walkiepack",
            ["formatVersion"] = DiscoveryFormat.CurrentVersion,
            ["schemaVersion"] = 0,
            ["generatedAt"] = "2026-11-14T12:00:00Z",
            ["analyzer"] = new JsonObject { ["name"] = "walkie-cli", ["version"] = "0.1.0" },
            ["source"] = new JsonObject { ["id"] = Guid.CreateVersion7().ToString(), ["name"] = "escala" },
            ["detectors"] = new JsonArray(new JsonObject
            {
                ["id"] = "aspnetcore-endpoints", ["version"] = "0.1.0", ["status"] = "ran",
                ["produces"] = new JsonObject { ["entities"] = new JsonArray("api"), ["relations"] = new JsonArray() },
            }),
            ["scope"] = new JsonObject { ["include"] = new JsonArray("**/*"), ["exclude"] = new JsonArray() },
            ["completeness"] = "complete",
            ["technologies"] = new JsonArray(),
            ["limitations"] = new JsonArray(),
            ["stats"] = new JsonObject { ["files"] = count / 100, ["entities"] = count, ["relations"] = 0, ["evidence"] = count },
            ["includeSnippets"] = false,
        };
        var discovery = new JsonObject { ["entities"] = entities, ["relations"] = new JsonArray(), ["evidence"] = evidence };
        return Zip((DiscoveryFormat.ManifestPath, Encoding.UTF8.GetBytes(manifest.ToJsonString())),
                   (DiscoveryFormat.DiscoveryPath, Encoding.UTF8.GetBytes(discovery.ToJsonString())));
    }
}
