using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Domain;

namespace Walkie.Modules.Apps.Persistence;

/// <summary>Datos del módulo Apps, en el schema <c>apps</c>. Ningún otro módulo lo usa.</summary>
internal sealed class AppsDbContext(DbContextOptions<AppsDbContext> options) : DbContext(options)
{
    public const string Schema = "apps";

    public DbSet<App> Apps => Set<App>();
    public DbSet<Feature> Features => Set<Feature>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<App>(app =>
        {
            app.ToTable("apps");
            app.HasKey(a => a.Id);
            app.Property(a => a.Id).HasColumnName("id").ValueGeneratedNever();
            app.Property(a => a.Name).HasColumnName("name").HasMaxLength(App.NameMaxLength);
            app.Property(a => a.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            app.Property(a => a.CreatedAt).HasColumnName("created_at");
            app.HasMany(a => a.Features).WithOne().HasForeignKey(f => f.AppId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Feature>(feature =>
        {
            feature.ToTable("features");
            feature.HasKey(f => f.Id);
            feature.Property(f => f.Id).HasColumnName("id").ValueGeneratedNever();
            feature.Property(f => f.AppId).HasColumnName("app_id");
            feature.Property(f => f.Name).HasColumnName("name").HasMaxLength(Feature.NameMaxLength);
            feature.Property(f => f.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            feature.Property(f => f.CreatedAt).HasColumnName("created_at");
            feature.HasIndex(f => f.AppId).HasDatabaseName("ix_features_app_id");
        });
    }
}
