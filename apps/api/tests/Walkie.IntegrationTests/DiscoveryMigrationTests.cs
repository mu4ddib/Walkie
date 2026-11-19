using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Persistence;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Migraciones de Discovery (spec walkie-live, tarea 11, punto 16) en una base propia, nunca en datos reales: desde
/// vacía, hacia atrás (los <c>Down</c>) y hacia adelante sobre datos del estado anterior subidos por la API real.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DiscoveryMigrationTests(WalkieApiFactory factory)
{
    /// <summary>Último estado de Discovery antes de la tarea 10 (sin <c>source_imports</c>).</summary>
    private const string BeforeTask10 = "20261116203121_ApplyContainers";

    [Fact]
    public async Task Las_migraciones_van_hacia_atras_y_adelante_sin_perder_los_datos_del_estado_anterior()
    {
        var connection = await FreshDatabaseAsync();
        using var host = factory.WithWebHostBuilder(b => b.UseSetting("ConnectionStrings:Walkie", connection));
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken());

        // Al arrancar se aplican todas (base vacía). Discovery vuelve al estado anterior a la tarea 10.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            await db.GetService<IMigrator>().MigrateAsync(BeforeTask10);
            Assert.False(await TableExistsAsync(db, "source_imports"));
        }

        // Datos del estado anterior, por la API: una app con un análisis, decisiones y una creación en el catálogo.
        var source = Guid.CreateVersion7();
        var appId = (await JsonAsync(await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Antes de migrar")), HttpStatusCode.Created))
            .GetProperty("id").GetGuid();
        var snapshotId = (await JsonAsync(await UploadAsync(client, appId, Tienda("--source-id", source.ToString())), HttpStatusCode.Created))
            .GetProperty("snapshot").GetProperty("id").GetGuid();
        var created = Guid.CreateVersion7();
        await JsonAsync(await client.PostAsJsonAsync(new Uri($"/api/snapshots/{snapshotId}/apply", UriKind.Relative), new JsonObject
        {
            ["applyId"] = Guid.CreateVersion7().ToString(),
            ["operations"] = new JsonArray(
                new JsonObject { ["op"] = "create", ["entityKey"] = "api:POST /api/pedidos", ["id"] = created.ToString(), ["bindingVersion"] = 0 },
                new JsonObject { ["op"] = "reject", ["entityKey"] = "api:GET /api/pedidos/{}", ["bindingVersion"] = 0 }),
        }), HttpStatusCode.OK);
        var reviewBefore = await ReviewAsync(client, snapshotId);
        var countsBefore = await CountsAsync(host);

        // Hacia adelante: lo que falta, otra vez sin nada pendiente; repetir no hace nada.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
            Assert.Equal(2, (await db.Database.GetPendingMigrationsAsync()).Count());
            await db.Database.MigrateAsync();
            await db.Database.MigrateAsync();
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            Assert.True(await TableExistsAsync(db, "source_imports"));
            var indexes = await db.Database.SqlQuery<string>($"""
                SELECT indexname AS "Value" FROM pg_indexes WHERE schemaname = 'discovery' AND tablename = 'source_imports' ORDER BY 1
                """).ToListAsync();
            Assert.Contains("ux_source_imports_app", indexes);
            Assert.Contains("ux_source_imports_pending_source", indexes);
            var checks = await db.Database.SqlQuery<string>($"""
                SELECT conname AS "Value" FROM pg_constraint WHERE connamespace = 'discovery'::regnamespace AND contype = 'c' ORDER BY 1
                """).ToListAsync();
            Assert.Equal(["ck_applies_status", "ck_apply_steps_status", "ck_bindings_decision", "ck_source_imports_status"], checks);
        }

        // Los datos siguen iguales y la revisión dice lo mismo; lo nuevo funciona sobre la base migrada.
        Assert.Equal(countsBefore, await CountsAsync(host));
        Assert.True(JsonElement.DeepEquals(reviewBefore, await ReviewAsync(client, snapshotId)));
        using var form = new MultipartFormDataContent
        {
            { new ByteArrayContent(Tienda()), "file", "nuevo.walkiepack" },
            { new StringContent("Creada después de migrar"), "name" },
            { new StringContent(Guid.CreateVersion7().ToString()), "importId" },
        };
        await JsonAsync(await client.PostAsync(new Uri("/api/sources/import", UriKind.Relative), form), HttpStatusCode.Created);
    }

    [Fact]
    public async Task Todas_las_migraciones_de_discovery_se_deshacen_y_se_rehacen_en_una_base_vacia()
    {
        var connection = await FreshDatabaseAsync();
        using var host = factory.WithWebHostBuilder(b => b.UseSetting("ConnectionStrings:Walkie", connection));
        _ = host.CreateClient(); // arranca y migra
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync(Migration.InitialDatabase);
        Assert.False(await TableExistsAsync(db, "snapshots"));
        await db.Database.MigrateAsync();
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.True(await TableExistsAsync(db, "source_imports"));
    }

    // ---------- Ayudas ----------

    /// <summary>Una base nueva en el mismo Postgres de las pruebas (nunca la de otra prueba ni datos reales).</summary>
    private async Task<string> FreshDatabaseAsync()
    {
        var main = factory.Services.GetRequiredService<IConfiguration>().GetConnectionString("Walkie")!;
        var name = "walkie_migracion_" + Guid.NewGuid().ToString("N")[..12];
        await using (var admin = new NpgsqlConnection(main))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync();
        }

        return new NpgsqlConnectionStringBuilder(main) { Database = name }.ConnectionString;
    }

    private static async Task<bool> TableExistsAsync(DiscoveryDbContext db, string table) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM information_schema.tables WHERE table_schema = 'discovery' AND table_name = {table}
            """).SingleAsync() == 1;

    private static async Task<string> CountsAsync(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DiscoveryDbContext>();
        return string.Join(",",
            await db.Sources.CountAsync(), await db.Snapshots.CountAsync(), await db.Entities.CountAsync(), await db.Relations.CountAsync(),
            await db.Evidence.CountAsync(), await db.Bindings.CountAsync(b => b.Decision != null), await db.Applies.CountAsync(), await db.ApplySteps.CountAsync());
    }

    private static async Task<JsonElement> ReviewAsync(HttpClient client, Guid snapshotId) =>
        await JsonAsync(await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/review?pageSize=500", UriKind.Relative)), HttpStatusCode.OK);
}
