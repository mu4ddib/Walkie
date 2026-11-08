using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Walkie.Modules.Sharing.Persistence;

/// <summary>Solo para <c>dotnet ef</c> (migraciones); la app usa la cadena de conexión de la configuración.</summary>
internal sealed class SharingDbContextFactory : IDesignTimeDbContextFactory<SharingDbContext>
{
    public SharingDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SharingDbContext>()
            .UseNpgsql("Host=localhost;Database=walkie_design", SharingModule.ConfigureNpgsql)
            .Options);
}
