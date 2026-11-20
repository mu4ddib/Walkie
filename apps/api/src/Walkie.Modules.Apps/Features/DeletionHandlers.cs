using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

/// <summary>Cómo terminó un pedido de eliminación (lo traduce a HTTP <c>DeletionEndpoints</c>).</summary>
internal abstract record DeletionOutcome
{
    public sealed record Completed(DeletionResponse Deletion) : DeletionOutcome;

    public sealed record Pending(DeletionResponse Deletion) : DeletionOutcome;

    public sealed record NotFound : DeletionOutcome;

    public sealed record Blocked(DeletionImpactResponse Impact) : DeletionOutcome;

    public sealed record Changed(string Message, DeletionImpactResponse Impact) : DeletionOutcome;

    public sealed record Invalid(string Field, string Message) : DeletionOutcome;

    public sealed record Conflict(string Message) : DeletionOutcome;
}

/// <summary>
/// Eliminación de una feature o una app (ADR-0017). Fase 1, en una transacción de Apps: la bitácora y la marca, que la
/// dejan inaccesible de inmediato (las features marcadas las oculta el filtro global; a una app además se le quitan los
/// miembros). Fase 2, idempotente: cada <see cref="IDeletionParticipant"/> borra lo suyo en orden y al final Apps borra
/// sus filas. Un fallo deja la bitácora <c>pending</c> con el paso y el error; <see cref="DeletionRecovery"/> la retoma.
/// </summary>
internal sealed partial class DeletionHandlers(
    AppsDbContext db,
    IEnumerable<IDeletionParticipant> participants,
    IDeletionCheckpoints checkpoints,
    TimeProvider clock,
    ILogger<DeletionHandlers> logger)
{
    /// <summary>Lo que una ejecución tiene tomada una eliminación antes de que otra pueda retomarla.</summary>
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    /// <summary>Espera antes de reintentar una eliminación que falló (la recuperación no la toma antes).</summary>
    public static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);

    public const string AppsStep = "apps";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private List<IDeletionParticipant> Ordered => [.. participants.OrderBy(p => p.Order)];

    // ---------- Impacto ----------

    public async Task<DeletionImpactResponse?> FeatureImpactAsync(Guid featureId, CancellationToken ct)
    {
        var feature = await db.Features.AsNoTracking().SingleOrDefaultAsync(f => f.Id == featureId, ct).ConfigureAwait(false);
        return feature is null ? null : await DescribeFeatureAsync(feature, ct).ConfigureAwait(false);
    }

    public async Task<DeletionImpactResponse?> AppImpactAsync(Guid appId, CancellationToken ct)
    {
        var app = await db.Apps.AsNoTracking().SingleOrDefaultAsync(a => a.Id == appId && a.DeletingAt == null, ct).ConfigureAwait(false);
        if (app is null)
        {
            return null;
        }

        var impact = await DescribeAppAsync(appId, ct).ConfigureAwait(false);
        return new DeletionImpactResponse(Deletion.AppKind, app.Id, app.Name, false, null, impact.Counts, impact.Blockers);
    }

    private async Task<DeletionImpactResponse> DescribeFeatureAsync(Feature feature, CancellationToken ct)
    {
        var impact = new DeletionImpact();
        if (feature.Kind == FeatureKind.Module)
        {
            impact.Blockers.Add(new DeletionBlocker("module", "Es un módulo compartido: se elimina desde su página («Eliminar módulo»), que dice qué features lo usan.", []));
        }

        var target = new FeatureDeletionTarget(feature.AppId, feature.Id);
        foreach (var participant in Ordered)
        {
            await participant.DescribeFeatureAsync(target, impact, ct).ConfigureAwait(false);
        }

        return new DeletionImpactResponse(Deletion.FeatureKind, feature.Id, feature.Name, false, impact.CanvasVersion ?? 0, impact.Counts, impact.Blockers);
    }

    private async Task<DeletionImpact> DescribeAppAsync(Guid appId, CancellationToken ct)
    {
        var impact = new DeletionImpact();
        var features = await db.Features.IgnoreQueryFilters().AsNoTracking().Where(f => f.AppId == appId)
            .Select(f => new { f.Id, f.Kind }).ToListAsync(ct).ConfigureAwait(false);
        impact.Add("features", features.Count(f => f.Kind == FeatureKind.Feature));
        impact.Add("modules", features.Count(f => f.Kind == FeatureKind.Module));
        impact.Add("catalogItems", await db.CatalogItems.CountAsync(i => i.AppId == appId, ct).ConfigureAwait(false));
        impact.Add("members", await db.Memberships.CountAsync(m => m.AppId == appId, ct).ConfigureAwait(false));
        var target = new AppDeletionTarget(appId, [.. features.Select(f => f.Id)]);
        foreach (var participant in Ordered)
        {
            await participant.DescribeAppAsync(target, impact, ct).ConfigureAwait(false);
        }

        return impact;
    }

    // ---------- Eliminar una feature ----------

    public async Task<DeletionOutcome> DeleteFeatureAsync(Guid featureId, Guid deletionId, int? canvasVersion, string userId, CancellationToken ct)
    {
        if (await ExistingAsync(deletionId, userId, ct).ConfigureAwait(false) is { } existing)
        {
            return existing;
        }

        if (canvasVersion is null)
        {
            return new DeletionOutcome.Invalid("canvasVersion", "Falta la versión del lienzo que viste: pide el impacto antes de eliminar.");
        }

        var feature = await db.Features.AsNoTracking().SingleOrDefaultAsync(f => f.Id == featureId, ct).ConfigureAwait(false);
        if (feature is null)
        {
            return new DeletionOutcome.NotFound();
        }

        var impact = await DescribeFeatureAsync(feature, ct).ConfigureAwait(false);
        if (Refusal(impact, canvasVersion.Value) is { } refused)
        {
            return refused;
        }

        // Fase 1: bitácora y marca juntas. Desde aquí la feature no existe para nadie (ni su enlace público).
        var now = clock.GetUtcNowForDb();
        await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            var marked = await db.Features.Where(f => f.Id == featureId && f.DeletingAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, now), ct).ConfigureAwait(false);
            if (marked == 0)
            {
                return new DeletionOutcome.NotFound();
            }

            db.Deletions.Add(Journal(deletionId, Deletion.FeatureKind, feature.AppId, featureId, feature.Name, userId, now));
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        // Lo que cambió entre la consulta y la marca (un portal nuevo, un guardado en vuelo): se deshace la marca.
        var after = await DescribeFeatureAsync(feature, ct).ConfigureAwait(false);
        if (Refusal(after, canvasVersion.Value) is { } late)
        {
            await db.Features.IgnoreQueryFilters().Where(f => f.Id == featureId)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, (DateTimeOffset?)null), CancellationToken.None).ConfigureAwait(false);
            await db.Deletions.Where(d => d.Id == deletionId)
                .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, Deletion.Cancelled).SetProperty(d => d.LeaseUntil, (DateTimeOffset?)null), CancellationToken.None)
                .ConfigureAwait(false);
            return late;
        }

        return await RunAsync(deletionId, ownsLease: true, CancellationToken.None).ConfigureAwait(false);
    }

    private static DeletionOutcome? Refusal(DeletionImpactResponse impact, int canvasVersion) =>
        impact.Blockers.Count > 0 ? new DeletionOutcome.Blocked(impact)
        : impact.CanvasVersion != canvasVersion
            ? new DeletionOutcome.Changed("La feature cambió desde que viste el resumen (alguien guardó su lienzo): revísalo de nuevo antes de eliminarla.", impact)
            : null;

    // ---------- Eliminar una app ----------

    public async Task<DeletionOutcome> DeleteAppAsync(Guid appId, Guid deletionId, string? confirmName, string userId, CancellationToken ct)
    {
        if (await ExistingAsync(deletionId, userId, ct).ConfigureAwait(false) is { } existing)
        {
            return existing;
        }

        var app = await db.Apps.AsNoTracking().SingleOrDefaultAsync(a => a.Id == appId && a.DeletingAt == null, ct).ConfigureAwait(false);
        if (app is null)
        {
            return new DeletionOutcome.NotFound();
        }

        if (!string.Equals(confirmName?.Trim(), app.Name, StringComparison.Ordinal))
        {
            return new DeletionOutcome.Invalid("confirmName", "Escribe el nombre exacto de la app para confirmar que quieres eliminarla.");
        }

        var impact = await DescribeAppAsync(appId, ct).ConfigureAwait(false);
        if (impact.Blockers.Count > 0)
        {
            return new DeletionOutcome.Blocked(new DeletionImpactResponse(Deletion.AppKind, app.Id, app.Name, false, null, impact.Counts, impact.Blockers));
        }

        // Fase 1: bitácora, marca de la app y de todo lo suyo, y sin miembros: nadie vuelve a entrar.
        var now = clock.GetUtcNowForDb();
        await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            // La fila de la app, bloqueada: dos eliminaciones a la vez no pasan las dos de aquí.
            var locked = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM apps.apps WHERE id = {appId} AND deleting_at IS NULL FOR UPDATE")
                .ToListAsync(ct).ConfigureAwait(false);
            if (locked.Count == 0)
            {
                return new DeletionOutcome.NotFound();
            }

            await db.Apps.Where(a => a.Id == appId).ExecuteUpdateAsync(s => s.SetProperty(a => a.DeletingAt, now), ct).ConfigureAwait(false);
            await db.Features.IgnoreQueryFilters().Where(f => f.AppId == appId && f.DeletingAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, now), ct).ConfigureAwait(false);
            await db.Memberships.Where(m => m.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
            db.Deletions.Add(Journal(deletionId, Deletion.AppKind, appId, null, app.Name, userId, now));
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        return await RunAsync(deletionId, ownsLease: true, CancellationToken.None).ConfigureAwait(false);
    }

    private static Deletion Journal(Guid id, string kind, Guid appId, Guid? featureId, string name, string userId, DateTimeOffset now) =>
        new()
        {
            Id = id,
            Kind = kind,
            AppId = appId,
            FeatureId = featureId,
            Name = name,
            RequestedBy = userId,
            RequestedAt = now,
            Status = Deletion.Pending,
            LeaseUntil = now + Lease,
        };

    /// <summary>
    /// El mismo id de eliminación otra vez (un reintento): su estado, retomándola si quedó pendiente. Otro usuario con ese
    /// id: conflicto. Una cancelada (la feature cambió en medio) no se reutiliza.
    /// </summary>
    private async Task<DeletionOutcome?> ExistingAsync(Guid deletionId, string userId, CancellationToken ct)
    {
        var deletion = await db.Deletions.AsNoTracking().SingleOrDefaultAsync(d => d.Id == deletionId, ct).ConfigureAwait(false);
        if (deletion is null)
        {
            return null;
        }

        if (deletion.RequestedBy != userId || deletion.Status == Deletion.Cancelled)
        {
            return new DeletionOutcome.Conflict("Ese id de eliminación ya se usó: pide otra.");
        }

        return deletion.Status == Deletion.Pending
            ? await RunAsync(deletionId, ownsLease: false, CancellationToken.None).ConfigureAwait(false)
            : new DeletionOutcome.Completed(Response(deletion));
    }

    /// <summary>El estado de una eliminación, solo para quien la pidió (la app ya puede no existir). Retoma una pendiente.</summary>
    public async Task<DeletionResponse?> StatusAsync(Guid deletionId, string userId, CancellationToken ct)
    {
        var deletion = await db.Deletions.AsNoTracking().SingleOrDefaultAsync(d => d.Id == deletionId && d.RequestedBy == userId, ct).ConfigureAwait(false);
        if (deletion is null)
        {
            return null;
        }

        if (deletion.Status != Deletion.Pending)
        {
            return Response(deletion);
        }

        return await RunAsync(deletionId, ownsLease: false, CancellationToken.None).ConfigureAwait(false) switch
        {
            DeletionOutcome.Completed c => c.Deletion,
            DeletionOutcome.Pending p => p.Deletion,
            _ => Response(deletion),
        };
    }

    // ---------- Fase 2 ----------

    /// <summary>
    /// Corre (o retoma) la fase 2. Sin <paramref name="ownsLease"/>, primero toma la concesión: si otra ejecución la tiene
    /// o la espera tras un fallo no venció, solo informa el estado. Cada paso es idempotente: se repiten todos.
    /// </summary>
    public async Task<DeletionOutcome> RunAsync(Guid deletionId, bool ownsLease, CancellationToken ct)
    {
        var now = clock.GetUtcNowForDb();
        if (!ownsLease)
        {
            var taken = await db.Deletions
                .Where(d => d.Id == deletionId && d.Status == Deletion.Pending && (d.LeaseUntil == null || d.LeaseUntil < now))
                .ExecuteUpdateAsync(s => s.SetProperty(d => d.LeaseUntil, now + Lease), ct).ConfigureAwait(false);
            if (taken == 0)
            {
                var current = await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false);
                return Outcome(current);
            }
        }

        var deletion = await db.Deletions.SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false);
        deletion.Attempts++;
        var steps = new List<DeletionStepResult>();
        var step = "";
        try
        {
            if (deletion.Kind == Deletion.FeatureKind)
            {
                var target = new FeatureDeletionTarget(deletion.AppId, deletion.FeatureId!.Value);
                foreach (var participant in Ordered)
                {
                    step = participant.Step;
                    await checkpoints.ReachedAsync(deletionId, step, CancellationToken.None).ConfigureAwait(false);
                    await participant.DeleteFeatureAsync(target, CancellationToken.None).ConfigureAwait(false);
                    steps.Add(new DeletionStepResult(step, "done", null));
                }

                step = AppsStep;
                await checkpoints.ReachedAsync(deletionId, step, CancellationToken.None).ConfigureAwait(false);
                await db.Features.IgnoreQueryFilters().Where(f => f.Id == target.FeatureId).ExecuteDeleteAsync(CancellationToken.None).ConfigureAwait(false);
                steps.Add(new DeletionStepResult(step, "done", null));
            }
            else
            {
                // Una feature creada en vuelo durante la fase 1 también se marca y entra en la limpieza.
                await db.Features.IgnoreQueryFilters().Where(f => f.AppId == deletion.AppId && f.DeletingAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, now), CancellationToken.None).ConfigureAwait(false);
                var featureIds = await db.Features.IgnoreQueryFilters().AsNoTracking().Where(f => f.AppId == deletion.AppId)
                    .Select(f => f.Id).ToListAsync(CancellationToken.None).ConfigureAwait(false);
                var target = new AppDeletionTarget(deletion.AppId, featureIds);
                foreach (var participant in Ordered)
                {
                    step = participant.Step;
                    await checkpoints.ReachedAsync(deletionId, step, CancellationToken.None).ConfigureAwait(false);
                    await participant.DeleteAppAsync(target, CancellationToken.None).ConfigureAwait(false);
                    steps.Add(new DeletionStepResult(step, "done", null));
                }

                step = AppsStep;
                await checkpoints.ReachedAsync(deletionId, step, CancellationToken.None).ConfigureAwait(false);
                await using var tx = await db.Database.BeginTransactionAsync(CancellationToken.None).ConfigureAwait(false);
                await db.Memberships.Where(m => m.AppId == deletion.AppId).ExecuteDeleteAsync(CancellationToken.None).ConfigureAwait(false);
                await db.CatalogItems.Where(i => i.AppId == deletion.AppId).ExecuteDeleteAsync(CancellationToken.None).ConfigureAwait(false);
                await db.Features.IgnoreQueryFilters().Where(f => f.AppId == deletion.AppId).ExecuteDeleteAsync(CancellationToken.None).ConfigureAwait(false);
                await db.Apps.Where(a => a.Id == deletion.AppId).ExecuteDeleteAsync(CancellationToken.None).ConfigureAwait(false);
                await tx.CommitAsync(CancellationToken.None).ConfigureAwait(false);
                steps.Add(new DeletionStepResult(step, "done", null));
            }

            deletion.Status = Deletion.Completed;
            deletion.CompletedAt = clock.GetUtcNowForDb();
            deletion.LeaseUntil = null;
            deletion.Error = null;
            LogCompleted(logger, deletionId, deletion.Kind, deletion.AppId);
        }
