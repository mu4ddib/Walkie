using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Walkie.Modules.Canvas.Persistence;

/// <summary>Solo para `dotnet ef` (crear migraciones). No se conecta a ninguna base.</summary>
internal sealed class CanvasDbContextFactory : IDesignTimeDbContextFactory<CanvasDbContext>
{
    public CanvasDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<CanvasDbContext>()
            .UseNpgsql("Host=localhost;Database=walkie_design_time", CanvasModule.ConfigureNpgsql)
            .Options;
        return new CanvasDbContext(options);
    }
}
