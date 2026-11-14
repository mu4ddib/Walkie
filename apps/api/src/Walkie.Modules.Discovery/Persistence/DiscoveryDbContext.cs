using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Discovery.Domain;

namespace Walkie.Modules.Discovery.Persistence;

/// <summary>
/// Datos del módulo Discovery, en el schema <c>discovery</c> (ADR-0012). Ningún otro módulo lo usa, y Discovery no
/// toca tablas de otros módulos. Un análisis y todo lo que trae (entidades, relaciones, evidencia) es inmutable:
/// guardar un cambio o un borrado de ellos lanza una excepción.
/// </summary>
internal sealed class DiscoveryDbContext(DbContextOptions<DiscoveryDbContext> options) : DbContext(options)
{
    public const string Schema = "discovery";

    public DbSet<Source> Sources => Set<Source>();

    public DbSet<Snapshot> Snapshots => Set<Snapshot>();

    public DbSet<DiscoveredEntity> Entities => Set<DiscoveredEntity>();

    public DbSet<DiscoveredRelation> Relations => Set<DiscoveredRelation>();

    public DbSet<DiscoveredEvidence> Evidence => Set<DiscoveredEvidence>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        RejectChangesToSnapshots();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        RejectChangesToSnapshots();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>Un análisis es procedencia: una vez guardado no cambia ni se borra (ADR-0014).</summary>
    private void RejectChangesToSnapshots()
    {
        // EF detecta los cambios de propiedades dentro de SaveChanges, después de este punto: hay que forzarlo antes.
        ChangeTracker.DetectChanges();
        var changed = ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Modified or EntityState.Deleted)
            .FirstOrDefault(e => e.Entity is Snapshot or DiscoveredEntity or DiscoveredRelation or DiscoveredEvidence);
        if (changed is not null)
        {
            throw new InvalidOperationException(
                $"Un análisis de Discovery es inmutable: no se puede {(changed.State == EntityState.Deleted ? "borrar" : "modificar")} {changed.Entity.GetType().Name}.");
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<Source>(source =>
        {
            source.ToTable("sources");
            source.HasKey(s => new { s.AppId, s.Id });
            source.Property(s => s.AppId).HasColumnName("app_id");
            source.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
            source.Property(s => s.Name).HasColumnName("name").HasMaxLength(Source.NameMaxLength);
            source.Property(s => s.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            source.Property(s => s.CreatedAt).HasColumnName("created_at");
            source.Property(s => s.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<Snapshot>(snapshot =>
        {
            snapshot.ToTable("snapshots");
            snapshot.HasKey(s => s.Id);
            snapshot.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
            snapshot.Property(s => s.AppId).HasColumnName("app_id");
            snapshot.Property(s => s.SourceId).HasColumnName("source_id");
            snapshot.Property(s => s.PreviousSnapshotId).HasColumnName("previous_snapshot_id");
            snapshot.Property(s => s.FormatVersion).HasColumnName("format_version");
            snapshot.Property(s => s.AnalyzerName).HasColumnName("analyzer_name").HasMaxLength(60);
            snapshot.Property(s => s.AnalyzerVersion).HasColumnName("analyzer_version").HasMaxLength(80);
            snapshot.Property(s => s.GeneratedAt).HasColumnName("generated_at");
            snapshot.Property(s => s.ImportedAt).HasColumnName("imported_at");
            snapshot.Property(s => s.ImportedBy).HasColumnName("imported_by").HasMaxLength(255);
            snapshot.Property(s => s.Completeness).HasColumnName("completeness").HasMaxLength(10);
            snapshot.Property(s => s.PackSha256).HasColumnName("pack_sha256").HasMaxLength(64).IsFixedLength();
            snapshot.Property(s => s.ContentFingerprint).HasColumnName("content_fingerprint").HasMaxLength(71);
            snapshot.Property(s => s.Manifest).HasColumnName("manifest").HasColumnType("jsonb");
            snapshot.HasOne<Source>().WithMany().HasForeignKey(s => new { s.AppId, s.SourceId }).OnDelete(DeleteBehavior.Restrict);
            snapshot.HasOne<Snapshot>().WithMany().HasForeignKey(s => s.PreviousSnapshotId).OnDelete(DeleteBehavior.Restrict);
            // El mismo archivo en la misma fuente de la misma app es el mismo análisis (también ante dos subidas a la vez).
            snapshot.HasIndex(s => new { s.AppId, s.SourceId, s.PackSha256 }).IsUnique().HasDatabaseName("ux_snapshots_app_source_pack");
            snapshot.HasIndex(s => new { s.AppId, s.SourceId, s.ImportedAt }).HasDatabaseName("ix_snapshots_app_source_imported");
        });

        modelBuilder.Entity<DiscoveredEntity>(entity =>
        {
            entity.ToTable("entities");
            entity.HasKey(e => new { e.SnapshotId, e.Key });
            entity.Property(e => e.SnapshotId).HasColumnName("snapshot_id");
            entity.Property(e => e.Key).HasColumnName("key").HasMaxLength(500);
            entity.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(20);
            entity.Property(e => e.Title).HasColumnName("title").HasMaxLength(120);
            entity.Property(e => e.Basis).HasColumnName("basis").HasMaxLength(10);
            entity.Property(e => e.Confidence).HasColumnName("confidence").HasMaxLength(10);
            entity.Property(e => e.Fingerprint).HasColumnName("fingerprint").HasMaxLength(71);
            entity.Property(e => e.Data).HasColumnName("data").HasColumnType("jsonb");
            entity.HasOne<Snapshot>().WithMany().HasForeignKey(e => e.SnapshotId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.SnapshotId, e.Kind }).HasDatabaseName("ix_entities_snapshot_kind");
        });

        modelBuilder.Entity<DiscoveredRelation>(relation =>
        {
            relation.ToTable("relations");
            relation.HasKey(r => new { r.SnapshotId, r.Key });
            relation.Property(r => r.SnapshotId).HasColumnName("snapshot_id");
            relation.Property(r => r.Key).HasColumnName("key").HasMaxLength(1100);
            relation.Property(r => r.Kind).HasColumnName("kind").HasMaxLength(20);
            relation.Property(r => r.FromKey).HasColumnName("from_key").HasMaxLength(500);
            relation.Property(r => r.ToKey).HasColumnName("to_key").HasMaxLength(500);
            relation.Property(r => r.Basis).HasColumnName("basis").HasMaxLength(10);
            relation.Property(r => r.Confidence).HasColumnName("confidence").HasMaxLength(10);
            relation.Property(r => r.Data).HasColumnName("data").HasColumnType("jsonb");
            relation.HasOne<Snapshot>().WithMany().HasForeignKey(r => r.SnapshotId).OnDelete(DeleteBehavior.Restrict);
            relation.HasOne<DiscoveredEntity>().WithMany().HasForeignKey(r => new { r.SnapshotId, r.FromKey }).OnDelete(DeleteBehavior.Restrict);
            relation.HasOne<DiscoveredEntity>().WithMany().HasForeignKey(r => new { r.SnapshotId, r.ToKey }).OnDelete(DeleteBehavior.Restrict);
            relation.HasIndex(r => new { r.SnapshotId, r.FromKey }).HasDatabaseName("ix_relations_snapshot_from");
            relation.HasIndex(r => new { r.SnapshotId, r.ToKey }).HasDatabaseName("ix_relations_snapshot_to");
        });

        modelBuilder.Entity<DiscoveredEvidence>(evidence =>
        {
            evidence.ToTable("evidence");
            evidence.HasKey(e => new { e.SnapshotId, e.Id });
            evidence.Property(e => e.SnapshotId).HasColumnName("snapshot_id");
            evidence.Property(e => e.Id).HasColumnName("id").HasMaxLength(64);
            evidence.Property(e => e.Detector).HasColumnName("detector").HasMaxLength(60);
            evidence.Property(e => e.Path).HasColumnName("path").HasMaxLength(1024);
            evidence.Property(e => e.Data).HasColumnName("data").HasColumnType("jsonb");
            evidence.HasOne<Snapshot>().WithMany().HasForeignKey(e => e.SnapshotId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
