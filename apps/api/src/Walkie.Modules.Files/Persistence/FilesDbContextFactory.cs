using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Walkie.Modules.Files.Persistence;

/// <summary>Solo para <c>dotnet ef</c> (migraciones); la app usa la cadena de conexión de la configuración.</summary>
internal sealed class FilesDbContextFactory : IDesignTimeDbContextFactory<FilesDbContext>
{
    public FilesDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<FilesDbContext>()
            .UseNpgsql("Host=localhost;Database=walkie_design", FilesModule.ConfigureNpgsql)
            .Options);
}
