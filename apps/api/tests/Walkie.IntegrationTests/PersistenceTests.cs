using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Modules.Canvas.Domain;
using Walkie.Modules.Canvas.Persistence;

namespace Walkie.IntegrationTests;

[Collection(ApiTestGroup.Name)]
public sealed class PersistenceTests(WalkieApiFactory factory)
{
    private const string EmptyGraph =
        """{"schemaVersion":0,"version":0,"nodes":{},"edges":{},"layout":{}}""";

    [Fact]
    public async Task Las_migraciones_crean_las_tablas_de_cada_modulo()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();

        var tables = await db.Database
            .SqlQuery<string>($"""
                SELECT table_schema || '.' || table_name AS "Value"
                FROM information_schema.tables
                WHERE table_schema IN ('apps', 'canvas', 'files', 'sharing') AND table_name NOT LIKE '\_\_%'
                ORDER BY 1
                """)
            .ToListAsync();

        Assert.Equal(["apps.apps", "apps.catalog_items", "apps.features", "canvas.app_maps", "canvas.canvases", "files.assets", "sharing.shares"], tables);
    }

    [Fact]
    public async Task Una_app_con_features_se_guarda_y_se_recupera()
    {
        var app = new App { Name = "Banca móvil", CreatedBy = "user-1" };
        app.Features.Add(new Feature { Name = "Iniciar sesión", CreatedBy = "user-1" });
        app.Features.Add(new Feature { Name = "Transferir", CreatedBy = "user-1" });

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
            db.Apps.Add(app);
            await db.SaveChangesAsync();
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
            var loaded = await db.Apps.Include(a => a.Features).SingleAsync(a => a.Id == app.Id);

            Assert.Equal("Banca móvil", loaded.Name);
            Assert.Equal(["Iniciar sesión", "Transferir"], loaded.Features.Select(f => f.Name).Order());
            Assert.All(loaded.Features, f => Assert.Equal(app.Id, f.AppId));
        }
    }

    [Fact]
    public async Task Borrar_una_app_borra_sus_features()
    {
        var app = new App { Name = "Temporal", CreatedBy = "user-1" };
        var feature = new Feature { Name = "Única", CreatedBy = "user-1" };
        app.Features.Add(feature);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppsDbContext>();
        db.Apps.Add(app);
        await db.SaveChangesAsync();

        db.Apps.Remove(app);
        await db.SaveChangesAsync();

        Assert.False(await db.Features.AnyAsync(f => f.Id == feature.Id));
    }

    [Fact]
    public async Task El_grafo_se_guarda_como_jsonb_y_se_recupera_equivalente()
    {
        var featureId = Guid.CreateVersion7();
        const string graph =
            """{"schemaVersion":0,"version":0,"nodes":{"n1":{"id":"n1","type":"screen","title":"Login"}},"edges":{},"layout":{"n1":{"x":8,"y":16}}}""";

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CanvasDbContext>();
            db.Canvases.Add(new CanvasDocument { FeatureId = featureId, Graph = graph, UpdatedBy = "user-1" });
            await db.SaveChangesAsync();
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CanvasDbContext>();
            var loaded = await db.Canvases.SingleAsync(c => c.FeatureId == featureId);

            // jsonb normaliza espacios y orden de claves: se compara el contenido, no el texto.
            using var expected = System.Text.Json.JsonDocument.Parse(graph);
            using var actual = System.Text.Json.JsonDocument.Parse(loaded.Graph);
            Assert.True(System.Text.Json.JsonElement.DeepEquals(expected.RootElement, actual.RootElement));
            Assert.Equal(0, loaded.Version);
        }
    }

    [Fact]
    public async Task Guardar_con_una_version_vieja_falla_por_concurrencia()
    {
        var featureId = Guid.CreateVersion7();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CanvasDbContext>();
            db.Canvases.Add(new CanvasDocument { FeatureId = featureId, Graph = EmptyGraph, UpdatedBy = "user-1" });
            await db.SaveChangesAsync();
        }

        // Dos "pestañas" leen la versión 0.
        await using var scopeA = factory.Services.CreateAsyncScope();
        await using var scopeB = factory.Services.CreateAsyncScope();
        var dbA = scopeA.ServiceProvider.GetRequiredService<CanvasDbContext>();
        var dbB = scopeB.ServiceProvider.GetRequiredService<CanvasDbContext>();
        var canvasA = await dbA.Canvases.SingleAsync(c => c.FeatureId == featureId);
        var canvasB = await dbB.Canvases.SingleAsync(c => c.FeatureId == featureId);

        canvasA.Version++;
        await dbA.SaveChangesAsync();

        canvasB.Version++;
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => dbB.SaveChangesAsync());
    }
}
