using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Features;
using Walkie.Modules.Apps.Persistence;
using Walkie.Modules.Sharing.Contracts;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Revisión final de la eliminación (ADR-0017): identidad de un id de eliminación, exclusión mutua de sus ejecutores
/// (candado exclusivo de la app + ficha) y escrituras en curso (candado compartido). Todo con barreras: una prueba
/// detiene una solicitud en un punto conocido y espera a que la otra esté bloqueada en PostgreSQL
/// (<c>pg_stat_activity</c>), sin pausas por tiempo.
/// </summary>
public sealed partial class DeletionTests
{
    // ---------- Identidad de un id de eliminación ----------

    [Fact]
    public async Task Un_mismo_id_no_sirve_para_dos_features()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Un id dos features");
        var first = await FeatureAsync(client, app, "Primera");
        var second = await FeatureAsync(client, app, "Segunda");
        var id = Guid.CreateVersion7();

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteFeatureAsync(client, first, id, 0)).StatusCode);
        var problem = await JsonAsync(await DeleteFeatureAsync(client, second, id, 0), HttpStatusCode.Conflict);
        Assert.Contains("otra solicitud", problem.GetProperty("title").GetString(), StringComparison.Ordinal);

        Assert.True(await AppsAsync(db => db.Features.AnyAsync(f => f.Id == second)));
        Assert.Equal(first, await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.FeatureId).SingleAsync()));
    }

    [Fact]
    public async Task Un_mismo_id_no_sirve_para_dos_apps()
    {
        using var client = factory.CreateAuthenticatedClient();
        var nameA = "Un id app A " + Suffix();
        var nameB = "Un id app B " + Suffix();
        var a = await AppExactAsync(client, nameA);
        var b = await AppExactAsync(client, nameB);
        var id = Guid.CreateVersion7();

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAppAsync(client, a, id, nameA)).StatusCode);
        await JsonAsync(await DeleteAppAsync(client, b, id, nameB), HttpStatusCode.Conflict);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/apps/{b}", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task Un_mismo_id_no_sirve_para_una_feature_y_una_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "Un id feature y app " + Suffix();
        var app = await AppExactAsync(client, name);
        var feature = await FeatureAsync(client, app, "Sola");
        var other = await FeatureAsync(client, app, "Otra");

        // Feature y después app con el mismo id.
        var id = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteFeatureAsync(client, feature, id, 0)).StatusCode);
        await JsonAsync(await DeleteAppAsync(client, app, id, name), HttpStatusCode.Conflict);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);

        // App y después feature con el mismo id.
        var otherName = "Un id app y feature " + Suffix();
        var otherApp = await AppExactAsync(client, otherName);
        var id2 = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAppAsync(client, otherApp, id2, otherName)).StatusCode);
        await JsonAsync(await DeleteFeatureAsync(client, other, id2, 0), HttpStatusCode.Conflict);
        Assert.True(await AppsAsync(db => db.Features.AnyAsync(f => f.Id == other)));
    }

    [Fact]
    public async Task El_mismo_id_dos_veces_a_la_vez_elimina_una_sola_vez_y_con_otros_datos_es_conflicto()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Doble clic");
        var feature = await FeatureAsync(client, app, "Una");
        var id = Guid.CreateVersion7();
        var locked = new Pause();
        using var host = WithHooks(deletion: (step, d) => step == DeletionHandlers.LockedStep && d == id ? locked.HitAsync() : Task.CompletedTask);
        using var hooked = Authenticated(host);

        var first = DeleteFeatureAsync(hooked, feature, id, 0);
        await locked.Reached;
        // Mientras la primera tiene el candado: la misma solicitud y otra con datos distintos esperan en PostgreSQL.
        var same = DeleteFeatureAsync(hooked, feature, id, 0);
        var different = DeleteFeatureAsync(hooked, feature, id, 7);
        await WaitingOnLockAsync(AppLocks.DeletionSession(id), count: 2);
        locked.Release();

        Assert.Equal(HttpStatusCode.NoContent, (await first).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await same).StatusCode);
        await JsonAsync(await different, HttpStatusCode.Conflict);
        Assert.Equal(1, locked.Hits);
        Assert.Equal(1, await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Attempts).SingleAsync()));
    }

    // ---------- Exclusión mutua de los ejecutores ----------

    [Fact]
    public async Task Una_ejecucion_larga_no_la_retoma_nadie_aunque_haya_vencido_la_espera_ni_desde_otra_instancia()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Ejecución larga");
        var feature = await FeatureAsync(client, app, "Lenta");
        await PutCanvasAsync(client, feature, Graph(null, null, null));
        var version = (await ImpactAsync(client, $"/api/features/{feature}/deletion")).GetProperty("canvasVersion").GetInt32();
        var id = Guid.CreateVersion7();
        var slow = new Pause();
        Func<string, Guid, Task> hook = (step, d) => step == "canvas" && d == id ? slow.HitAsync() : Task.CompletedTask;
        using var first = WithHooks(deletion: hook);
        using var second = WithHooks(deletion: hook);
        using var running = Authenticated(first);

        var request = DeleteFeatureAsync(running, feature, id, version);
        await slow.Reached;
        // Como si hubieran pasado horas: sin espera pendiente y con la bitácora pending.
        await ExpireLeaseAsync(id);

        // Dos instancias del servicio de recuperación a la vez, y la consulta del estado: ninguna la ejecuta.
        var scopes = new[] { first, second }.Select(h => h.Services.GetRequiredService<IServiceScopeFactory>()).ToArray();
        await Task.WhenAll(scopes.Select(s => DeletionRecovery.RecoverOnceAsync(s, CancellationToken.None)));
        using var other = Authenticated(second);
        Assert.Equal("pending", (await JsonAsync(await other.GetAsync(new Uri($"/api/deletions/{id}", UriKind.Relative)), HttpStatusCode.OK)).GetProperty("status").GetString());
        Assert.Equal(1, slow.Hits);
        Assert.Equal(1, await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Attempts).SingleAsync()));

        slow.Release();
        Assert.Equal(HttpStatusCode.NoContent, (await request).StatusCode);
        Assert.Equal(1, slow.Hits);
        Assert.Equal(1, await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Attempts).SingleAsync()));
    }

    [Fact]
    public async Task Si_el_ejecutor_se_cae_la_recuperacion_legitima_la_termina()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Ejecutor caído");
        var feature = await FeatureAsync(client, app, "Huérfana no");
        await PutCanvasAsync(client, feature, Graph(null, null, null));
        var version = (await ImpactAsync(client, $"/api/features/{feature}/deletion")).GetProperty("canvasVersion").GetInt32();
        var id = Guid.CreateVersion7();
        var crashed = 0;
        using var host = WithHooks(deletion: (step, d) =>
            step == "canvas" && d == id && Interlocked.Increment(ref crashed) == 1 ? throw new DeletionAbandonedException() : Task.CompletedTask);
        using var hooked = Authenticated(host);

        await CrashAsync(() => DeleteFeatureAsync(hooked, feature, id, version));

        // El proceso «murió» en el paso del lienzo: la bitácora pending, sin error escrito, y el candado suelto.
        var journal = await AppsAsync(db => db.Deletions.AsNoTracking().SingleAsync(d => d.Id == id));
        Assert.Equal("pending", journal.Status);
        Assert.Null(journal.Error);
        Assert.NotNull(journal.OwnerToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/features/{feature}/canvas", UriKind.Relative))).StatusCode);
        Assert.True(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == feature)));

        Assert.True(await DeletionRecovery.RecoverOnceAsync(host.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None) >= 1);
        var done = await AppsAsync(db => db.Deletions.AsNoTracking().SingleAsync(d => d.Id == id));
        Assert.Equal("completed", done.Status);
        Assert.Equal(2, done.Attempts);
        Assert.Null(done.OwnerToken);
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == feature)));
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.Id == feature)));
    }

    [Fact]
    public async Task Un_ejecutor_que_perdio_el_candado_no_escribe_nada_y_otro_la_termina()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Candado perdido");
        var feature = await FeatureAsync(client, app, "Disputada");
        await PutCanvasAsync(client, feature, Graph(null, null, null));
        var version = (await ImpactAsync(client, $"/api/features/{feature}/deletion")).GetProperty("canvasVersion").GetInt32();
        var id = Guid.CreateVersion7();
        var stale = new Pause();
        var hits = 0;
        using var host = WithHooks(deletion: (step, d) =>
            step == "canvas" && d == id && Interlocked.Increment(ref hits) == 1 ? stale.HitAsync() : Task.CompletedTask);
        using var hooked = Authenticated(host);

        var request = DeleteFeatureAsync(hooked, feature, id, version);
        await stale.Reached;
        // Se corta la conexión que sostiene su candado (como una caída de red): PostgreSQL lo suelta.
        Assert.Equal(1, await TerminateAsync(AppLocks.DeletionSession(id)));
        Assert.True(await DeletionRecovery.RecoverOnceAsync(host.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None) >= 1);
        var byRecovery = await AppsAsync(db => db.Deletions.AsNoTracking().SingleAsync(d => d.Id == id));
        Assert.Equal("completed", byRecovery.Status);

        // El ejecutor viejo despierta: ve que perdió el candado y no escribe nada.
        stale.Release();
        Assert.Equal(HttpStatusCode.NoContent, (await request).StatusCode);
        var after = await AppsAsync(db => db.Deletions.AsNoTracking().SingleAsync(d => d.Id == id));
        Assert.Equal(byRecovery.CompletedAt, after.CompletedAt);
        Assert.Equal(byRecovery.Steps, after.Steps);
        Assert.Equal(2, after.Attempts);
    }

    [Fact]
    public async Task Sin_la_ficha_un_ejecutor_no_cierra_la_bitacora_ni_borra_las_filas()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Ficha ajena");
        var feature = await FeatureAsync(client, app, "Con ficha");
        var id = Guid.CreateVersion7();
        var paused = new Pause();
        using var host = WithHooks(deletion: (step, d) => step == DeletionHandlers.AppsStep && d == id && paused.Hits == 0 ? paused.HitAsync() : Task.CompletedTask);
        using var hooked = Authenticated(host);

        var request = DeleteFeatureAsync(hooked, feature, id, 0);
        await paused.Reached;
        // Otra ejecución tomó la eliminación (su ficha): la de la solicitud ya no puede cerrarla.
        var foreign = Guid.CreateVersion7();
        await AppsAsync(db => db.Deletions.Where(d => d.Id == id).ExecuteUpdateAsync(s => s.SetProperty(d => d.OwnerToken, foreign)));
        paused.Release();

        Assert.Equal(HttpStatusCode.Accepted, (await request).StatusCode);
        var journal = await AppsAsync(db => db.Deletions.AsNoTracking().SingleAsync(d => d.Id == id));
        Assert.Equal("pending", journal.Status);
        Assert.Equal(foreign, journal.OwnerToken);
        Assert.True(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.Id == feature)));

        // Cuando esa otra ejecución desaparece, la recuperación toma una ficha nueva y termina.
        Assert.True(await DeletionRecovery.RecoverOnceAsync(host.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None) >= 1);
        Assert.Equal("completed", await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Status).SingleAsync()));
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.Id == feature)));
    }

    [Fact]
    public async Task Una_caida_antes_de_cerrar_la_bitacora_deshace_el_ultimo_paso_y_la_recuperacion_lo_completa()
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = "Caída al cerrar " + Suffix();
        var app = await AppExactAsync(client, name);
        var feature = await FeatureAsync(client, app, "Con imagen");
        var asset = await AssetAsync(client, app);
        await PutCanvasAsync(client, feature, Graph(asset, null, null));
        var key = await FilesAsync(db => db.Assets.Where(a => a.Id == asset).Select(a => a.StorageKey).SingleAsync());
        var id = Guid.CreateVersion7();
        var crashed = 0;
        using var host = WithHooks(deletion: (step, d) =>
            step == DeletionHandlers.CommitStep && d == id && Interlocked.Increment(ref crashed) == 1 ? throw new DeletionAbandonedException() : Task.CompletedTask);
        using var hooked = Authenticated(host);

        await CrashAsync(() => DeleteAppAsync(hooked, app, id, name));

        // Los módulos ya limpiaron, pero la transacción final (filas de Apps + cierre de la bitácora) no se confirmó.
        Assert.Equal("pending", await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Status).SingleAsync()));
        Assert.True(await AppsAsync(db => db.Apps.AnyAsync(a => a.Id == app && a.DeletingAt != null)));
        Assert.False(await AppsAsync(db => db.Memberships.AnyAsync(m => m.AppId == app)));
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == feature)));
        Assert.Null(await ObjectAsync(key));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);

        Assert.True(await DeletionRecovery.RecoverOnceAsync(host.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None) >= 1);
        Assert.Equal("completed", await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Status).SingleAsync()));
        await NoOrphansAsync(app, [feature], [key]);
    }

    // ---------- Escrituras en curso ----------

    public static TheoryData<string, string> WriteRaces()
    {
        var data = new TheoryData<string, string>();
        foreach (var write in new[] { "lienzo", "feature", "modulo", "catalogo", "imagen", "importar", "walkie-live-subir", "walkie-live-aplicar", "enlace", "mapa" })
        {
            foreach (var moment in new[] { "antes", "durante", "despues" })
            {
                data.Add(write, moment);
            }
        }

        return data;
    }

    /// <summary>
    /// Una escritura autorizada contra la eliminación de su app, en tres momentos:
    /// <list type="bullet">
    /// <item><b>antes</b>: la escritura ya guardó y sigue con su candado; la eliminación espera en PostgreSQL y después se lleva lo escrito;</item>
    /// <item><b>durante</b>: la eliminación tiene el candado (antes de marcar); la escritura espera y después recibe 404 sin crear nada;</item>
    /// <item><b>despues</b>: la eliminación quedó a medias (un paso falló); la escritura recibe 404 y la recuperación termina.</item>
    /// </list>
    /// En los tres, ningún resto de la app en ningún módulo ni en S3.
    /// </summary>
    [Theory]
    [MemberData(nameof(WriteRaces))]
    public async Task Una_escritura_en_curso_no_deja_restos_de_una_app_eliminada(string write, string moment)
    {
        using var client = factory.CreateAuthenticatedClient();
        var name = $"Carrera {write} {moment} " + Suffix();
        var app = await AppExactAsync(client, name);
        var feature = await FeatureAsync(client, app, "Base");
        var race = new RaceSetup(app, feature);
        if (write == "walkie-live-aplicar")
        {
            race.Snapshot = (await JsonAsync(await UploadAsync(client, app, Shop()), HttpStatusCode.Created)).GetProperty("snapshot").GetProperty("id").GetGuid();
        }

        if (write == "importar")
        {
            var source = await AppAsync(client, "Origen del paquete");
            var sourceFeature = await FeatureAsync(client, source, "Importable");
            await PutCanvasAsync(client, sourceFeature, Graph(null, null, null));
            race.Package = await client.GetByteArrayAsync(new Uri($"/api/features/{sourceFeature}/export?format=walkie", UriKind.Relative));
        }

        var id = Guid.CreateVersion7();
        HttpResponseMessage written;
        switch (moment)
        {
            case "antes":
            {
                var saved = new Pause();
                using var writerHost = WithHooks(leaving: (a, _) => a == app ? saved.HitAsync() : Task.CompletedTask);
                using var writer = Authenticated(writerHost);
                var writing = WriteAsync(writer, write, race);
                await saved.Reached;
                // Lo escrito ya está guardado: sus objetos en S3 también tienen que desaparecer.
                race.Keys = await FilesAsync(db => db.Assets.Where(a => a.AppId == app).Select(a => a.StorageKey).ToListAsync());
                // Y las features y módulos que creó (un import, «Crear feature»): sus lienzos y enlaces también.
                race.Features = await AppsAsync(db => db.Features.IgnoreQueryFilters().Where(f => f.AppId == app).Select(f => f.Id).ToListAsync());
                var deleting = DeleteAppAsync(client, app, id, name);
                await WaitingOnLockAsync(AppLocks.DeletionSession(id));
                Assert.False(deleting.IsCompleted);
                saved.Release();
                written = await writing;
                Assert.True(written.IsSuccessStatusCode, $"{write}: {written.StatusCode} {await written.Content.ReadAsStringAsync()}");
                Assert.Equal(HttpStatusCode.NoContent, (await deleting).StatusCode);
                break;
            }

            case "durante":
            {
                var locked = new Pause();
                using var deleterHost = WithHooks(deletion: (step, d) => step == DeletionHandlers.LockedStep && d == id ? locked.HitAsync() : Task.CompletedTask);
                using var deleter = Authenticated(deleterHost);
                var deleting = DeleteAppAsync(deleter, app, id, name);
                await locked.Reached;
                var writing = WriteAsync(client, write, race);
                await WaitingOnLockAsync(AppLocks.WriteSession);
                Assert.False(writing.IsCompleted);
                locked.Release();
                Assert.Equal(HttpStatusCode.NoContent, (await deleting).StatusCode);
                written = await writing;
                Assert.Equal(HttpStatusCode.NotFound, written.StatusCode);
                break;
            }

            default:
            {
                var fail = true;
                using var deleterHost = WithHooks(deletion: (step, d) => fail && step == "files" && d == id ? throw new InvalidOperationException("S3 no responde") : Task.CompletedTask);
                using var deleter = Authenticated(deleterHost);
                Assert.Equal(HttpStatusCode.Accepted, (await DeleteAppAsync(deleter, app, id, name)).StatusCode);
                written = await WriteAsync(client, write, race);
                Assert.Equal(HttpStatusCode.NotFound, written.StatusCode);
                fail = false;
                await ExpireLeaseAsync(id);
                Assert.True(await DeletionRecovery.RecoverOnceAsync(deleterHost.Services.GetRequiredService<IServiceScopeFactory>(), CancellationToken.None) >= 1);
                break;
            }
        }

        Assert.Equal("completed", await AppsAsync(db => db.Deletions.Where(d => d.Id == id).Select(d => d.Status).SingleAsync()));
        await NoOrphansAsync(app, [feature, .. race.Features, .. race.Created(await ReadIdAsync(written))], race.Keys);
    }

    [Fact]
    public async Task Guardar_el_lienzo_o_crear_un_portal_antes_de_la_marca_impide_eliminar_la_feature()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Feature disputada");
        var target = await FeatureAsync(client, app, "Destino");
        var origin = await FeatureAsync(client, app, "Origen");
        await PutCanvasAsync(client, target, Graph(null, null, null));
        var version = (await ImpactAsync(client, $"/api/features/{target}/deletion")).GetProperty("canvasVersion").GetInt32();

        // Un guardado del propio lienzo que ya escribió y sigue con su candado: la eliminación espera y ve la versión nueva.
        var saved = new Pause();
        using (var writerHost = WithHooks(leaving: (a, _) => a == app ? saved.HitAsync() : Task.CompletedTask))
        using (var writer = Authenticated(writerHost))
        {
            var graph = Graph(null, null, null);
            graph["version"] = version;
            var writing = writer.PutAsJsonAsync(new Uri($"/api/features/{target}/canvas", UriKind.Relative), graph);
            await saved.Reached;
            var id = Guid.CreateVersion7();
            var deleting = DeleteFeatureAsync(client, target, id, version);
            await WaitingOnLockAsync(AppLocks.DeletionSession(id));
            saved.Release();
            Assert.Equal(HttpStatusCode.OK, (await writing).StatusCode);
            Assert.Contains("cambió", (await JsonAsync(await deleting, HttpStatusCode.Conflict)).GetProperty("title").GetString(), StringComparison.Ordinal);
        }

        // Un portal hacia ella guardado en otra feature, en el mismo momento: la eliminación lo ve y se bloquea.
        version = (await ImpactAsync(client, $"/api/features/{target}/deletion")).GetProperty("canvasVersion").GetInt32();
        var portal = new Pause();
        using (var writerHost = WithHooks(leaving: (a, _) => a == app ? portal.HitAsync() : Task.CompletedTask))
        using (var writer = Authenticated(writerHost))
        {
            var writing = writer.PutAsJsonAsync(new Uri($"/api/features/{origin}/canvas", UriKind.Relative), PortalGraph(target));
            await portal.Reached;
            var id = Guid.CreateVersion7();
            var deleting = DeleteFeatureAsync(client, target, id, version);
            await WaitingOnLockAsync(AppLocks.DeletionSession(id));
            portal.Release();
            Assert.Equal(HttpStatusCode.OK, (await writing).StatusCode);
            var blocked = await JsonAsync(await deleting, HttpStatusCode.Conflict);
            Assert.Equal("portal", blocked.GetProperty("impact").GetProperty("blockers")[0].GetProperty("code").GetString());
        }

        Assert.True(await AppsAsync(db => db.Features.AnyAsync(f => f.Id == target)));
        Assert.True(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == target)));
    }

    [Fact]
    public async Task Un_portal_o_un_guardado_que_llega_mientras_se_elimina_la_feature_no_la_revive()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await AppAsync(client, "Feature en eliminación");
        var target = await FeatureAsync(client, app, "Se va");
        var origin = await FeatureAsync(client, app, "Se queda");
        await PutCanvasAsync(client, target, Graph(null, null, null));
        var version = (await ImpactAsync(client, $"/api/features/{target}/deletion")).GetProperty("canvasVersion").GetInt32();
        var id = Guid.CreateVersion7();
        var locked = new Pause();
        using var deleterHost = WithHooks(deletion: (step, d) => step == DeletionHandlers.LockedStep && d == id ? locked.HitAsync() : Task.CompletedTask);
        using var deleter = Authenticated(deleterHost);

        var deleting = DeleteFeatureAsync(deleter, target, id, version);
        await locked.Reached;
        var graph = Graph(null, null, null);
        graph["version"] = version;
        var save = client.PutAsJsonAsync(new Uri($"/api/features/{target}/canvas", UriKind.Relative), graph);
        var link = client.PutAsJsonAsync(new Uri($"/api/features/{origin}/canvas", UriKind.Relative), PortalGraph(target));
        await WaitingOnLockAsync(AppLocks.WriteSession, count: 2);
        locked.Release();

        Assert.Equal(HttpStatusCode.NoContent, (await deleting).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await save).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await link).StatusCode); // el destino ya no existe
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => c.FeatureId == target)));
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.Id == target)));
        Assert.True(await AppsAsync(db => db.Features.AnyAsync(f => f.Id == origin)));
    }

    // ---------- Ayudas de concurrencia ----------

    private sealed class RaceSetup(Guid app, Guid feature)
    {
        public Guid App { get; } = app;
        public Guid Feature { get; } = feature;
        public Guid Snapshot { get; set; }
        public byte[] Package { get; set; } = [];
        public Guid Module { get; } = Guid.CreateVersion7();
        public List<string> Keys { get; set; } = [];
        public List<Guid> Features { get; set; } = [];

        /// <summary>Las features o módulos que pudo crear la escritura (para buscar sus restos en Canvas y Sharing).</summary>
        public IEnumerable<Guid> Created(Guid? fromResponse) => fromResponse is { } id ? [Module, id] : [Module];
    }

    private static Task<HttpResponseMessage> WriteAsync(HttpClient client, string write, RaceSetup race)
    {
        switch (write)
        {
            case "lienzo":
                return client.PutAsJsonAsync(new Uri($"/api/features/{race.Feature}/canvas", UriKind.Relative), Graph(null, null, null));
            case "feature":
                return client.PostAsJsonAsync(new Uri($"/api/apps/{race.App}/features", UriKind.Relative), new { name = "En vuelo" });
            case "modulo":
                return client.PostAsJsonAsync(new Uri($"/api/apps/{race.App}/modules", UriKind.Relative), new { id = race.Module, name = "Módulo en vuelo" });
            case "catalogo":
                return client.PostAsJsonAsync(new Uri($"/api/apps/{race.App}/catalog", UriKind.Relative),
                    new { type = "api", title = "En vuelo", http = new { method = "GET", path = "/api/en-vuelo" } });
            case "imagen":
            {
                var file = new ByteArrayContent(TestImages.Create("png", 8, 8));
                file.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
                return client.PostAsync(new Uri($"/api/apps/{race.App}/assets", UriKind.Relative), new MultipartFormDataContent { { file, "file", "pantalla.png" } });
            }

            case "importar":
            {
                var file = new ByteArrayContent(race.Package);
                file.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
                return client.PostAsync(new Uri($"/api/apps/{race.App}/import", UriKind.Relative), new MultipartFormDataContent { { file, "file", "feature.walkie" } });
            }

            case "walkie-live-subir":
                return UploadAsync(client, race.App, Shop());
            case "walkie-live-aplicar":
                return client.PostAsJsonAsync(new Uri($"/api/snapshots/{race.Snapshot}/apply", UriKind.Relative), new JsonObject
                {
                    ["applyId"] = Guid.CreateVersion7().ToString(),
                    ["operations"] = new JsonArray(new JsonObject
                    {
                        ["op"] = "create", ["entityKey"] = "api:GET /api/pedidos", ["id"] = Guid.CreateVersion7().ToString(), ["bindingVersion"] = 0,
                    }),
                });
            case "enlace":
                return client.PostAsJsonAsync(new Uri($"/api/features/{race.Feature}/shares", UriKind.Relative), new CreateShareRequest(7));
            case "mapa":
                return client.PutAsJsonAsync(new Uri($"/api/apps/{race.App}/map/layout", UriKind.Relative),
                    new { version = 0, positions = new Dictionary<string, object> { [race.Feature.ToString()] = new { x = 8, y = 8 } } });
            default:
                throw new ArgumentOutOfRangeException(nameof(write), write, null);
        }
    }

    /// <summary>El id que devolvió una creación (feature), si lo hay; un import trae sus features en <c>created</c>.</summary>
    private static async Task<Guid?> ReadIdAsync(HttpResponseMessage response)
    {
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var text = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        using var json = JsonDocument.Parse(text);
        return json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty("id", out var id) && id.TryGetGuid(out var value) ? value : null;
    }

    /// <summary>Ningún resto de la app en ningún módulo ni en S3 (además de lo que se busca por id).</summary>
    private async Task NoOrphansAsync(Guid app, IReadOnlyCollection<Guid> featureIds, IReadOnlyCollection<string> keys)
    {
        Assert.False(await AppsAsync(db => db.Apps.AnyAsync(a => a.Id == app)));
        Assert.False(await AppsAsync(db => db.Features.IgnoreQueryFilters().AnyAsync(f => f.AppId == app)));
        Assert.False(await AppsAsync(db => db.CatalogItems.AnyAsync(i => i.AppId == app)));
        Assert.False(await AppsAsync(db => db.Memberships.AnyAsync(m => m.AppId == app)));
        Assert.False(await CanvasAsync(db => db.Canvases.AnyAsync(c => featureIds.Contains(c.FeatureId))));
        Assert.False(await CanvasAsync(db => db.AppMaps.AnyAsync(m => m.AppId == app)));
        Assert.False(await SharingAsync(db => db.Shares.AnyAsync(s => featureIds.Contains(s.FeatureId))));
        Assert.False(await FilesAsync(db => db.Assets.AnyAsync(a => a.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Sources.AnyAsync(s => s.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Snapshots.AnyAsync(s => s.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Bindings.AnyAsync(b => b.AppId == app)));
        Assert.False(await DiscoveryAsync(db => db.Applies.AnyAsync(a => a.AppId == app)));
        foreach (var key in keys)
        {
            Assert.Null(await ObjectAsync(key));
        }
    }

    private static JsonObject PortalGraph(Guid target)
    {
        var p = DeterministicId("portal" + target);
        return new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = 0,
            ["nodes"] = new JsonObject { [p] = new JsonObject { ["id"] = p, ["type"] = "portal", ["title"] = "Ir", ["targetFeatureId"] = target.ToString() } },
            ["edges"] = new JsonObject(),
            ["layout"] = new JsonObject { [p] = new JsonObject { ["x"] = 0, ["y"] = 0 } },
        };
    }

    /// <summary>Espera (sondeando PostgreSQL, sin pausas fijas) a que <paramref name="count"/> sesiones con ese nombre esperen un candado de app.</summary>
    private async Task WaitingOnLockAsync(string session, int count = 1)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (true)
        {
            var waiting = await AppsAsync(db => db.Database.SqlQuery<int>(
                $"SELECT count(*)::int AS \"Value\" FROM pg_stat_activity WHERE application_name = {session} AND wait_event_type = 'Lock' AND wait_event = 'advisory'").SingleAsync());
            if (waiting >= count)
            {
                return;
            }

            Assert.True(DateTime.UtcNow < deadline, $"Nadie espera el candado ({session}).");
            await Task.Yield();
        }
    }

    /// <summary>Corta las sesiones de PostgreSQL con ese nombre (como una caída de red del ejecutor).</summary>
    private Task<int> TerminateAsync(string session) =>
        AppsAsync(db => db.Database.SqlQuery<int>(
            $"SELECT count(*)::int AS \"Value\" FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = {session}) t").SingleAsync());

    /// <summary>Una solicitud cuyo servidor «muere» en medio: la respuesta no importa (500 o excepción).</summary>
    private static async Task CrashAsync(Func<Task<HttpResponseMessage>> request)
    {
        try
        {
            var response = await request();
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        }
        catch (DeletionAbandonedException)
        {
        }
        catch (HttpRequestException)
        {
        }
    }

    private WebApplicationFactory<Program> WithHooks(Func<string, Guid, Task>? deletion = null, Func<Guid, string, Task>? leaving = null) =>
        factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton<IDeletionCheckpoints>(new Checkpoints(deletion ?? ((_, _) => Task.CompletedTask)));
            s.AddSingleton<IAppWriteCheckpoints>(new WriteHooks(leaving ?? ((_, _) => Task.CompletedTask)));
        }));

    private sealed class WriteHooks(Func<Guid, string, Task> leaving) : IAppWriteCheckpoints
    {
        public Task EnteredAsync(Guid appId, string route, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task LeavingAsync(Guid appId, string route, CancellationToken cancellationToken) => leaving(appId, route);
    }

    /// <summary>Una barrera: quien llega avisa y espera a que la prueba la suelte.</summary>
    private sealed class Pause
    {
        private readonly TaskCompletionSource reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int hits;

        public int Hits => Volatile.Read(ref hits);

        public Task Reached => reached.Task.WaitAsync(TimeSpan.FromSeconds(60));

        public async Task HitAsync()
        {
            Interlocked.Increment(ref hits);
            reached.TrySetResult();
            await released.Task.ConfigureAwait(false);
        }

        public void Release() => released.TrySetResult();
    }
}
