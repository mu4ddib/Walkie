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

    public sealed record Busy(string Message) : DeletionOutcome;
}

/// <summary>Esta ejecución perdió el candado o la ficha: otra tiene la eliminación y esta no escribe nada más.</summary>
internal sealed class DeletionSupersededException : Exception
{
    public DeletionSupersededException() : base("Otra ejecución tomó la eliminación.")
    {
    }
}

/// <summary>Solo en pruebas: un punto de prueba la lanza para simular que el proceso murió en ese paso.</summary>
public sealed class DeletionAbandonedException : Exception
{
    public DeletionAbandonedException() : base("Caída simulada.")
    {
    }
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
    AppLocks locks,
    TimeProvider clock,
    ILogger<DeletionHandlers> logger)
{
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

    public async Task<DeletionOutcome> DeleteFeatureAsync(Guid appId, Guid featureId, Guid deletionId, int? canvasVersion, string userId, CancellationToken ct)
    {
        if (canvasVersion is null)
        {
            return new DeletionOutcome.Invalid("canvasVersion", "Falta la versión del lienzo que viste: pide el impacto antes de eliminar.");
        }

        var request = new DeletionRequest(Deletion.FeatureKind, appId, featureId, userId, canvasVersion, null);
        if (await ExistingAsync(deletionId, request, ct).ConfigureAwait(false) is { } existing)
        {
            return existing;
        }

        // El candado exclusivo de la app: espera a las escrituras en curso y ninguna nueva empieza hasta terminar.
        await using var held = await locks.ExclusiveAsync(appId, AppLocks.DeletionSession(deletionId), ct).ConfigureAwait(false);
        if (held is null)
        {
            return Busy();
        }

        // Con el candado: otra solicitud con el mismo id pudo ganar la carrera mientras esperábamos.
        if (await ExistingAsync(deletionId, request, ct, held).ConfigureAwait(false) is { } raced)
        {
            return raced;
        }

        await checkpoints.ReachedAsync(deletionId, LockedStep, ct).ConfigureAwait(false);

        var feature = await db.Features.AsNoTracking().SingleOrDefaultAsync(f => f.Id == featureId && f.AppId == appId, ct).ConfigureAwait(false);
        if (feature is null)
        {
            return new DeletionOutcome.NotFound();
        }

        // El impacto, con el candado tomado: nadie guarda un lienzo ni crea un portal hasta que la marca esté hecha.
        var impact = await DescribeFeatureAsync(feature, ct).ConfigureAwait(false);
        if (Refusal(impact, canvasVersion.Value) is { } refused)
        {
            return refused;
        }

        // Fase 1: bitácora y marca juntas. Desde aquí la feature no existe para nadie (ni su enlace público).
        var now = clock.GetUtcNowForDb();
        var token = Guid.CreateVersion7();
        await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            var marked = await db.Features.Where(f => f.Id == featureId && f.DeletingAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, now), ct).ConfigureAwait(false);
            if (marked == 0)
            {
                return new DeletionOutcome.NotFound();
            }

            db.Deletions.Add(Journal(deletionId, request, feature.Name, now, token));
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        return await RunAsync(deletionId, token, held).ConfigureAwait(false);
    }

    private static DeletionOutcome? Refusal(DeletionImpactResponse impact, int canvasVersion) =>
        impact.Blockers.Count > 0 ? new DeletionOutcome.Blocked(impact)
        : impact.CanvasVersion != canvasVersion
            ? new DeletionOutcome.Changed("La feature cambió desde que viste el resumen (alguien guardó su lienzo): revísalo de nuevo antes de eliminarla.", impact)
            : null;

    // ---------- Eliminar una app ----------

    public async Task<DeletionOutcome> DeleteAppAsync(Guid appId, Guid deletionId, string? confirmName, string userId, CancellationToken ct)
    {
        var request = new DeletionRequest(Deletion.AppKind, appId, null, userId, null, confirmName?.Trim());
        if (await ExistingAsync(deletionId, request, ct).ConfigureAwait(false) is { } existing)
        {
            return existing;
        }

        var app = await db.Apps.AsNoTracking().SingleOrDefaultAsync(a => a.Id == appId && a.DeletingAt == null, ct).ConfigureAwait(false);
        if (app is null)
        {
            return new DeletionOutcome.NotFound();
        }

        if (!string.Equals(request.ConfirmName, app.Name, StringComparison.Ordinal))
        {
            return new DeletionOutcome.Invalid("confirmName", "Escribe el nombre exacto de la app para confirmar que quieres eliminarla.");
        }

        await using var held = await locks.ExclusiveAsync(appId, AppLocks.DeletionSession(deletionId), ct).ConfigureAwait(false);
        if (held is null)
        {
            return Busy();
        }

        if (await ExistingAsync(deletionId, request, ct, held).ConfigureAwait(false) is { } raced)
        {
            return raced;
        }

        await checkpoints.ReachedAsync(deletionId, LockedStep, ct).ConfigureAwait(false);

        var impact = await DescribeAppAsync(appId, ct).ConfigureAwait(false);
        if (impact.Blockers.Count > 0)
        {
            return new DeletionOutcome.Blocked(new DeletionImpactResponse(Deletion.AppKind, app.Id, app.Name, false, null, impact.Counts, impact.Blockers));
        }

        // Fase 1: bitácora, marca de la app y de todo lo suyo, y sin miembros: nadie vuelve a entrar.
        var now = clock.GetUtcNowForDb();
        var token = Guid.CreateVersion7();
        await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            var marked = await db.Apps.Where(a => a.Id == appId && a.DeletingAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.DeletingAt, now), ct).ConfigureAwait(false);
            if (marked == 0)
            {
                return new DeletionOutcome.NotFound();
            }

            await db.Features.IgnoreQueryFilters().Where(f => f.AppId == appId && f.DeletingAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, now), ct).ConfigureAwait(false);
            await db.Memberships.Where(m => m.AppId == appId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
            db.Deletions.Add(Journal(deletionId, request, app.Name, now, token));
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        return await RunAsync(deletionId, token, held).ConfigureAwait(false);
    }

    private static DeletionOutcome.Busy Busy() =>
        new("La app está ocupada (hay escrituras en curso u otra eliminación): vuelve a intentarlo en unos segundos. No se eliminó nada.");

    private static Deletion Journal(Guid id, DeletionRequest request, string name, DateTimeOffset now, Guid token) =>
        new()
        {
            Id = id,
            Kind = request.Kind,
            AppId = request.AppId,
            FeatureId = request.FeatureId,
            Name = name,
            RequestedBy = request.UserId,
            RequestedAt = now,
            CanvasVersion = request.CanvasVersion,
            Status = Deletion.Pending,
            OwnerToken = token,
            Attempts = 1,
        };

    /// <summary>Lo que identifica una solicitud de eliminación: un mismo id solo es un reintento si todo coincide.</summary>
    private sealed record DeletionRequest(string Kind, Guid AppId, Guid? FeatureId, string UserId, int? CanvasVersion, string? ConfirmName);

    /// <summary>
    /// Un id de eliminación que ya existe. Solo es un reintento si es la misma solicitud: mismo tipo, misma app, misma
    /// feature, misma persona y los mismos datos (la versión del lienzo que vio, el nombre que escribió). Si no, 409: un
    /// id nunca sirve para dos recursos. Un reintento devuelve el estado y retoma una pendiente.
    /// </summary>
    private async Task<DeletionOutcome?> ExistingAsync(Guid deletionId, DeletionRequest request, CancellationToken ct, AppLock? held = null)
    {
        var deletion = await db.Deletions.AsNoTracking().SingleOrDefaultAsync(d => d.Id == deletionId, ct).ConfigureAwait(false);
        if (deletion is null)
        {
            return null;
        }

        var same = deletion.Kind == request.Kind
            && deletion.AppId == request.AppId
            && deletion.FeatureId == request.FeatureId
            && deletion.RequestedBy == request.UserId
            && (request.Kind == Deletion.FeatureKind
                ? deletion.CanvasVersion == request.CanvasVersion
                : string.Equals(deletion.Name, request.ConfirmName, StringComparison.Ordinal));
        if (!same)
        {
            return new DeletionOutcome.Conflict("Ese id de eliminación ya se usó para otra solicitud (otro recurso, otra persona u otros datos): genera uno nuevo.");
        }

        return deletion.Status == Deletion.Pending
            ? await ResumeAsync(deletionId, held, ignoreRetryAt: true, CancellationToken.None).ConfigureAwait(false)
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

        return await ResumeAsync(deletionId, held: null, ignoreRetryAt: false, CancellationToken.None).ConfigureAwait(false) switch
        {
            DeletionOutcome.Completed c => c.Deletion,
            DeletionOutcome.Pending p => p.Deletion,
            _ => Response(deletion),
        };
    }

    // ---------- Fase 2 ----------

    /// <summary>
    /// Retoma una eliminación pendiente (recuperación, consulta del estado o reintento). Toma el candado exclusivo de la
    /// app sin esperar: si otra ejecución lo tiene, solo informa el estado. Con el candado, pone una ficha nueva
    /// (fencing) y corre la fase 2. Después de un fallo respeta <see cref="Deletion.RetryAt"/>, salvo un reintento explícito.
    /// </summary>
    public async Task<DeletionOutcome> ResumeAsync(Guid deletionId, AppLock? held, bool ignoreRetryAt, CancellationToken ct)
    {
        var deletion = await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false);
        if (deletion.Status != Deletion.Pending)
        {
            return Outcome(deletion);
        }

        AppLock? taken = null;
        if (held is null)
        {
            taken = await locks.TryExclusiveAsync(deletion.AppId, AppLocks.DeletionSession(deletionId), ct).ConfigureAwait(false);
            if (taken is null)
            {
                return Outcome(deletion);
            }
        }

        await using (taken)
        {
            var now = clock.GetUtcNowForDb();
            var token = Guid.CreateVersion7();
            var claimed = await db.Deletions
                .Where(d => d.Id == deletionId && d.Status == Deletion.Pending && (ignoreRetryAt || d.RetryAt == null || d.RetryAt < now))
                .ExecuteUpdateAsync(s => s.SetProperty(d => d.OwnerToken, token).SetProperty(d => d.Attempts, d => d.Attempts + 1), ct).ConfigureAwait(false);
            if (claimed == 0)
            {
                return Outcome(await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false));
            }

            return await RunAsync(deletionId, token, held ?? taken!).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// La fase 2, con el candado exclusivo tomado y la ficha <paramref name="token"/>. Cada paso es idempotente y antes de
    /// cada uno se comprueba que el candado y la ficha siguen siendo nuestros. El último paso (las filas de Apps) y el cierre
    /// de la bitácora van en una transacción que exige la ficha: si otra ejecución la tomó, no se escribe nada.
    /// </summary>
    private async Task<DeletionOutcome> RunAsync(Guid deletionId, Guid token, AppLock held)
    {
        var ct = CancellationToken.None;
        var deletion = await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false);
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
                    await checkpoints.ReachedAsync(deletionId, step, ct).ConfigureAwait(false);
                    await EnsureOwnerAsync(deletionId, token, held).ConfigureAwait(false);
                    await participant.DeleteFeatureAsync(target, ct).ConfigureAwait(false);
                    steps.Add(new DeletionStepResult(step, "done", null));
                }
            }
            else
            {
                // Con el candado tomado no entra ninguna escritura; esto cubre las features que alguien creó justo
                // antes de la marca (ya guardadas al tomar el candado).
                var now = clock.GetUtcNowForDb();
                await db.Features.IgnoreQueryFilters().Where(f => f.AppId == deletion.AppId && f.DeletingAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletingAt, now), ct).ConfigureAwait(false);
                var featureIds = await db.Features.IgnoreQueryFilters().AsNoTracking().Where(f => f.AppId == deletion.AppId)
                    .Select(f => f.Id).ToListAsync(ct).ConfigureAwait(false);
                var target = new AppDeletionTarget(deletion.AppId, featureIds);
                foreach (var participant in Ordered)
                {
                    step = participant.Step;
                    await checkpoints.ReachedAsync(deletionId, step, ct).ConfigureAwait(false);
                    await EnsureOwnerAsync(deletionId, token, held).ConfigureAwait(false);
                    await participant.DeleteAppAsync(target, ct).ConfigureAwait(false);
                    steps.Add(new DeletionStepResult(step, "done", null));
                }
            }

            step = AppsStep;
            await checkpoints.ReachedAsync(deletionId, step, ct).ConfigureAwait(false);
            await EnsureOwnerAsync(deletionId, token, held).ConfigureAwait(false);
            steps.Add(new DeletionStepResult(step, "done", null));
            var completedAt = clock.GetUtcNowForDb();
            var stepsJson = JsonSerializer.Serialize(steps, Json);
            await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
            {
                // La ficha primero: la fila queda bloqueada hasta el commit y nadie más la cierra.
                var closed = await db.Deletions.Where(d => d.Id == deletionId && d.OwnerToken == token && d.Status == Deletion.Pending)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(d => d.Status, Deletion.Completed)
                        .SetProperty(d => d.CompletedAt, completedAt)
                        .SetProperty(d => d.OwnerToken, (Guid?)null)
                        .SetProperty(d => d.RetryAt, (DateTimeOffset?)null)
                        .SetProperty(d => d.Error, (string?)null)
                        .SetProperty(d => d.Steps, stepsJson), ct).ConfigureAwait(false);
                if (closed == 0)
                {
                    throw new DeletionSupersededException();
                }

                if (deletion.Kind == Deletion.FeatureKind)
                {
                    await db.Features.IgnoreQueryFilters().Where(f => f.Id == deletion.FeatureId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
                }
                else
                {
                    await db.Memberships.Where(m => m.AppId == deletion.AppId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
                    await db.CatalogItems.Where(i => i.AppId == deletion.AppId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
                    await db.Features.IgnoreQueryFilters().Where(f => f.AppId == deletion.AppId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
                    await db.Apps.Where(a => a.Id == deletion.AppId).ExecuteDeleteAsync(ct).ConfigureAwait(false);
                }

                await checkpoints.ReachedAsync(deletionId, CommitStep, ct).ConfigureAwait(false);
                await tx.CommitAsync(ct).ConfigureAwait(false);
            }

            LogCompleted(logger, deletionId, deletion.Kind, deletion.AppId);
        }
        catch (DeletionSupersededException)
        {
            // Otra ejecución tiene la eliminación: esta no escribe nada más.
            LogSuperseded(logger, deletionId, step);
            return Outcome(await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false));
        }
        catch (DeletionAbandonedException)
        {
            // Solo en pruebas: simula que el proceso murió aquí (sin escribir nada; el candado se suelta al cerrar).
            throw;
        }
#pragma warning disable CA1031 // Un fallo en cualquier módulo se registra y queda para reintentar; nunca se pierde.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            var message = Truncate(ex.Message, 500);
            steps.Add(new DeletionStepResult(step, "failed", message));
            var error = string.Create(CultureInfo.InvariantCulture, $"{step}: {message}");
            var retryAt = clock.GetUtcNowForDb() + RetryAfter;
            var stepsJson = JsonSerializer.Serialize(steps, Json);
            await db.Deletions.Where(d => d.Id == deletionId && d.OwnerToken == token && d.Status == Deletion.Pending)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(d => d.Error, error)
                    .SetProperty(d => d.RetryAt, retryAt)
                    .SetProperty(d => d.OwnerToken, (Guid?)null)
                    .SetProperty(d => d.Steps, stepsJson), ct).ConfigureAwait(false);
            LogIncomplete(logger, ex, deletionId, step);
        }

        return Outcome(await db.Deletions.AsNoTracking().SingleAsync(d => d.Id == deletionId, ct).ConfigureAwait(false));
    }

    /// <summary>Punto de prueba con el candado exclusivo ya tomado, antes de revisar el impacto y marcar.</summary>
    public const string LockedStep = "locked";

    /// <summary>Punto de prueba dentro de la transacción final, después de borrar las filas de Apps y antes del commit.</summary>
    public const string CommitStep = "apps:commit";

    /// <summary>¿Seguimos siendo la ejecución de esta eliminación? El candado vivo y la ficha nuestra; si no, se detiene.</summary>
    private async Task EnsureOwnerAsync(Guid deletionId, Guid token, AppLock held)
    {
        if (!await held.HeldAsync().ConfigureAwait(false)
            || !await db.Deletions.AnyAsync(d => d.Id == deletionId && d.OwnerToken == token).ConfigureAwait(false))
        {
            throw new DeletionSupersededException();
        }
    }

    /// <summary>Las eliminaciones pendientes que ya se pueden retomar (la concesión venció).</summary>
    public async Task<IReadOnlyList<Guid>> ResumableAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNowForDb();
        return await db.Deletions.AsNoTracking()
            .Where(d => d.Status == Deletion.Pending && (d.RetryAt == null || d.RetryAt < now))
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

    [LoggerMessage(Level = LogLevel.Warning, Message = "Eliminación {DeletionId}: otra ejecución la tomó en el paso {Step}; esta se detiene sin escribir.")]
    private static partial void LogSuperseded(ILogger logger, Guid deletionId, string step);

    [LoggerMessage(Level = LogLevel.Error, Message = "Eliminación {DeletionId} incompleta en el paso {Step}: queda pending y se reintentará.")]
    private static partial void LogIncomplete(ILogger logger, Exception exception, Guid deletionId, string step);
}

/// <summary>Sin puntos de prueba (producción).</summary>
internal sealed class NoDeletionCheckpoints : IDeletionCheckpoints
{
    public Task ReachedAsync(Guid deletionId, string step, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>Sin puntos de prueba en las escrituras (producción).</summary>
internal sealed class NoAppWriteCheckpoints : IAppWriteCheckpoints
{
    public Task EnteredAsync(Guid appId, string route, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task LeavingAsync(Guid appId, string route, CancellationToken cancellationToken) => Task.CompletedTask;
}
