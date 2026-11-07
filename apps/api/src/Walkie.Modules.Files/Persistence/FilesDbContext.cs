using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Files.Domain;

namespace Walkie.Modules.Files.Persistence;

/// <summary>Datos del módulo Files, en el schema <c>files</c>. Ningún otro módulo lo usa.</summary>
internal sealed class FilesDbContext(DbContextOptions<FilesDbContext> options) : DbContext(options)
{
    public const string Schema = "files";

    public DbSet<Asset> Assets => Set<Asset>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<Asset>(asset =>
        {
            asset.ToTable("assets");
            asset.HasKey(a => a.Id);
            asset.Property(a => a.Id).HasColumnName("id").ValueGeneratedNever();
            asset.Property(a => a.AppId).HasColumnName("app_id");
            asset.Property(a => a.ContentType).HasColumnName("content_type").HasMaxLength(32);
            asset.Property(a => a.Size).HasColumnName("size");
            asset.Property(a => a.Width).HasColumnName("width");
            asset.Property(a => a.Height).HasColumnName("height");
            asset.Property(a => a.StorageKey).HasColumnName("storage_key").HasMaxLength(255);
            asset.Property(a => a.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            asset.Property(a => a.CreatedAt).HasColumnName("created_at");
            asset.HasIndex(a => a.AppId).HasDatabaseName("ix_assets_app_id");
        });
    }
}
