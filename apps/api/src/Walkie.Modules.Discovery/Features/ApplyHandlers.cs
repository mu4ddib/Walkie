using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using Walkie.Shared.Time;

namespace Walkie.Modules.Discovery.Features;

internal abstract record ApplyOutcome
{
    public sealed record Done(DiscoveryApplyResult Result) : ApplyOutcome;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : ApplyOutcome;

    public sealed record Conflict(Dictionary<string, string[]> Errors) : ApplyOutcome;

    public sealed record NotFound : ApplyOutcome;
}

/// <summary>
/// Operaciones de revisión sobre un análisis (<c>POST /api/snapshots/{id}/apply</c>, <c>walkie-discovery-apply</c>;
/// spec walkie-live, tarea 4; ADR-0012). En esta tarea: <c>reject</c>, <c>link</c> y <c>reset</c>; <c>create</c> llega en la
/// tarea 6. Solo escriben vínculos de Discovery: nunca cambian el elemento vinculado ni ningún lienzo, módulo o feature.
/// <list type="bullet">
/// <item><b>Validación primero, sin escribir</b>: schema, claves repetidas, hallazgo en el análisis, destino de la misma
/// app y de un tipo compatible, destino no tomado por otro hallazgo, <c>bindingVersion</c>.</item>
/// <item><b>Una transacción</b>: los vínculos y la entrada de la bitácora (<c>discovery.applies</c>) se guardan juntos.</item>
/// <item><b>Idempotencia</b>: el mismo <c>applyId</c> con la misma solicitud devuelve el resultado guardado; con otra, 409.</item>
/// <item><b>Concurrencia</b>: <c>bindingVersion</c> (0 = sin vínculo) contra la versión actual; dos escrituras a la vez del
/// mismo vínculo chocan por la versión (concurrency token) o por la clave primaria, y la segunda recibe 409.</item>
/// <item>Solo sobre el último análisis de la fuente: decidir sobre uno viejo guardaría un fingerprint que ya no es el actual.</item>
/// </list>
/// </summary>
internal sealed class ApplyHandlers(DiscoveryDbContext db, ReviewHandlers review, TimeProvider clock)
{
    private static readonly JsonSerializerOptions ResultJson = new(JsonSerializerDefaults.Web);

