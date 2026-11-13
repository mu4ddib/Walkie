using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Domain;

namespace Walkie.Modules.Apps.Persistence;

/// <summary>Datos del módulo Apps, en el schema <c>apps</c>. Ningún otro módulo lo usa.</summary>
internal sealed class AppsDbContext(DbContextOptions<AppsDbContext> options) : DbContext(options)
{
    public const string Schema = "apps";

    public DbSet<App> Apps => Set<App>();
    public DbSet<Feature> Features => Set<Feature>();
    public DbSet<CatalogItem> CatalogItems => Set<CatalogItem>();

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
            feature.Property(f => f.Kind).HasColumnName("kind").HasMaxLength(16).HasDefaultValue(FeatureKind.Feature);
            feature.Property(f => f.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            feature.Property(f => f.Description).HasColumnName("description").HasMaxLength(Feature.DescriptionMaxLength).HasDefaultValue("");
            feature.Property(f => f.CreatedAt).HasColumnName("created_at");
            feature.Property(f => f.UpdatedAt).HasColumnName("updated_at");
            feature.HasIndex(f => f.AppId).HasDatabaseName("ix_features_app_id");
        });

        modelBuilder.Entity<CatalogItem>(item =>
        {
            item.ToTable("catalog_items");
            item.HasKey(i => i.Id);
            item.Property(i => i.Id).HasColumnName("id").ValueGeneratedNever();
            item.Property(i => i.AppId).HasColumnName("app_id");
            item.Property(i => i.Type).HasColumnName("type").HasMaxLength(16);
            item.Property(i => i.Title).HasColumnName("title").HasMaxLength(CatalogItem.TitleMaxLength);
            item.Property(i => i.Description).HasColumnName("description").HasMaxLength(CatalogItem.TextMaxLength);
            item.Property(i => i.Http).HasColumnName("http").HasColumnType("jsonb");
            item.Property(i => i.Database).HasColumnName("database").HasColumnType("jsonb");
            item.Property(i => i.Resource).HasColumnName("resource").HasColumnType("jsonb");
            item.Property(i => i.Runtime).HasColumnName("runtime").HasMaxLength(20);
            item.Property(i => i.Version).HasColumnName("version").IsConcurrencyToken();
            item.Property(i => i.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            item.Property(i => i.CreatedAt).HasColumnName("created_at");
            item.Property(i => i.UpdatedBy).HasColumnName("updated_by").HasMaxLength(255);
            item.Property(i => i.UpdatedAt).HasColumnName("updated_at");
            item.HasIndex(i => i.AppId).HasDatabaseName("ix_catalog_items_app_id");
            item.HasOne<App>().WithMany().HasForeignKey(i => i.AppId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
