using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Arquitectura descubierta permanente (spec walkie-live-documentacion, parte 1): decidir todo no la vacía ni la
/// esconde. Cada hallazgo y cada propuesta dice su estado en Walkie (el mismo de la revisión), a qué elemento
/// documentado apunta y si se borró; un reanálisis conserva las decisiones y se compara con el anterior.
/// </summary>
public sealed partial class DiscoveryArchitectureTests
{
    private static readonly string[] Decided = ["created", "linked", "rejected"];
    private static readonly string[] KeptOrChanged = ["created", "changed"];

    [Fact]
    public async Task Despues_de_decidir_todo_la_arquitectura_sigue_entera_con_el_estado_y_el_destino_de_cada_hallazgo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Tienda aprobada entera");
        var source = Guid.CreateVersion7();
        var snapshotId = await UploadSnapshotAsync(client, appId, Shop(source));

        // Antes de decidir: todo nuevo, y la propuesta lo dice.
        var before = await ArchitectureAsync(client, snapshotId);
        var proposal = before.GetProperty("proposals").EnumerateArray().Single();
        Assert.Equal("new", proposal.GetProperty("state").GetProperty("status").GetString());
        Assert.True(proposal.GetProperty("state").GetProperty("needsReview").GetBoolean());
        Assert.All(before.GetProperty("groups").EnumerateArray(), g => Assert.Equal(["new"], g.GetProperty("states").EnumerateObject().Select(p => p.Name)));
        var totalBefore = before.GetProperty("totals").GetProperty("entities").GetInt32();
        Assert.False(before.TryGetProperty("previousSnapshotId", out _));

        // Aprobar todo: la propuesta como conjunto (APIs nuevas + feature con su lienzo) y descartar el resto.
        var apis = proposal.GetProperty("members").EnumerateArray().Select(m => m.GetString()!).Where(m => m.StartsWith("api:", StringComparison.Ordinal)).ToList();
        var ids = apis.ToDictionary(a => a, _ => Guid.CreateVersion7());
        var featureId = Guid.CreateVersion7();
        var operations = ids.Select(p => Create(p.Key, p.Value)).ToList();
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [.. operations, Create("feature:web:Pedidos", featureId)]), HttpStatusCode.OK);
        operations.Add(Create("feature:web:Pedidos", featureId, Canvas(Created(preview, "feature:web:Pedidos").GetProperty("canvas"))));
        Assert.Equal("completed", (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [.. operations]), HttpStatusCode.OK)).GetProperty("status").GetString());
        var pending = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?status=new&pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
        var rejects = pending.GetProperty("items").EnumerateArray()
            .Select(i => new JsonObject { ["op"] = "reject", ["entityKey"] = i.GetProperty("key").GetString(), ["bindingVersion"] = 0, ["note"] = "fuera de alcance" })
            .ToArray();
        Assert.NotEmpty(rejects);
        Assert.Equal("completed", (await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, rejects), HttpStatusCode.OK)).GetProperty("status").GetString());

        // Después: los mismos hallazgos y relaciones; nada pendiente; la feature, «Ya en Walkie» con su destino.
        var after = await ArchitectureAsync(client, snapshotId);
        Assert.Equal(totalBefore, after.GetProperty("totals").GetProperty("entities").GetInt32());
        Assert.Equal(before.GetProperty("totals").GetProperty("relations").GetInt32(), after.GetProperty("totals").GetProperty("relations").GetInt32());
        var decided = after.GetProperty("proposals").EnumerateArray().Single().GetProperty("state");
        Assert.Equal("created", decided.GetProperty("status").GetString());
        Assert.Equal("feature", decided.GetProperty("target").GetProperty("kind").GetString());
        Assert.Equal(featureId, decided.GetProperty("target").GetProperty("id").GetGuid());
        Assert.False(string.IsNullOrEmpty(decided.GetProperty("target").GetProperty("title").GetString()));
        Assert.False(decided.GetProperty("needsReview").GetBoolean());
        foreach (var group in after.GetProperty("groups").EnumerateArray())
        {
            Assert.DoesNotContain("new", group.GetProperty("states").EnumerateObject().Select(p => p.Name));
            var inside = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={Uri.EscapeDataString(group.GetProperty("key").GetString()!)}", UriKind.Relative)), HttpStatusCode.OK);
            Assert.Empty(Walkie.Shared.Schemas.WalkieSchemas.Errors(Walkie.Shared.Schemas.WalkieSchemas.DiscoveryArchitectureGroup, inside));
            Assert.All(inside.GetProperty("entities").EnumerateArray(), e =>
            {
                var status = e.GetProperty("state").GetProperty("status").GetString();
                Assert.Contains(status, Decided);
                if (status == "created" && e.GetProperty("kind").GetString() == "api")
                {
                    Assert.Equal(ids[e.GetProperty("key").GetString()!], e.GetProperty("state").GetProperty("target").GetProperty("id").GetGuid());
                }
            });
        }

        // El destino se borra: la arquitectura lo dice (y pide revisar), sin perder el hallazgo.
        var impact = await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/deletion", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(new Uri(
            $"/api/features/{featureId}?deletionId={Guid.CreateVersion7()}&canvasVersion={impact.GetProperty("canvasVersion").GetInt32()}", UriKind.Relative))).StatusCode);
        var gone = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single().GetProperty("state");
        Assert.True(gone.GetProperty("targetMissing").GetBoolean());
        Assert.True(gone.GetProperty("needsReview").GetBoolean());

        // Reanálisis con un endpoint nuevo: lo decidido se conserva, lo nuevo aparece como nuevo y se compara con el anterior.
        var second = await UploadSnapshotAsync(client, appId, Shop(source, """pedidos.MapDelete("/{id:guid}", (Guid id) => Results.NoContent());"""));
        var reanalyzed = await ArchitectureAsync(client, second);
        Assert.Equal(snapshotId, reanalyzed.GetProperty("previousSnapshotId").GetGuid());
        var states = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var group in reanalyzed.GetProperty("groups").EnumerateArray())
        {
            var inside = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{second}/architecture/group?key={Uri.EscapeDataString(group.GetProperty("key").GetString()!)}", UriKind.Relative)), HttpStatusCode.OK);
            foreach (var e in inside.GetProperty("entities").EnumerateArray())
            {
                states[e.GetProperty("key").GetString()!] = e.GetProperty("state");
            }
        }

        var added = states["api:DELETE /api/pedidos/{}"];
        Assert.Equal("new", added.GetProperty("status").GetString());
        Assert.Equal("added", added.GetProperty("change").GetString());
        foreach (var api in apis)
        {
            Assert.Contains(states[api].GetProperty("status").GetString(), KeptOrChanged);
            Assert.Equal(ids[api], states[api].GetProperty("target").GetProperty("id").GetGuid());
        }

        // El análisis anterior sigue abriéndose con sus decisiones.
        Assert.Equal("created", (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single().GetProperty("state").GetProperty("status").GetString());
    }
}