    public async Task<ApplyOutcome> ApplyAsync(Guid snapshotId, JsonElement body, bool dryRun, string userId, CancellationToken ct)
    {
        var snapshot = await db.Snapshots.AsNoTracking().FirstOrDefaultAsync(s => s.Id == snapshotId, ct).ConfigureAwait(false);
        if (snapshot is null)
        {
            return new ApplyOutcome.NotFound();
        }

        var schemaErrors = WalkieSchemas.Errors(WalkieSchemas.DiscoveryApply, body);
        if (schemaErrors.Count > 0)
        {
            return new ApplyOutcome.Invalid(schemaErrors);
        }

        var applyId = body.GetProperty("applyId").GetGuid();
        var operations = body.GetProperty("operations").EnumerateArray().Select(Operation.Read).ToList();
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(DiscoveryFingerprint.Canonical(body, null))));

        if (!dryRun && await ReplayAsync(applyId, snapshotId, requestHash, ct).ConfigureAwait(false) is { } replay)
        {
            return replay;
        }

        var latest = await db.Snapshots.AsNoTracking()
            .Where(s => s.AppId == snapshot.AppId && s.SourceId == snapshot.SourceId)
            .OrderByDescending(s => s.ImportedAt).ThenByDescending(s => s.Id)
            .Select(s => s.Id).FirstAsync(ct).ConfigureAwait(false);
        if (latest != snapshotId)
        {
            return new ApplyOutcome.Conflict(new Dictionary<string, string[]>
            {
                ["snapshotId"] = [$"Hay un análisis más nuevo de esta fuente ({latest}): decide sobre ese."],
            });
        }

        var keys = operations.Select(o => o.EntityKey).Distinct(StringComparer.Ordinal).ToList();
        var entities = await db.Entities.AsNoTracking()
            .Where(e => e.SnapshotId == snapshotId && keys.Contains(e.Key))
            .Select(e => new { e.Key, e.Kind, e.Fingerprint })
            .ToDictionaryAsync(e => e.Key, StringComparer.Ordinal, ct).ConfigureAwait(false);
        var bindings = await db.Bindings
            .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && keys.Contains(b.EntityKey))
            .ToDictionaryAsync(b => b.EntityKey, StringComparer.Ordinal, ct).ConfigureAwait(false);

        var linkTargets = operations.Where(o => o.Target is not null).Select(o => o.Target!.Id).Distinct().ToList();
        var targets = linkTargets.Count == 0
            ? new Dictionary<(string TargetKind, Guid Id), ExistingTarget>()
            : (await review.ExistingTargetsAsync(snapshot.AppId, ct).ConfigureAwait(false)).ToDictionary(t => (t.TargetKind, t.Id));
        var takenBy = await db.Bindings.AsNoTracking()
            .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && b.Decision != null
                && b.TargetId != null && linkTargets.Contains(b.TargetId.Value))
            .Select(b => new { b.TargetKind, b.TargetId, b.EntityKey })
            .ToListAsync(ct).ConfigureAwait(false);

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var conflicts = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < operations.Count; i++)
        {
            var op = operations[i];
            var path = string.Create(CultureInfo.InvariantCulture, $"/operations/{i}");
            if (!seen.Add(op.EntityKey))
            {
                errors[$"{path}/entityKey"] = ["Hay otra operación sobre el mismo hallazgo en esta solicitud."];
                continue;
            }

            if (op.Op == "create")
            {
                errors[$"{path}/op"] = ["Crear elementos todavía no está disponible (spec walkie-live, tarea 6): usa link, reject o reset."];
                continue;
            }

            var entity = entities.GetValueOrDefault(op.EntityKey);
            if (entity is null && op.Op != "reset")
            {
                errors[$"{path}/entityKey"] = ["No está en este análisis."];
                continue;
            }

            var binding = bindings.GetValueOrDefault(op.EntityKey);
            var version = binding?.Active == true ? binding.Version : 0;
            if (op.BindingVersion is { } expected && expected != version)
            {
                conflicts[$"{path}/bindingVersion"] = [string.Create(CultureInfo.InvariantCulture,
                    $"Se esperaba la versión {expected} y el vínculo está en la {version}: vuelve a pedir la revisión.")];
                continue;
            }

            switch (op.Op)
            {
                case "reset" when binding?.Active != true:
                    errors[$"{path}/entityKey"] = ["No hay una decisión que restablecer."];
                    break;
                case "link":
                    var expectedKind = MatchIndex.TargetKindFor(entity!.Kind);
                    var expectedType = MatchIndex.TargetType(entity.Kind);
                    if (expectedKind is null)
                    {
                        errors[$"{path}/entityKey"] = ["Una pantalla no se vincula sola: entra con su feature."];
                    }
                    else if (op.Target!.Kind != expectedKind)
                    {
                        errors[$"{path}/target/kind"] = [$"Un hallazgo {entity.Kind} se vincula a un {expectedKind}, no a un {op.Target.Kind}."];
                    }
                    else if (!targets.TryGetValue((op.Target.Kind, op.Target.Id), out var target))
                    {
                        errors[$"{path}/target/id"] = ["No existe en esta app."];
                    }
                    else if (target.Type != expectedType)
                    {
                        errors[$"{path}/target/id"] = [$"Es un {target.Type} del catálogo; el hallazgo es un {entity.Kind}."];
                    }
                    else if (takenBy.FirstOrDefault(b => b.TargetKind == target.TargetKind && b.TargetId == target.Id && b.EntityKey != op.EntityKey) is { } other)
                    {
                        conflicts[$"{path}/target/id"] = [$"Ya está vinculado a otro hallazgo de esta fuente ({other.EntityKey}): restablece ese primero."];
                    }

                    break;
            }
        }

        if (errors.Count > 0)
        {
            return new ApplyOutcome.Invalid(errors);
        }

        if (conflicts.Count > 0)
        {
            return new ApplyOutcome.Conflict(conflicts);
        }

        var result = Result(applyId, dryRun, operations, bindings, targets);
        if (dryRun)
        {
            return new ApplyOutcome.Done(result);
        }

        var now = clock.GetUtcNowForDb();
        foreach (var op in operations)
        {
            var binding = bindings.GetValueOrDefault(op.EntityKey);
            if (binding is null)
            {
                binding = new Binding { AppId = snapshot.AppId, SourceId = snapshot.SourceId, EntityKey = op.EntityKey, DecidedBy = userId, Version = 0 };
                db.Bindings.Add(binding);
            }

            var target = op.Op == "link" ? targets[(op.Target!.Kind, op.Target.Id)] : null;
            binding.Decision = op.Op switch { "reject" => "rejected", "link" => "linked", _ => null };
            binding.TargetKind = target?.TargetKind;
            binding.TargetId = target?.Id;
            binding.TargetTitle = target is null ? null : Truncate(target.Title, 120);
            binding.EntityFingerprint = op.Op == "reset" ? null : entities[op.EntityKey].Fingerprint;
            binding.SnapshotId = op.Op == "reset" ? null : snapshotId;
            binding.ApplyId = applyId;
            binding.Note = op.Note;
            binding.DecidedBy = userId;
            binding.DecidedAt = now;
            binding.Version++;
        }

        db.Applies.Add(new ApplyRecord
        {
            ApplyId = applyId,
            AppId = snapshot.AppId,
            SnapshotId = snapshotId,
            RequestHash = requestHash,
            Status = "completed",
            Result = JsonSerializer.Serialize(result, ResultJson),
            CreatedBy = userId,
            CreatedAt = now,
        });

        try
        {
            // Un solo SaveChanges: vínculos y bitácora en una transacción.
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            return new ApplyOutcome.Done(result);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Concurrent();
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Otra solicitud con el mismo applyId, o que creó el mismo vínculo, terminó antes.
            db.ChangeTracker.Clear();
            return await ReplayAsync(applyId, snapshotId, requestHash, ct).ConfigureAwait(false) ?? Concurrent();
        }
    }

    /// <summary>El resultado guardado si este <c>applyId</c> ya se aplicó con esta misma solicitud; 409 si con otra; null si es nuevo.</summary>
    private async Task<ApplyOutcome?> ReplayAsync(Guid applyId, Guid snapshotId, string requestHash, CancellationToken ct)
    {
        var record = await db.Applies.AsNoTracking().FirstOrDefaultAsync(a => a.ApplyId == applyId, ct).ConfigureAwait(false);
        if (record is null)
        {
            return null;
        }

        return record.SnapshotId == snapshotId && record.RequestHash == requestHash
            ? new ApplyOutcome.Done(JsonSerializer.Deserialize<DiscoveryApplyResult>(record.Result, ResultJson)!)
            : new ApplyOutcome.Conflict(new Dictionary<string, string[]>
            {
                ["applyId"] = ["Este applyId ya se usó con otra solicitud: genera uno nuevo para cada aplicación."],
            });
    }

    private static ApplyOutcome.Conflict Concurrent() => new(new Dictionary<string, string[]>
    {
        ["operations"] = ["Otra operación cambió estos vínculos al mismo tiempo: vuelve a pedir la revisión y decide otra vez."],
    });

    private static DiscoveryApplyResult Result(Guid applyId, bool dryRun, List<Operation> operations, Dictionary<string, Binding> bindings,
        Dictionary<(string, Guid), ExistingTarget> targets)
    {
        var linked = operations.Where(o => o.Op == "link")
            .Select(o => new DiscoveryAppliedTarget(o.EntityKey, targets[(o.Target!.Kind, o.Target.Id)].Reference)).ToList();
        var reset = operations.Where(o => o.Op == "reset").ToList();
        var resetTargets = reset
            .Select(o => bindings[o.EntityKey])
            .Where(b => b.TargetId is not null)
            .Select(b => new DiscoveryTarget(b.TargetKind!, b.TargetId!.Value, b.TargetTitle))
            .ToList();
        var warnings = reset
            .Where(o => bindings[o.EntityKey].Decision is "linked" or "created")
            .Select(o => new DiscoveryApplyWarning("target-kept", "El elemento al que estaba vinculado sigue en Walkie sin cambios: restablecer solo quita la decisión.", o.EntityKey))
            .ToList();
        return new DiscoveryApplyResult(
            applyId,
            dryRun,
            dryRun ? "planned" : "completed",
            [],
            linked,
            [.. operations.Where(o => o.Op == "reject").Select(o => o.EntityKey)],
            [.. reset.Select(o => o.EntityKey)],
            [.. linked.Select(l => l.Target).Concat(resetTargets).DistinctBy(t => (t.Kind, t.Id))],
            warnings);
    }

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];

    private sealed record Operation(string Op, string EntityKey, DiscoveryTarget? Target, int? BindingVersion, string? Note)
    {
        public static Operation Read(JsonElement op) => new(
            op.GetProperty("op").GetString()!,
            op.GetProperty("entityKey").GetString()!,
            op.TryGetProperty("target", out var target)
                ? new DiscoveryTarget(target.GetProperty("kind").GetString()!, target.GetProperty("id").GetGuid())
                : null,
            op.TryGetProperty("bindingVersion", out var version) ? version.GetInt32() : null,
            op.TryGetProperty("note", out var note) ? note.GetString() : null);
    }
}