#pragma warning disable CA1031 // Un fallo en cualquier módulo se registra y queda para reintentar; nunca se pierde.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            var message = Truncate(ex.Message, 500);
            steps.Add(new DeletionStepResult(step, "failed", message));
            deletion.Error = string.Create(CultureInfo.InvariantCulture, $"{step}: {message}");
            deletion.LeaseUntil = clock.GetUtcNowForDb() + RetryAfter;
            LogIncomplete(logger, ex, deletionId, step);
        }

        deletion.Steps = JsonSerializer.Serialize(steps, Json);
        await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        return Outcome(deletion);
    }

    /// <summary>Las eliminaciones pendientes que ya se pueden retomar (la concesión venció).</summary>
    public async Task<IReadOnlyList<Guid>> ResumableAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNowForDb();
        return await db.Deletions.AsNoTracking()
            .Where(d => d.Status == Deletion.Pending && (d.LeaseUntil == null || d.LeaseUntil < now))
            .OrderBy(d => d.RequestedAt).Select(d => d.Id).Take(20).ToListAsync(ct).ConfigureAwait(false);
    }

    private static DeletionOutcome Outcome(Deletion deletion) =>
        deletion.Status == Deletion.Completed
            ? new DeletionOutcome.Completed(Response(deletion))
            : new DeletionOutcome.Pending(Response(deletion));

    private static DeletionResponse Response(Deletion d) =>
        new(d.Id, d.Kind, d.AppId, d.FeatureId, d.Name, d.Status, d.RequestedAt, d.CompletedAt,
            JsonSerializer.Deserialize<List<DeletionStepResult>>(d.Steps, Json) ?? [], d.Error);

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];

    [LoggerMessage(Level = LogLevel.Information, Message = "Eliminación {DeletionId} completa: {Kind} de la app {AppId}.")]
    private static partial void LogCompleted(ILogger logger, Guid deletionId, string kind, Guid appId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Eliminación {DeletionId} incompleta en el paso {Step}: queda pending y se reintentará.")]
    private static partial void LogIncomplete(ILogger logger, Exception exception, Guid deletionId, string step);
}

/// <summary>Sin puntos de prueba (producción).</summary>
internal sealed class NoDeletionCheckpoints : IDeletionCheckpoints
{
    public Task ReachedAsync(Guid deletionId, string step, CancellationToken cancellationToken) => Task.CompletedTask;
}
