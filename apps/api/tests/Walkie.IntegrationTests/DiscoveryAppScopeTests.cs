using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Identidad con el ámbito de la app (ADR-0014, formatVersion 1) a través de la API: paquetes de la versión 0 que se
/// migran o se rechazan, y decisiones tomadas antes con las claves viejas. Para tener «lo guardado antes», la prueba
/// escribe un análisis v0 en la base tal como lo guardaba Walkie (claves sin app, sin migrar). Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryAppScopeTests(WalkieApiFactory factory)
{
    private readonly Guid source = Guid.CreateVersion7();

    [Fact]
    public async Task Un_paquete_v0_de_una_app_se_sube_migrado_igual_que_un_analisis_nuevo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var v1 = OneApp();
        var (_, expected) = Open(v1);

        var upload = await JsonAsync(await UploadAsync(client, appId, ToV0(v1)), HttpStatusCode.Created);
        Assert.Equal(0, upload.GetProperty("snapshot").GetProperty("formatVersion").GetInt32()); // llegó como v0
        var review = await ReviewAsync(client, upload.GetProperty("snapshot").GetProperty("id").GetGuid());

        var got = review.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("key").GetString()!, i => i.GetProperty("fingerprint").GetString()!);
        var want = expected["entities"]!.AsArray().ToDictionary(e => e!["key"]!.GetValue<string>(), e => e!["fingerprint"]!.GetValue<string>());
        Assert.Equal(want.OrderBy(p => p.Key, StringComparer.Ordinal), got.OrderBy(p => p.Key, StringComparer.Ordinal));
        Assert.Contains("screen:web:/pedidos", got.Keys);
        Assert.Contains("feature:web:Pedidos", got.Keys);
    }

    [Fact]
    public async Task Un_paquete_v0_ambiguo_se_rechaza_pidiendo_reanalizar_y_no_guarda_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var response = await JsonAsync(await UploadAsync(client, appId, ToV0(TwoApps())), HttpStatusCode.BadRequest);

        var errors = response.GetProperty("errors").EnumerateObject().ToList();
        Assert.Contains(errors, e => e.Name.StartsWith("discovery.json/entities/", StringComparison.Ordinal)
            && e.Value[0].GetString()!.Contains("screen:/pedidos", StringComparison.Ordinal)
            && e.Value[0].GetString()!.Contains("vuelve a analizar", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Value[0].GetString()!.Contains("feature:Pedidos", StringComparison.Ordinal));
        var sources = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/sources", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(sources.GetProperty("sources").EnumerateArray());
    }

    [Fact]
    public async Task Las_decisiones_v0_pasan_a_su_unica_clave_nueva_sin_changed_ni_missing_falsos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, appId, "Pedidos");
        var v1 = OneApp(withLogin: true);
        var legacy = await SeedV0Async(appId, v1,
            ("screen:/login", "rejected", null),
            ("feature:Pedidos", "linked", feature),
            ("screen:/pedidos", "rejected", "sha256:" + new string('0', 64))); // se decidió sobre otro contenido

        var snapshotId = await UploadSnapshotAsync(client, appId, v1);
        var review = await ReviewAsync(client, snapshotId);

        // 9: lo decidido antes sigue decidido, con su clave nueva.
        Assert.Equal("rejected", Item(review, "screen:web:/login").GetProperty("status").GetString());
        var linked = Item(review, "feature:web:Pedidos");
        Assert.Equal("linked", linked.GetProperty("status").GetString());
        Assert.Equal("feature:Pedidos", linked.GetProperty("binding").GetProperty("decidedKey").GetString());
        Assert.Equal(legacy, linked.GetProperty("binding").GetProperty("snapshotId").GetGuid());
        // 10: ni changed ni missing por la migración; el que de verdad cambió, sí.
        Assert.Equal("changed", Item(review, "screen:web:/pedidos").GetProperty("status").GetString());
        Assert.Equal(1, review.GetProperty("counts").GetProperty("changed").GetInt32());
        Assert.Equal(0, review.GetProperty("counts").GetProperty("missing").GetInt32());
        Assert.DoesNotContain(review.GetProperty("items").EnumerateArray(), i => i.TryGetProperty("legacyBinding", out _));

        // La fila vieja queda sin decisión y dice adónde fue; nada se borró.
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
            var old = await db.Bindings.AsNoTracking().SingleAsync(b => b.AppId == appId && b.EntityKey == "screen:/login");
            Assert.Null(old.Decision);
            Assert.Contains("screen:web:/login", old.Note, StringComparison.Ordinal);
            Assert.True(await db.Entities.AnyAsync(e => e.SnapshotId == legacy && e.Key == "screen:/login")); // el análisis v0 no cambia
        }

        // La procedencia muestra el hallazgo tal como se vio al decidir (clave vieja, análisis v0).
        var provenance = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/bindings?target=feature:{feature}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryProvenance, provenance));
        var origin = provenance.GetProperty("bindings")[0];
        Assert.Equal("feature:Pedidos", origin.GetProperty("entity").GetProperty("key").GetString());
        Assert.Equal("same", origin.GetProperty("latest").GetProperty("status").GetString());

        // Subir otra vez no vuelve a mover nada.
        var again = await UploadSnapshotAsync(client, appId, OneApp(withLogin: true, extra: true));
        Assert.Equal("rejected", Item(await ReviewAsync(client, again), "screen:web:/login").GetProperty("status").GetString());
    }

    [Fact]
    public async Task Una_decision_v0_ambigua_no_se_asigna_a_ninguna_app_ni_se_da_por_desaparecida()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var v1 = TwoApps();
        await SeedV0Async(appId, v1, ("screen:/pedidos", "rejected", null));

        var snapshotId = await UploadSnapshotAsync(client, appId, v1);
        var review = await ReviewAsync(client, snapshotId);

        // 8: las dos contrapartes quedan sin decisión, cada una con la decisión vieja a la vista.
        foreach (var key in new[] { "screen:admin:/pedidos", "screen:tienda:/pedidos" })
        {
            var item = Item(review, key);
            Assert.Equal("new", item.GetProperty("status").GetString());
            Assert.False(item.TryGetProperty("binding", out _));
            Assert.Equal("screen:/pedidos", item.GetProperty("legacyBinding").GetProperty("entityKey").GetString());
        }

        Assert.Equal(0, review.GetProperty("counts").GetProperty("missing").GetInt32());

        // La persona decide sobre una de las nuevas y restablece la vieja.
        var version = Item(review, "screen:tienda:/pedidos").GetProperty("legacyBinding").GetProperty("version").GetInt32();
        var applied = await ApplyAsync(client, snapshotId,
            new JsonObject { ["op"] = "reject", ["entityKey"] = "screen:tienda:/pedidos", ["bindingVersion"] = 0 },
            new JsonObject { ["op"] = "reset", ["entityKey"] = "screen:/pedidos", ["bindingVersion"] = version });
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);

        var after = await ReviewAsync(client, snapshotId);
        Assert.Equal("rejected", Item(after, "screen:tienda:/pedidos").GetProperty("status").GetString());
        Assert.False(Item(after, "screen:admin:/pedidos").TryGetProperty("legacyBinding", out _));
        Assert.Equal(0, after.GetProperty("counts").GetProperty("missing").GetInt32());
    }

    [Fact]
    public async Task Una_decision_v0_sin_contraparte_es_missing_con_las_reglas_de_siempre()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        await SeedV0Async(appId, OneApp(withLogin: true), ("screen:/login", "rejected", null));

        var review = await ReviewAsync(client, await UploadSnapshotAsync(client, appId, OneApp(withLogin: false)));

        var missing = Item(review, "screen:/login");
        Assert.Equal("missing", missing.GetProperty("status").GetString());
        Assert.Equal("rejected", missing.GetProperty("binding").GetProperty("decision").GetString());
    }

    // ---------- Proyectos ----------

    private byte[] OneApp(bool withLogin = false, bool extra = false) => Scan(new Dictionary<string, string>
    {
        ["web/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["web/src/main.tsx"] =
            "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos, Pedido, Login, Ayuda } from './pages';\n"
            + "export const router = createBrowserRouter([\n"
            + "  { path: '/pedidos', element: <Pedidos /> },\n"
            + "  { path: '/pedidos/:id', element: <Pedido /> },\n"
            + (withLogin ? "  { path: '/login', element: <Login /> },\n" : "")
            + (extra ? "  { path: '/ayuda', element: <Ayuda /> },\n" : "")
            + "]);\n",
        ["web/src/pages.tsx"] =
            "export function Pedidos() { fetch('/api/pedidos'); return null; }\nexport const Pedido = () => null;\nexport const Login = () => null;\n"
            + (extra ? "export const Ayuda = () => null;\n" : ""),
    }, "--source-id", source.ToString());

    private byte[] TwoApps() => Scan(new Dictionary<string, string>
    {
        ["tienda/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["tienda/src/main.tsx"] = Routes,
        ["tienda/src/pages.tsx"] = "export const Pedidos = () => null;\nexport const Pedido = () => null;\n",
        ["admin/package.json"] = """{ "name": "admin-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""",
        ["admin/src/main.tsx"] = Routes,
        ["admin/src/pages.tsx"] = "export const Pedidos = () => null;\nexport const Pedido = () => null;\n",
    }, "--source-id", source.ToString());

    private const string Routes =
        "import { createBrowserRouter } from 'react-router-dom';\nimport { Pedidos, Pedido } from './pages';\n"
        + "export const router = createBrowserRouter([\n  { path: '/pedidos', element: <Pedidos /> },\n  { path: '/pedidos/:id', element: <Pedido /> },\n]);\n";

    // ---------- La versión 0, como la escribía la CLI y como la guardaba Walkie ----------

    /// <summary>
    /// El paquete que habría escrito la CLI de la versión 0 sobre el mismo árbol: claves sin app, sin <c>app</c> y la
    /// misma ruta de dos apps como una sola entidad (con la evidencia de las dos).
    /// </summary>
    private static (JsonObject Manifest, JsonObject Discovery) Downgrade(byte[] v1)
    {
        var (manifest, discovery) = Open(v1);
        manifest["formatVersion"] = 0;
        string Old(string key) => DiscoveryKeys.WithoutScope(key) ?? key;

        var entities = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var entity in discovery["entities"]!.AsArray().Select(e => e!.AsObject()))
        {
            var key = Old(entity["key"]!.GetValue<string>());
            entity.Remove("app");
            entity["key"] = key;
            foreach (var field in new[] { "members", "derivedFrom" })
            {
                if (entity[field] is JsonArray list)
                {
                    entity[field] = new JsonArray([.. list.Select(k => Old(k!.GetValue<string>())).Distinct().Order(StringComparer.Ordinal).Select(k => (JsonNode)k)]);
                }
            }

            if (entities.TryGetValue(key, out var first))
            {
                first["evidence"] = new JsonArray([.. first["evidence"]!.AsArray().Concat(entity["evidence"]!.AsArray())
                    .Select(e => e!.GetValue<string>()).Distinct().Order(StringComparer.Ordinal).Select(e => (JsonNode)e)]);
                foreach (var field in new[] { "members", "derivedFrom" })
                {
                    if (first[field] is JsonArray a && entity[field] is JsonArray b)
                    {
                        first[field] = new JsonArray([.. a.Concat(b).Select(k => k!.GetValue<string>()).Distinct().Order(StringComparer.Ordinal).Select(k => (JsonNode)k)]);
                    }
                }
            }
            else
            {
                entities[key] = entity.DeepClone().AsObject();
            }
        }

        foreach (var entity in entities.Values)
        {
            entity["fingerprint"] = DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(entity));
        }

        var relations = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var relation in discovery["relations"]!.AsArray().Select(r => r!.AsObject()))
        {
            relation["from"] = Old(relation["from"]!.GetValue<string>());
            relation["to"] = Old(relation["to"]!.GetValue<string>());
            relation["key"] = DiscoveryKeys.Relation(relation["kind"]!.GetValue<string>(), relation["from"]!.GetValue<string>(), relation["to"]!.GetValue<string>());
            relations.TryAdd(relation["key"]!.GetValue<string>(), relation.DeepClone().AsObject());
        }

        discovery["entities"] = new JsonArray([.. entities.Values]);
        discovery["relations"] = new JsonArray([.. relations.Values]);
        return (manifest, discovery);
    }

    private static byte[] ToV0(byte[] v1)
    {
        var (manifest, discovery) = Downgrade(v1);
        return Zip((DiscoveryFormat.ManifestPath, Encoding.UTF8.GetBytes(manifest.ToJsonString())),
                   (DiscoveryFormat.DiscoveryPath, Encoding.UTF8.GetBytes(discovery.ToJsonString())));
    }

    /// <summary>
    /// Escribe en la base un análisis v0 del árbol de <paramref name="v1"/> y decisiones sobre sus claves viejas, como
    /// quedaban antes de la versión 1 (sin migrar: ese camino ya no existe en la API). Devuelve el id del análisis.
    /// </summary>
    private async Task<Guid> SeedV0Async(Guid appId, byte[] v1, params (string Key, string Decision, object? TargetOrFingerprint)[] decisions)
    {
        var (manifest, discovery) = Downgrade(v1);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        var now = DateTimeOffset.UtcNow.AddMinutes(-5);
        now = new DateTimeOffset(now.Ticks - (now.Ticks % 10), TimeSpan.Zero);
        db.Sources.Add(new Source { AppId = appId, Id = source, Name = "tienda", CreatedBy = "v0", CreatedAt = now, UpdatedAt = now });
        var snapshot = new Snapshot
        {
            AppId = appId,
            SourceId = source,
            FormatVersion = 0,
            AnalyzerName = "walkie-cli",
            AnalyzerVersion = "0.1.0",
            GeneratedAt = now,
            ImportedAt = now,
            ImportedBy = "v0",
            Completeness = manifest["completeness"]!.GetValue<string>(),
            PackSha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(discovery.ToJsonString()))),
            ContentFingerprint = DiscoveryFingerprint.Content(JsonSerializer.SerializeToElement(discovery)),
            Manifest = manifest.ToJsonString(),
        };
        db.Snapshots.Add(snapshot);
        var byKey = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var e in discovery["entities"]!.AsArray().Select(e => e!.AsObject()))
        {
            byKey[e["key"]!.GetValue<string>()] = e;
            db.Entities.Add(new DiscoveredEntity
            {
                SnapshotId = snapshot.Id, Key = e["key"]!.GetValue<string>(), Kind = e["kind"]!.GetValue<string>(), Title = e["title"]!.GetValue<string>(),
                Basis = e["basis"]!.GetValue<string>(), Confidence = e["confidence"]!.GetValue<string>(), Fingerprint = e["fingerprint"]!.GetValue<string>(), Data = e.ToJsonString(),
            });
        }

        foreach (var r in discovery["relations"]!.AsArray().Select(r => r!.AsObject()))
        {
            db.Relations.Add(new DiscoveredRelation
            {
                SnapshotId = snapshot.Id, Key = r["key"]!.GetValue<string>(), Kind = r["kind"]!.GetValue<string>(), FromKey = r["from"]!.GetValue<string>(),
                ToKey = r["to"]!.GetValue<string>(), Basis = r["basis"]!.GetValue<string>(), Confidence = r["confidence"]!.GetValue<string>(), Data = r.ToJsonString(),
            });
        }

        foreach (var ev in discovery["evidence"]!.AsArray().Select(e => e!.AsObject()))
        {
            db.Evidence.Add(new DiscoveredEvidence
            {
                SnapshotId = snapshot.Id, Id = ev["id"]!.GetValue<string>(), Detector = ev["detector"]!.GetValue<string>(), Path = ev["path"]!.GetValue<string>(), Data = ev.ToJsonString(),
            });
        }

        foreach (var (key, decision, extra) in decisions)
        {
            var target = extra as Guid?;
            db.Bindings.Add(new Binding
            {
                AppId = appId, SourceId = source, EntityKey = key, Decision = decision,
                TargetKind = target is null ? null : "feature", TargetId = target, TargetTitle = target is null ? null : "Pedidos",
                EntityFingerprint = extra as string ?? byKey[key]["fingerprint"]!.GetValue<string>(),
                SnapshotId = snapshot.Id, DecidedBy = "persona-de-prueba", DecidedAt = now, Version = 1,
            });
        }

        await db.SaveChangesAsync();
        return snapshot.Id;
    }

    // ---------- API ----------

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Monorepo de prueba"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new { name });
        return (await JsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    private static async Task<Guid> UploadSnapshotAsync(HttpClient client, Guid appId, byte[] pack) =>
        (await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId)
    {
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryReview, review));
        return review;
    }

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, params JsonObject[] operations) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative),
            new JsonObject { ["applyId"] = Guid.CreateVersion7().ToString(), ["operations"] = new JsonArray([.. operations]) });

    private static JsonElement Item(JsonElement review, string key) =>
        review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == key);
}
