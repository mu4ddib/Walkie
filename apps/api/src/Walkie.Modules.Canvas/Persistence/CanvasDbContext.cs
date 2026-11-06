using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Canvas.Domain;

namespace Walkie.Modules.Canvas.Persistence;

/// <summary>Datos del módulo Canvas, en el schema <c>canvas</c>. Ningún otro módulo lo usa.</summary>
internal sealed class CanvasDbContext(DbContextOptions<CanvasDbContext> options) : DbContext(options)
{
    public const string Schema = "canvas";

    public DbSet<CanvasDocument> Canvases => Set<CanvasDocument>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<CanvasDocument>(canvas =>
        {
            canvas.ToTable("canvases");
            canvas.HasKey(c => c.FeatureId);
            canvas.Property(c => c.FeatureId).HasColumnName("feature_id").ValueGeneratedNever();
            canvas.Property(c => c.Graph).HasColumnName("graph").HasColumnType("jsonb");
            canvas.Property(c => c.Version).HasColumnName("version").IsConcurrencyToken();
            canvas.Property(c => c.UpdatedAt).HasColumnName("updated_at");
            canvas.Property(c => c.UpdatedBy).HasColumnName("updated_by").HasMaxLength(255);
        });
    }
}
