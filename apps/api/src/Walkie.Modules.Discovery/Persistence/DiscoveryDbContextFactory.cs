using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Walkie.Modules.Discovery.Persistence;

/// <summary>Solo para <c>dotnet ef</c> (migraciones); la app usa la cadena de conexión de la configuración.</summary>
internal sealed class DiscoveryDbContextFactory : IDesignTimeDbContextFactory<DiscoveryDbContext>
{
    public DiscoveryDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<DiscoveryDbContext>()
            .UseNpgsql("Host=localhost;Database=walkie_design", DiscoveryModule.ConfigureNpgsql)
            .Options);
}
