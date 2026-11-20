using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Shared.Schemas;
using Xunit.Abstractions;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// «Explorar arquitectura» y revisión por conjuntos (spec walkie-live-arquitectura, ADR-0016): la proyección calculada
/// sobre paquetes reales de la CLI (Walkie analizándose y una tienda ficticia React + .NET), su contrato, que no escribe
/// nada, el filtro por claves de la revisión y una aplicación agrupada (vincular, crear APIs y crear la feature en una
/// sola solicitud) sin duplicar ni tocar lo existente.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryArchitectureTests(WalkieApiFactory factory, ITestOutputHelper output)
{
    private static readonly bool Bench = Environment.GetEnvironmentVariable("WALKIE_BENCH") == "1";

    // ---------- Walkie analizándose ----------

    [Fact]
    public async Task La_arquitectura_de_Walkie_agrupa_por_app_y_modulo_y_distingue_ejecucion_de_contencion()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Walkie explorado");
        var snapshotId = await UploadSnapshotAsync(client, appId, WalkiePack);

        var architecture = await ArchitectureAsync(client, snapshotId);
        var groups = architecture.GetProperty("groups").EnumerateArray().ToList();
        var web = groups.Single(g => g.GetProperty("key").GetString() == "frontend:service:@walkie/web");
        Assert.Equal("frontend", web.GetProperty("kind").GetString());
        Assert.True(web.GetProperty("counts").GetProperty("screen").GetInt32() >= 11);
        Assert.Equal(3, web.GetProperty("counts").GetProperty("feature").GetInt32());
        var modules = groups.Where(g => g.GetProperty("kind").GetString() == "module").Select(g => g.GetProperty("title").GetString()).ToList();
        Assert.Contains("Walkie.Modules.Apps", modules);
        Assert.Contains("Walkie.Modules.Discovery", modules);

        // La web llama a los módulos (ejecución, inferida por sus hooks); exponer o contener nunca es ejecución.
        var links = architecture.GetProperty("links").EnumerateArray().ToList();
        // Categorías disjuntas (base × confianza): suman el total y cuadran con observadas, inferidas y bajas.
        Assert.All(links, l =>
        {
            int Sum(string basis) => l.GetProperty("byBasis").GetProperty(basis).EnumerateObject().Sum(c => c.Value.GetInt32());
            var split = l.GetProperty("byBasis");
            Assert.Equal(l.GetProperty("observed").GetInt32(), Sum("observed"));
            Assert.Equal(l.GetProperty("inferred").GetInt32(), Sum("inferred"));
            Assert.Equal(l.GetProperty("low").GetInt32(), split.GetProperty("observed").GetProperty("low").GetInt32() + split.GetProperty("inferred").GetProperty("low").GetInt32());
        });
        var calls = links.Single(l => l.GetProperty("from").GetString() == web.GetProperty("key").GetString()
            && l.GetProperty("to").GetString() == "module:module:Walkie.Modules.Apps" && l.GetProperty("kind").GetString() == "calls");
        Assert.Equal("execution", calls.GetProperty("semantic").GetString());
        Assert.True(calls.GetProperty("inferred").GetInt32() > 0);
        Assert.All(links.Where(l => l.GetProperty("kind").GetString() is "exposes" or "contains"), l => Assert.Equal("containment", l.GetProperty("semantic").GetString()));
        Assert.All(links.Where(l => l.GetProperty("kind").GetString() == "depends-on"), l => Assert.Equal("dependency", l.GetProperty("semantic").GetString()));
        // Dentro de un módulo: sus APIs leen y escriben su base (ejecución) y el módulo las contiene.
        var apps = groups.Single(g => g.GetProperty("key").GetString() == "module:module:Walkie.Modules.Apps");
        Assert.True(apps.GetProperty("internal").GetProperty("execution").GetInt32() > 0);
        Assert.True(apps.GetProperty("internal").GetProperty("containment").GetInt32() > 0);

        // Propuestas con su evidencia, y las limitaciones de la web en su grupo.
        var proposals = architecture.GetProperty("proposals").EnumerateArray().ToList();
        Assert.Equal(["feature:apps/web:Apps", "feature:apps/web:Catalog", "feature:apps/web:Discovery review"], proposals.Select(p => p.GetProperty("key").GetString()));
        Assert.All(proposals, p =>
        {
            Assert.Equal("evidence", p.GetProperty("strength").GetString());
            Assert.True(p.GetProperty("requests").GetInt32() > 0);
            Assert.True(p.GetProperty("navigation").GetInt32() > 0);
        });
        Assert.Contains(architecture.GetProperty("limitations").EnumerateArray(),
            l => l.GetProperty("code").GetString() == "dynamic-navigation" && l.GetProperty("group").GetString() == web.GetProperty("key").GetString());
    }

    [Fact]
    public async Task Un_grupo_se_abre_por_paginas_con_sus_relaciones_y_vecinos_y_la_vista_no_escribe_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Walkie por grupos");
        var snapshotId = await UploadSnapshotAsync(client, appId, WalkiePack);
        var group = Uri.EscapeDataString("frontend:service:@walkie/web");

        var first = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={group}&pageSize=5", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryArchitectureGroup, first));
        Assert.Equal(5, first.GetProperty("entities").GetArrayLength());
        Assert.True(first.GetProperty("total").GetInt32() > 5);
        Assert.NotEmpty(first.GetProperty("neighbors").EnumerateArray());
        Assert.All(first.GetProperty("neighbors").EnumerateArray(), n => Assert.NotEqual("frontend:service:@walkie/web", n.GetProperty("group").GetString()));

        var all = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={group}&pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
        var screens = all.GetProperty("entities").EnumerateArray().Where(e => e.GetProperty("kind").GetString() == "screen").ToList();
        Assert.All(screens, s => Assert.StartsWith("/", s.GetProperty("route").GetString(), StringComparison.Ordinal));
        Assert.Contains(all.GetProperty("relations").EnumerateArray(), r => r.GetProperty("kind").GetString() == "calls" && r.GetProperty("semantic").GetString() == "execution");

        // Una relación inferida trae su cadena: la pantalla, el hook y el cliente, cada uno con su archivo.
        var inferred = all.GetProperty("relations").EnumerateArray().First(r => r.GetProperty("kind").GetString() == "calls" && r.GetProperty("basis").GetString() == "inferred");
        var chain = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/relation-evidence?key={Uri.EscapeDataString(inferred.GetProperty("key").GetString()!)}", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryRelationEvidence, chain));
        Assert.True(chain.GetProperty("evidence").GetArrayLength() >= 3);
        Assert.Contains(chain.GetProperty("evidence").EnumerateArray(), e => e.GetProperty("path").GetString() == "apps/web/src/api/client.ts");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/relation-evidence?key=nada", UriKind.Relative))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={group}&pageSize=0", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key=nada", UriKind.Relative))).StatusCode);

        // Explorar no decide ni crea nada: la revisión sigue igual y el catálogo vacío.
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(0, review.GetProperty("counts").GetProperty("linked").GetInt32() + review.GetProperty("counts").GetProperty("created").GetInt32());
        var catalog = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(0, catalog.GetArrayLength());
    }

    [Fact]
    public async Task La_revision_se_filtra_por_las_claves_de_un_conjunto()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Revisión por claves");
        var snapshotId = await UploadSnapshotAsync(client, appId, Shop(Guid.CreateVersion7()));
        var keys = new[] { "api:GET /api/pedidos", "screen:web:/pedidos" };

        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?" + string.Join('&', keys.Select(k => "key=" + Uri.EscapeDataString(k))), UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(keys.Order(StringComparer.Ordinal), review.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()).Order(StringComparer.Ordinal));
        var tooMany = string.Join('&', Enumerable.Range(0, 501).Select(i => "key=k" + i.ToString(CultureInfo.InvariantCulture)));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?{tooMany}", UriKind.Relative))).StatusCode);
    }

    // ---------- Revisión por conjuntos ----------

    [Fact]
    public async Task Un_conjunto_se_incorpora_en_una_sola_aplicacion_sin_duplicar_ni_tocar_lo_existente()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Tienda por conjuntos");
        var untouched = await FeatureWithCanvasAsync(client, appId);
        var existing = await CatalogItemAsync(client, appId, "Lista de pedidos (a mano)", "GET", "/api/pedidos");
        var snapshotId = await UploadSnapshotAsync(client, appId, Shop(Guid.CreateVersion7()));

        // La propuesta, con su estado en el catálogo: la lista coincide por firma con lo hecho a mano; el resto es nuevo.
        var proposal = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single();
        Assert.Equal("feature:web:Pedidos", proposal.GetProperty("key").GetString());
        var members = proposal.GetProperty("members").EnumerateArray().Select(m => m.GetString()!).ToList();
        var apis = members.Where(m => m.StartsWith("api:", StringComparison.Ordinal)).ToList();
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?" + string.Join('&', apis.Select(k => "key=" + Uri.EscapeDataString(k))), UriKind.Relative)), HttpStatusCode.OK);
        var list = review.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("key").GetString() == "api:GET /api/pedidos");
        Assert.Equal("matched", list.GetProperty("status").GetString());

        // Una sola solicitud: vincular la que coincide, crear las que faltan y crear la feature con su lienzo.
        var ids = apis.Where(a => a != "api:GET /api/pedidos").ToDictionary(a => a, _ => Guid.CreateVersion7());
        var featureId = Guid.CreateVersion7();
        var operations = new List<JsonObject> { Link("api:GET /api/pedidos", existing) };
        operations.AddRange(ids.Select(p => Create(p.Key, p.Value)));
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [.. operations, Create("feature:web:Pedidos", featureId)]), HttpStatusCode.OK);
        var draft = Created(preview, "feature:web:Pedidos").GetProperty("canvas");
        // El vínculo de esta misma solicitud ya cuenta para el lienzo: la lista va a lo hecho a mano, no a una copia.
        Assert.Contains(draft.GetProperty("nodes").EnumerateArray(), n => n.TryGetProperty("catalogId", out var c) && c.GetGuid() == existing);
        Assert.DoesNotContain(draft.GetProperty("omitted").EnumerateArray(), o => o.GetProperty("code").GetString() == "api-undecided");

        var applyId = Guid.CreateVersion7();
        operations.Add(Create("feature:web:Pedidos", featureId, Canvas(draft)));
        var result = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, false, [.. operations]), HttpStatusCode.OK);
        Assert.Equal("completed", result.GetProperty("status").GetString());
        // Un reintento con el mismo applyId no crea nada más.
        var again = await JsonAsync(await ApplyAsync(client, snapshotId, applyId, false, [.. operations]), HttpStatusCode.OK);
        Assert.Equal(result.GetProperty("created").GetArrayLength(), again.GetProperty("created").GetArrayLength());

        var catalog = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(1 + ids.Count, catalog.GetArrayLength()); // lo hecho a mano + lo nuevo; ninguna copia
        Assert.Single(catalog.EnumerateArray(), i => i.GetProperty("http").GetProperty("path").GetString() == "/api/pedidos" && i.GetProperty("http").GetProperty("method").GetString() == "GET");
        var graph = await JsonAsync(await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)), HttpStatusCode.OK);
        var edges = graph.GetProperty("edges").EnumerateObject().Select(e => e.Value.GetProperty("kind").GetString()).ToList();
        Assert.Contains("navigation", edges);
        Assert.Contains("request", edges);
        Assert.Contains(graph.GetProperty("nodes").EnumerateObject(), n => n.Value.TryGetProperty("catalogId", out var c) && c.GetGuid() == existing);
        Assert.True(JsonElement.DeepEquals(untouched.Graph, await JsonAsync(await client.GetAsync(new Uri($"/api/features/{untouched.Id}/canvas", UriKind.Relative)), HttpStatusCode.OK)));

        // Y la arquitectura dice que la propuesta ya se decidió.
        var after = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single();
        Assert.Equal("created", after.GetProperty("decision").GetString());
    }

    [Fact]
    public async Task Una_propuesta_de_mas_de_500_miembros_dice_su_total_y_no_se_crea_de_una_vez()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Propuesta enorme");
        var snapshotId = await UploadSnapshotAsync(client, appId, Huge(501));

        var proposal = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single();
        Assert.Equal(503, proposal.GetProperty("memberCount").GetInt32()); // 2 pantallas y 501 APIs
        Assert.Equal(500, proposal.GetProperty("members").GetArrayLength());

        // El backend no confía en la lista del navegador: rechaza crearla de una vez, también en la vista previa.
        var key = proposal.GetProperty("key").GetString()!;
        foreach (var dryRun in new[] { true, false })
        {
            var response = await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), dryRun, [Create(key, Guid.CreateVersion7())]);
            var problem = await JsonAsync(response, HttpStatusCode.BadRequest);
            Assert.Contains("503 miembros", problem.GetProperty("errors").GetProperty("/operations/0/entityKey")[0].GetString(), StringComparison.Ordinal);
        }

        // La revisión individual sigue: una de sus APIs se crea sola.
        var created = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [Create("api:GET /api/pedidos/r0", Guid.CreateVersion7())]), HttpStatusCode.OK);
        Assert.Equal("completed", created.GetProperty("status").GetString());
        var features = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(0, features.GetArrayLength());
    }

    [Theory]
    [InlineData(499, true)]
    [InlineData(500, true)]
    [InlineData(501, false)]
    public async Task El_limite_de_500_miembros_es_exacto(int members, bool creates)
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, $"Propuesta de {members}");
        var snapshotId = await UploadSnapshotAsync(client, appId, Huge(members - 2)); // 2 pantallas y el resto APIs

        var proposal = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single();
        Assert.Equal(members, proposal.GetProperty("memberCount").GetInt32());
        Assert.Equal(Math.Min(members, 500), proposal.GetProperty("members").GetArrayLength());
        // Con exactamente 500, la lista está entera: la revisión puede pedir todos los miembros en una consulta.
        var keys = proposal.GetProperty("members").EnumerateArray().Select(m => m.GetString()!).ToList();
        var review = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500&" + string.Join('&', keys.Select(k => "key=" + Uri.EscapeDataString(k))), UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(keys.Count, review.GetProperty("items").GetArrayLength());

        var key = proposal.GetProperty("key").GetString()!;
        var featureId = Guid.CreateVersion7();
        var preview = await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [Create(key, featureId)]);
        if (!creates)
        {
            await JsonAsync(preview, HttpStatusCode.BadRequest);
            return;
        }

        var draft = Created(await JsonAsync(preview, HttpStatusCode.OK), key).GetProperty("canvas");
        // Lo que la persona no decidió no entra: las APIs sin decidir quedan como omitidas, nunca creadas en silencio.
        Assert.Equal(members - 2, draft.GetProperty("omitted").EnumerateArray().Count(o => o.GetProperty("code").GetString() == "api-undecided"));
        var result = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [Create(key, featureId, Canvas(draft))]), HttpStatusCode.OK);
        Assert.Equal("completed", result.GetProperty("status").GetString());
        var catalog = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(0, catalog.GetArrayLength());
    }

    [Fact]
    public async Task Si_un_miembro_cambia_entre_la_vista_previa_y_la_confirmacion_no_se_crea_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client, "Cambio a mitad");
        var snapshotId = await UploadSnapshotAsync(client, appId, Shop(Guid.CreateVersion7()));
        var proposal = (await ArchitectureAsync(client, snapshotId)).GetProperty("proposals").EnumerateArray().Single();
        var key = proposal.GetProperty("key").GetString()!;
        var apis = proposal.GetProperty("members").EnumerateArray().Select(m => m.GetString()!).Where(m => m.StartsWith("api:", StringComparison.Ordinal)).ToList();

        // La persona revisa: crear las APIs y la feature.
        var operations = apis.Select(a => Create(a, Guid.CreateVersion7())).ToList();
        var featureId = Guid.CreateVersion7();
        var preview = await JsonAsync(await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), true, [.. operations, Create(key, featureId)]), HttpStatusCode.OK);
        var draft = Created(preview, key).GetProperty("canvas");

        // Mientras tanto, otra decisión descarta una de esas APIs.
        var reject = new JsonObject { ["op"] = "reject", ["entityKey"] = apis[0], ["bindingVersion"] = 0 };
        Assert.Equal(HttpStatusCode.OK, (await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [reject])).StatusCode);

        // La confirmación de lo revisado ya no vale: 409 y nada creado (ni la feature ni las demás APIs).
        var confirm = await ApplyAsync(client, snapshotId, Guid.CreateVersion7(), false, [.. operations, Create(key, featureId, Canvas(draft))]);
        Assert.Equal(HttpStatusCode.Conflict, confirm.StatusCode);
        var catalog = await JsonAsync(await client.GetAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Equal(0, catalog.GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative))).StatusCode);
    }

    // ---------- Escala ----------

    [Fact]
    public async Task La_arquitectura_de_un_analisis_grande_responde_en_su_presupuesto()
    {
        using var client = factory.CreateAuthenticatedClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var appId = await CreateAppAsync(client, "Arquitectura a escala");
        foreach (var resources in Bench ? new[] { 400, 2_900 } : [400])
        {
            var pack = Synthetic(resources);
            var snapshotId = await UploadSnapshotAsync(client, appId, pack);
            var entities = Open(pack).Discovery["entities"]!.AsArray().Count;
            var overview = new List<long>();
            var detail = new List<long>();
            JsonElement architecture = default;
            for (var i = 0; i < 5; i++)
            {
                var watch = Stopwatch.StartNew();
                architecture = await ArchitectureAsync(client, snapshotId);
                overview.Add(watch.ElapsedMilliseconds);
                watch.Restart();
                var group = architecture.GetProperty("groups")[0].GetProperty("key").GetString()!;
                await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={Uri.EscapeDataString(group)}", UriKind.Relative)), HttpStatusCode.OK);
                detail.Add(watch.ElapsedMilliseconds);
            }

            overview.Sort();
            detail.Sort();
            output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                $"  {entities} entidades: vista general {overview[2]} ms (mediana), grupo {detail[2]} ms; {architecture.GetProperty("groups").GetArrayLength()} grupos, {architecture.GetProperty("links").GetArrayLength()} vínculos, {architecture.GetProperty("proposals").GetArrayLength()} propuestas"));
            // Holgado a propósito: atrapa un orden peor (cuadrático, N+1), no ruido de la máquina.
            Assert.True(overview[2] < (entities > 10_000 ? 4_000 : 1_000), $"Vista general: {overview[2]} ms con {entities} entidades.");
            Assert.True(architecture.GetProperty("groups").GetArrayLength() < 50, "La vista general agrupa: nunca una caja por hallazgo.");

            // Un grupo de más de 500 hallazgos se recorre por páginas: sin repetir ni saltear, siempre en el mismo orden.
            var biggest = architecture.GetProperty("groups").EnumerateArray()
                .OrderByDescending(g => g.GetProperty("counts").EnumerateObject().Sum(c => c.Value.GetInt32())).First().GetProperty("key").GetString()!;
            var seen = new List<string>();
            var total = 0;
            for (var page = 0; page == 0 || seen.Count < total; page++)
            {
                var detailPage = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={Uri.EscapeDataString(biggest)}&page={page}&pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
                total = detailPage.GetProperty("total").GetInt32();
                var keys = detailPage.GetProperty("entities").EnumerateArray().Select(e => e.GetProperty("key").GetString()!).ToList();
                Assert.InRange(keys.Count, 1, 500);
                seen.AddRange(keys);
            }

            Assert.True(total > 500, $"El grupo más grande tiene {total} hallazgos: la prueba necesita más de 500.");
            Assert.Equal(total, seen.Distinct(StringComparer.Ordinal).Count());
            var again = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture/group?key={Uri.EscapeDataString(biggest)}&page=1&pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
            Assert.Equal(seen.Skip(500).Take(500), again.GetProperty("entities").EnumerateArray().Select(e => e.GetProperty("key").GetString()!));
        }
    }

    // ---------- Proyectos de prueba ----------

    /// <summary>Una tienda ficticia React + .NET: listado, detalle y edición de pedidos, con su servicio y EF Core.</summary>
    private static byte[] Shop(Guid source) => Scan(new Dictionary<string, string>
    {
        ["Directory.Build.props"] = "<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
        ["api/Tienda.Api/Tienda.Api.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>",
        ["api/Tienda.Api/Program.cs"] = """
            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddDbContext<TiendaDbContext>(o => o.UseNpgsql("Host=db"));
            var app = builder.Build();
            var pedidos = app.MapGroup("/api/pedidos");
            pedidos.MapGet("/", (PedidosService s) => s.Listar());
            pedidos.MapGet("/{id:guid}", (Guid id, PedidosService s) => s.Obtener(id));
            pedidos.MapPut("/{id:guid}", (Guid id, PedidosService s) => s.Editar(id));
            app.Run();
            public sealed class PedidosService(TiendaDbContext db)
            {
                public object Listar() => db.Pedidos.AsNoTracking().ToList();
                public object Obtener(Guid id) => db.Pedidos.Single(p => p.Id == id);
                public object Editar(Guid id) { var p = db.Pedidos.Single(x => x.Id == id); db.SaveChanges(); return p; }
            }
            public sealed class TiendaDbContext(DbContextOptions<TiendaDbContext> o) : DbContext(o) { public DbSet<Pedido> Pedidos { get; set; } = null!; }
            """,
        ["web/package.json"] = """{ "name": "tienda-web", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""",
        ["web/src/api.ts"] = """
            export const listar = () => fetch('/api/pedidos');
            export const obtener = (id: string) => fetch(`/api/pedidos/${id}`);
            export const editar = (id: string) => fetch(`/api/pedidos/${id}`, { method: 'PUT' });
            export const pedidoPath = (id: string) => `/pedidos/${id}`;
            """,
        ["web/src/rutas.tsx"] = """
            import { createBrowserRouter } from 'react-router-dom';
            import { PedidosPage, PedidoPage, EditarPedidoPage } from './paginas';
            export const router = createBrowserRouter([
              { path: '/pedidos', element: <PedidosPage /> },
              { path: '/pedidos/:id', element: <PedidoPage /> },
              { path: '/pedidos/:id/editar', element: <EditarPedidoPage /> },
            ]);
            """,
        ["web/src/paginas.tsx"] = """
            import { Link, useNavigate } from 'react-router-dom';
            import { listar, obtener, editar, pedidoPath } from './api';
            export function PedidosPage() { listar(); return <Link to={pedidoPath('1')}>Ver</Link>; }
            export function PedidoPage({ id }: { id: string }) { obtener(id); return <Link to={`/pedidos/${id}/editar`}>Editar</Link>; }
            export function EditarPedidoPage({ id }: { id: string }) { const navigate = useNavigate(); obtener(id); return <form onSubmit={() => editar(id).then(() => navigate(pedidoPath(id)))} />; }
            """,
    }, "--source-id", source.ToString());

    /// <summary>Una lista y su detalle que navegan entre sí; la lista llama a <paramref name="apis"/> APIs distintas (una propuesta enorme).</summary>
    private static byte[] Huge(int apis) => Scan(new Dictionary<string, string>
    {
        ["web/package.json"] = """{ "name": "enorme", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""",
        ["web/src/rutas.tsx"] = """
            import { createBrowserRouter } from 'react-router-dom';
            import { PedidosPage, PedidoPage } from './paginas';
            export const router = createBrowserRouter([
              { path: '/pedidos', element: <PedidosPage /> },
              { path: '/pedidos/:id', element: <PedidoPage /> },
            ]);
            """,
        ["web/src/paginas.tsx"] = "import { Link } from 'react-router-dom';\n"
            + "export function PedidosPage() {\n"
            + string.Concat(Enumerable.Range(0, apis).Select(i => string.Create(CultureInfo.InvariantCulture, $"  fetch('/api/pedidos/r{i}');\n")))
            + "  return <Link to={`/pedidos/${1}`}>Ver</Link>;\n}\n"
            + "export function PedidoPage() { fetch('/api/pedidos/r0'); return <Link to=\"/pedidos\">Volver</Link>; }\n",
    }, "--source-id", Guid.CreateVersion7().ToString());

    /// <summary>Un front sintético de muchos recursos (listado, detalle y edición, con su cliente y sus hooks), analizado por la CLI.</summary>
    private static byte[] Synthetic(int resources)
    {
        var files = new Dictionary<string, string>
        {
            ["web/package.json"] = """{ "name": "sintetica", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""",
            ["web/src/api/client.ts"] = """
                const baseUrl = import.meta.env.VITE_API ?? '';
                export async function request<T>(path: string, init: RequestInit = {}): Promise<T> { return (await fetch(`${baseUrl}${path}`, init)).json(); }
                """,
        };
        var routes = new StringBuilder("import { createBrowserRouter } from 'react-router-dom';\n");
        var list = new List<string>();
        for (var i = 0; i < resources; i++)
        {
            var r = string.Create(CultureInfo.InvariantCulture, $"recurso{i}");
            files[$"web/src/{r}/api.ts"] = $$"""
                import { request } from '../api/client';
                export const listar = () => request('/api/{{r}}');
                export const obtener = (id: string) => request(`/api/{{r}}/${id}`);
                export const editar = (id: string) => request(`/api/{{r}}/${id}`, { method: 'PUT' });
                """;
            files[$"web/src/{r}/paginas.tsx"] = $$"""
                import { Link } from 'react-router-dom';
                import { listar, obtener, editar } from './api';
                export function PedidosPage() { listar(); return <Link to="/{{r}}/1">Ver</Link>; }
                export function Detalle({ id }: { id: string }) { obtener(id); return <Link to="/{{r}}">Volver</Link>; }
                export function Edicion({ id }: { id: string }) { editar(id); return <Link to={`/{{r}}/${id}`}>Ver</Link>; }
                """;
            routes.Append(CultureInfo.InvariantCulture, $"import {{ Lista as L{i}, Detalle as D{i}, Edicion as E{i} }} from './{r}/paginas';\n");
            list.Add(string.Create(CultureInfo.InvariantCulture, $"{{ path: '/{r}', element: <L{i} /> }}, {{ path: '/{r}/:id', element: <D{i} /> }}, {{ path: '/{r}/:id/editar', element: <E{i} /> }}"));
        }

        files["web/src/rutas.tsx"] = routes + "export const router = createBrowserRouter([\n" + string.Join(",\n", list) + "\n]);\n";
        return Scan(files, "--source-id", Guid.CreateVersion7().ToString());
    }

    // ---------- API ----------

    private static async Task<JsonElement> ArchitectureAsync(HttpClient client, Guid snapshotId)
    {
        var architecture = await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture", UriKind.Relative)), HttpStatusCode.OK);
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryArchitecture, architecture));
        return architecture;
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client, string name) =>
        (await (await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(name + " " + Guid.NewGuid().ToString("N")[..6]))).Content.ReadFromJsonAsync<AppResponse>())!.Id;

    private static async Task<Guid> UploadSnapshotAsync(HttpClient client, Guid appId, byte[] pack) =>
        (await JsonAsync(await UploadAsync(client, appId, pack), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();

    private static async Task<(Guid Id, JsonElement Graph)> FeatureWithCanvasAsync(HttpClient client, Guid appId)
    {
        var feature = await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/features", UriKind.Relative), new { name = "Hecha a mano" }), HttpStatusCode.Created);
        var id = feature.GetProperty("id").GetGuid();
        var node = Guid.CreateVersion7().ToString();
        var graph = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0,
            ["nodes"] = new JsonObject { [node] = new JsonObject { ["id"] = node, ["type"] = "screen", ["title"] = "Inicio" } },
            ["edges"] = new JsonObject(),
            ["layout"] = new JsonObject { [node] = new JsonObject { ["x"] = 0, ["y"] = 0 } },
        };
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(new Uri($"/api/features/{id}/canvas", UriKind.Relative), graph)).StatusCode);
        return (id, await JsonAsync(await client.GetAsync(new Uri($"/api/features/{id}/canvas", UriKind.Relative)), HttpStatusCode.OK));
    }

    private static async Task<Guid> CatalogItemAsync(HttpClient client, Guid appId, string title, string method, string path)
    {
        var response = await client.PostAsJsonAsync(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), new { type = "api", title, http = new { method, path } });
        return (await JsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    private static Task<HttpResponseMessage> ApplyAsync(HttpClient client, Guid snapshotId, Guid applyId, bool dryRun, JsonObject[] operations) =>
        client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative),
            new JsonObject { ["applyId"] = applyId.ToString(), ["operations"] = new JsonArray([.. operations.Select(o => o.DeepClone())]) });

    private static JsonObject Create(string key, Guid id, JsonObject? canvas = null)
    {
        var op = new JsonObject { ["op"] = "create", ["entityKey"] = key, ["id"] = id.ToString(), ["bindingVersion"] = 0 };
        if (canvas is not null)
        {
            op["canvas"] = canvas.DeepClone();
        }

        return op;
    }

    private static JsonObject Link(string key, Guid itemId) =>
        new() { ["op"] = "link", ["entityKey"] = key, ["target"] = new JsonObject { ["kind"] = "catalogItem", ["id"] = itemId.ToString() }, ["bindingVersion"] = 0 };

    private static JsonElement Created(JsonElement result, string key) =>
        result.GetProperty("created").EnumerateArray().Single(c => c.GetProperty("entityKey").GetString() == key);

    private static JsonObject Canvas(JsonElement draft)
    {
        JsonObject Ids(string name) => new([.. draft.GetProperty(name).EnumerateArray()
            .Select(i => KeyValuePair.Create(i.GetProperty("key").GetString()!, (JsonNode?)Guid.CreateVersion7().ToString()))]);
        var layout = new JsonObject();
        var index = 0;
        foreach (var node in draft.GetProperty("nodes").EnumerateArray())
        {
            layout[node.GetProperty("key").GetString()!] = new JsonObject { ["x"] = index % 3 * 264, ["y"] = index / 3 * 160 };
            index++;
        }

        return new JsonObject { ["nodes"] = Ids("nodes"), ["edges"] = Ids("edges"), ["interfaces"] = Ids("interfaces"), ["layout"] = layout };
    }
}
