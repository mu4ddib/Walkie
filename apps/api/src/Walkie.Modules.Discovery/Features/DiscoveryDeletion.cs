using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Walkie Live al eliminar (ADR-0017).
/// <list type="bullet">
/// <item><b>Una feature:</b> no se borra nada. Su vínculo <c>created</c> se conserva tal cual (no se reescribe ningún
/// análisis ni bitácora <c>completed</c>); la revisión siguiente lo muestra con <c>targetMissing</c> y la persona decide
/// de nuevo. Nada se recrea solo. Si una aplicación en curso la está creando, se bloquea.</item>
/// <item><b>Una app:</b> su historial entero se purga con <see cref="PurgeAppAsync"/>, la única excepción a la
/// inmutabilidad de los análisis, y solo la llama la eliminación. Si una aplicación o importación sigue en curso (su
/// candado tomado), se bloquea; si empieza una en medio, la purga falla y la eliminación se reintenta después.</item>
/// </list>
/// </summary>
internal sealed class DiscoveryDeletion(DiscoveryDbContext db) : IDeletionParticipant
{
    public string Step => "discovery";

    public int Order => 20;

    public async Task DescribeFeatureAsync(FeatureDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken)
    {
        impact.Add("provenance", await db.Bindings.CountAsync(
            b => b.AppId == target.AppId && b.TargetKind == "feature" && b.TargetId == target.FeatureId && b.Decision != null,
            cancellationToken).ConfigureAwait(false));
        var creating = await (from step in db.ApplySteps
                              join apply in db.Applies on step.ApplyId equals apply.ApplyId
                              where apply.AppId == target.AppId && apply.Status == ApplyRecord.Pending && step.TargetId == target.FeatureId
                              select apply.ApplyId).AnyAsync(cancellationToken).ConfigureAwait(false);
        if (creating)
        {
            impact.Blockers.Add(new DeletionBlocker("discovery-in-progress",
                "Walkie Live todavía está creando esta feature (una aplicación quedó pendiente): espera a que termine o se deshaga.", []));
        }
    }

    public Task DeleteFeatureAsync(FeatureDeletionTarget target, CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task DescribeAppAsync(AppDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken)
    {
        impact.Add("sources", await db.Sources.CountAsync(s => s.AppId == target.AppId, cancellationToken).ConfigureAwait(false));
        impact.Add("snapshots", await db.Snapshots.CountAsync(s => s.AppId == target.AppId, cancellationToken).ConfigureAwait(false));
        impact.Add("decisions", await db.Bindings.CountAsync(b => b.AppId == target.AppId && b.Decision != null, cancellationToken).ConfigureAwait(false));
        var running = await RunningAsync(target.AppId, cancellationToken).ConfigureAwait(false);
        impact.Add("pendingOperations", running);
        if (running > 0)
        {
            impact.Blockers.Add(new DeletionBlocker("discovery-in-progress",
                "Hay una aplicación o una importación de Walkie Live en curso en esta app: espera a que termine.", []));
        }
    }

    public Task DeleteAppAsync(AppDeletionTarget target, CancellationToken cancellationToken) => PurgeAppAsync(target.AppId, cancellationToken);

    /// <summary>
    /// Purga de mantenimiento: todo lo de Walkie Live de una app, en el orden de sus claves foráneas, en una transacción.
    /// Usa borrados directos (sin pasar por la guarda de inmutabilidad de <see cref="DiscoveryDbContext"/>) a propósito:
    /// es la eliminación de la app (ADR-0017), registrada en su bitácora. Idempotente.
    /// </summary>
    private async Task PurgeAppAsync(Guid appId, CancellationToken ct)
    {
        if (await RunningAsync(appId, ct).ConfigureAwait(false) > 0)
        {
            throw new InvalidOperationException("Hay una operación de Walkie Live en curso en esta app: la purga se reintentará cuando termine.");
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        var applies = db.Applies.Where(a => a.AppId == appId).Select(a => a.ApplyId);
        await db.ApplySteps.Where(s => applies.Contains(s.ApplyId)).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await db.Applies.Where(a => a.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await db.SourceImports.Where(i => i.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await db.Bindings.Where(b => b.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        var snapshots = db.Snapshots.Where(s => s.AppId == appId).Select(s => s.Id);
        await db.Relations.Where(r => snapshots.Contains(r.SnapshotId)).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await db.Evidence.Where(e => snapshots.Contains(e.SnapshotId)).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await db.Entities.Where(e => snapshots.Contains(e.SnapshotId)).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        // La cadena de análisis se apunta a sí misma: se corta antes de borrarla.
        await db.Snapshots.Where(s => s.AppId == appId && s.PreviousSnapshotId != null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.PreviousSnapshotId, (Guid?)null), ct).ConfigureAwait(false);
        await db.Snapshots.Where(s => s.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await db.Sources.Where(s => s.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
        await tx.CommitAsync(ct).ConfigureAwait(false);
    }

    /// <summary>Aplicaciones e importaciones pendientes de la app cuyo candado está tomado ahora (en curso de verdad).</summary>
    private async Task<int> RunningAsync(Guid appId, CancellationToken ct)
    {
        var pending = await db.Applies.AsNoTracking().Where(a => a.AppId == appId && a.Status == ApplyRecord.Pending).Select(a => a.ApplyId)
            .Concat(db.SourceImports.AsNoTracking().Where(i => i.AppId == appId && i.Status == SourceImport.Pending).Select(i => i.ImportId))
            .ToListAsync(ct).ConfigureAwait(false);
        var running = 0;
        foreach (var id in pending)
        {
            await using var held = await ApplyLock.TryAcquireAsync(db, id, ct).ConfigureAwait(false);
            if (held is null)
            {
                running++;
            }
        }

        return running;
    }
}
