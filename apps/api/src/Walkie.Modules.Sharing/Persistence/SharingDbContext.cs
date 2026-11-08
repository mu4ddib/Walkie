using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Sharing.Domain;

namespace Walkie.Modules.Sharing.Persistence;

/// <summary>Datos del módulo Sharing, en el schema <c>sharing</c>. Ningún otro módulo lo usa.</summary>
internal sealed class SharingDbContext(DbContextOptions<SharingDbContext> options) : DbContext(options)
{
    public const string Schema = "sharing";

    public DbSet<Share> Shares => Set<Share>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<Share>(share =>
        {
            share.ToTable("shares");
            share.HasKey(s => s.Id);
            share.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
            share.Property(s => s.FeatureId).HasColumnName("feature_id");
            share.Property(s => s.TokenHash).HasColumnName("token_hash").HasMaxLength(32);
            share.Property(s => s.CreatedBy).HasColumnName("created_by").HasMaxLength(255);
            share.Property(s => s.CreatedByName).HasColumnName("created_by_name").HasMaxLength(255);
            share.Property(s => s.CreatedAt).HasColumnName("created_at");
            share.Property(s => s.ExpiresAt).HasColumnName("expires_at");
            share.Property(s => s.RevokedAt).HasColumnName("revoked_at");
            share.Property(s => s.LastAccessedAt).HasColumnName("last_accessed_at");
            share.HasIndex(s => s.TokenHash).IsUnique().HasDatabaseName("ux_shares_token_hash");
            share.HasIndex(s => s.FeatureId).HasDatabaseName("ix_shares_feature_id");
        });
    }
}
