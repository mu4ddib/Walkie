using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Walkie.Modules.Apps.Persistence;

/// <summary>Solo para `dotnet ef` (crear migraciones). No se conecta a ninguna base.</summary>
internal sealed class AppsDbContextFactory : IDesignTimeDbContextFactory<AppsDbContext>
{
    public AppsDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppsDbContext>()
            .UseNpgsql("Host=localhost;Database=walkie_design_time", AppsModule.ConfigureNpgsql)
            .Options;
        return new AppsDbContext(options);
    }
}
