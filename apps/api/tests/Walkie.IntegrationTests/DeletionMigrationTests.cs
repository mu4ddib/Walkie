using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.IntegrationTests;

/// <summary>
/// Migraciones de la eliminación (ADR-0017: <c>Deletions</c> y <c>DeletionOwnership</c>) en una base propia y desechable,
/// nunca en datos reales: subir sobre datos del estado anterior (apps, features y membresías), bajar, subir otra vez sin
/// perder nada, y después una eliminación que queda pendiente con lo necesario para diagnosticarla y retomarla. La
/// reversión se prueba antes de eliminar nada: bajar con eliminaciones hechas borraría su bitácora.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class DeletionMigrationTests(WalkieApiFactory factory)
{
    /// <summary>Último estado de Apps antes de la eliminación (membresías de ADR-0015).</summary>
    private const string BeforeDeletions = "20261119224229_Memberships";

    [Fact]
    public async Task Las_migraciones_de_eliminacion_suben_bajan_y_suben_sin_perder_apps_features_ni_miembros()
    {
        var connection = await FreshDatabaseAsync();
        using var host = factory.WithWebHostBuilder(b => b.UseSetting("ConnectionStrings:Walkie", connection));
        var app = Guid.CreateVersion7();
        var features = new[] { Guid.CreateVersion7(), Guid.CreateVersion7() };

        // Base en el estado anterior, con datos escritos con las columnas de entonces.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
            await db.GetService<IMigrator>().MigrateAsync(BeforeDeletions);
            Assert.False(await TableExistsAsync(db, "deletions"));
            Assert.False(await ColumnExistsAsync(db, "features", "deleting_at"));
            await db.Database.ExecuteSqlAsync($"INSERT INTO apps.apps (id, name, created_by, created_at) VALUES ({app}, 'Banca de prueba', 'usuario-de-prueba', now())");
            foreach (var (feature, i) in features.Select((f, i) => (f, i)))
            {
                var name = $"Feature {i}";
                await db.Database.ExecuteSqlAsync($"INSERT INTO apps.features (id, app_id, name, created_by, created_at, updated_at) VALUES ({feature}, {app}, {name}, 'usuario-de-prueba', now(), now())");
            }

            await db.Database.ExecuteSqlAsync($"INSERT INTO apps.memberships (app_id, user_id, role, granted_by, granted_at) VALUES ({app}, 'usuario-de-prueba', 'owner', 'usuario-de-prueba', now())");
            await db.Database.ExecuteSqlAsync($"INSERT INTO apps.memberships (app_id, user_id, role, granted_by, granted_at) VALUES ({app}, 'editor-de-prueba', 'editor', 'usuario-de-prueba', now())");
        }

        var before = await SnapshotAsync(host);

        // Subir (dos veces: la segunda no hace nada), bajar y volver a subir.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
            Assert.Equal(["20261120153421_Deletions", "20261120163223_DeletionOwnership"], (await db.Database.GetPendingMigrationsAsync()).ToArray());
            await db.Database.MigrateAsync();
            await db.Database.MigrateAsync();
            await AssertCurrentSchemaAsync(db);
            Assert.Equal(before, await SnapshotAsync(host));
            Assert.Equal(0, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM apps.features WHERE deleting_at IS NOT NULL").SingleAsync());

            await db.GetService<IMigrator>().MigrateAsync(BeforeDeletions);
            Assert.False(await TableExistsAsync(db, "deletions"));
            Assert.False(await ColumnExistsAsync(db, "features", "deleting_at"));
            Assert.False(await ColumnExistsAsync(db, "apps", "deleting_at"));
            Assert.Equal(before, await SnapshotAsync(host));

            await db.Database.MigrateAsync();
            await AssertCurrentSchemaAsync(db);
            Assert.Equal(before, await SnapshotAsync(host));
        }

        // Con el esquema nuevo, la app anterior funciona: su owner la ve y una eliminación que falla queda pendiente
        // con todo lo necesario para diagnosticarla y retomarla.
        var fail = true;
        using var failing = host.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IDeletionCheckpoints>(new Fail(() => fail))));
        using var client = failing.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", WalkieApiFactory.CreateToken(sub: "usuario-de-prueba"));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
        var deletionId = Guid.CreateVersion7();
        var response = await client.DeleteAsync(new Uri($"/api/features/{features[0]}?deletionId={deletionId}&canvasVersion=0", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        await using (var scope = failing.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
            var journal = await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId);
            Assert.Equal(("pending", "feature", app, features[0], "Feature 0", "usuario-de-prueba"),
                (journal.Status, journal.Kind, journal.AppId, journal.FeatureId, journal.Name, journal.RequestedBy));
            Assert.Equal(0, journal.CanvasVersion);
            Assert.Equal(1, journal.Attempts);
            Assert.StartsWith("canvas: ", journal.Error, StringComparison.Ordinal);
            Assert.Contains("\"failed\"", journal.Steps, StringComparison.Ordinal);
            Assert.NotNull(journal.RetryAt);
            Assert.Null(journal.OwnerToken); // nadie la tiene: la recuperación la puede tomar
        }

        fail = false;
        await using (var scope = failing.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
            await db.Deletions.Where(d => d.Id == deletionId).ExecuteUpdateAsync(s => s.SetProperty(d => d.RetryAt, (DateTimeOffset?)null));
        }

        var done = await client.GetAsync(new Uri($"/api/deletions/{deletionId}", UriKind.Relative));
        Assert.Contains("\"completed\"", await done.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri($"/api/apps/{app}", UriKind.Relative))).StatusCode);
    }

    private static async Task AssertCurrentSchemaAsync(AppsDbContext db)
    {
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.True(await TableExistsAsync(db, "deletions"));
        foreach (var column in new[] { "retry_at", "owner_token", "canvas_version", "steps", "error", "attempts" })
        {
            Assert.True(await ColumnExistsAsync(db, "deletions", column), column);
        }

        Assert.False(await ColumnExistsAsync(db, "deletions", "lease_until"));
        Assert.True(await ColumnExistsAsync(db, "features", "deleting_at"));
        Assert.True(await ColumnExistsAsync(db, "apps", "deleting_at"));
    }

    /// <summary>Apps, features y membresías, tal cual (para comparar antes y después de cada migración).</summary>
    private static async Task<string> SnapshotAsync(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT concat_ws('|', 'app', id, name, created_by) AS "Value" FROM apps.apps
            UNION ALL SELECT concat_ws('|', 'feature', id, app_id, name, kind, description) FROM apps.features
            UNION ALL SELECT concat_ws('|', 'member', app_id, user_id, role, granted_by) FROM apps.memberships
            """).ToListAsync();
        return string.Join("\n", rows.Order(StringComparer.Ordinal));
    }

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

    private static async Task<bool> TableExistsAsync(AppsDbContext db, string table) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM information_schema.tables WHERE table_schema = 'apps' AND table_name = {table}
            """).SingleAsync() == 1;

    private static async Task<bool> ColumnExistsAsync(AppsDbContext db, string table, string column) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM information_schema.columns WHERE table_schema = 'apps' AND table_name = {table} AND column_name = {column}
            """).SingleAsync() == 1;

    private sealed class Fail(Func<bool> failing) : IDeletionCheckpoints
    {
        public Task ReachedAsync(Guid deletionId, string step, CancellationToken cancellationToken) =>
            failing() && step == "canvas" ? throw new InvalidOperationException("caída simulada del lienzo") : Task.CompletedTask;
    }
}
