using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Time;

namespace Walkie.Modules.Discovery.Features;

internal abstract record SourceImportResult
{
    public sealed record Done(DiscoverySourceImportResponse Response) : SourceImportResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : SourceImportResult;

    public sealed record Conflict(Dictionary<string, string[]> Errors) : SourceImportResult;

    /// <summary>No se pudo terminar ni deshacer sin riesgo: quedó pendiente y un reintento la termina (500).</summary>
    public sealed record Unfinished(string Message) : SourceImportResult;
}

/// <summary>Puntos de prueba de crear una app desde un proyecto local (en producción no hace nada).</summary>
internal interface ISourceImportCheckpoints
{
    Task ReachedAsync(string checkpoint, Guid importId);
}

internal sealed class NoSourceImportCheckpoints : ISourceImportCheckpoints
{
    public Task ReachedAsync(string checkpoint, Guid importId) => Task.CompletedTask;
}

/// <summary>
/// Crear una app nueva desde un proyecto local (<c>POST /api/sources/import</c>, spec walkie-live tarea 10). Valida el
/// paquete con lo mismo que la subida a una app existente (<see cref="SnapshotHandlers.Read"/>: zip seguro, versiones,
/// migración, contrato y límites) y el nombre, sin escribir nada. Con <c>dryRun</c> responde la vista previa.
/// <para>
/// <b>Sin transacción entre Apps y Discovery</b>, la operación es recuperable con una bitácora (<see cref="SourceImport"/>):
/// <list type="number">
/// <item>un candado de sesión de Postgres por <c>importId</c> (dos pedidos con el mismo id no corren a la vez);</item>
/// <item><c>pending</c>, con el id de la app ya elegido por la API (una sola pendiente por fuente);</item>
/// <item>la app, con ese id (<see cref="IAppWriter.CreateAppAsync(Guid, string, string, DateTimeOffset, CancellationToken)"/>,
/// idempotente y sin atribuirse una app ajena);</item>
/// <item>el primer análisis y <c>completed</c>, en una sola transacción de Discovery.</item>
/// </list>
/// Un reintento con el mismo <c>importId</c> y el mismo paquete y nombre sigue donde quedó o devuelve lo ya hecho. Si
/// falla, se borra la app solo si nadie la tocó (<see cref="IAppWriter.DeleteUntouchedAppAsync"/> y sin análisis ni
/// decisiones de otra operación) y queda <c>compensated</c>; si no se puede sin riesgo, queda <c>pending</c>.
/// </para>
/// </summary>
internal sealed partial class SourceImportHandlers(
    DiscoveryDbContext db,
    SnapshotHandlers snapshots,
    IAppWriter apps,
    ISourceImportCheckpoints checkpoints,
    TimeProvider clock,
    ILogger<SourceImportHandlers> logger)
{
    public const int AppNameMaxLength = 120;

    public async Task<SourceImportResult> ImportAsync(byte[] file, string? name, Guid? importId, bool dryRun, string userId, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var package = SnapshotHandlers.Read(file, errors);
        if (package is null)
        {
            return new SourceImportResult.Invalid(errors);
        }

        var (manifest, discovery, formatVersion) = package.Value;
        var packSha256 = Convert.ToHexStringLower(SHA256.HashData(file));
        var contentFingerprint = DiscoveryFingerprint.Content(discovery);
        var sourceId = Guid.Parse(manifest.GetProperty("source").GetProperty("id").GetString()!);
        var sourceName = manifest.GetProperty("source").GetProperty("name").GetString()!;
        var summary = SnapshotHandlers.Summary(null, sourceId, sourceName, false, formatVersion, manifest, discovery, packSha256, contentFingerprint);

        var names = (await apps.AppNamesAsync(ct).ConfigureAwait(false)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var chosen = name?.Trim();
        if (name is not null && (chosen!.Length == 0 || chosen.Length > AppNameMaxLength))
        {
            return new SourceImportResult.Invalid(new() { ["name"] = [$"El nombre es obligatorio y tiene hasta {AppNameMaxLength} caracteres."] });
        }

        var appName = chosen ?? UniqueName(sourceName, names);
        var warnings = await WarningsAsync(sourceId, ct).ConfigureAwait(false);
        if (dryRun)
        {
            return new SourceImportResult.Done(new DiscoverySourceImportResponse(
                importId, true, "preview", new DiscoveryNewApp(null, appName, names.Contains(appName)), null, summary, warnings));
        }

        if (importId is not { } id || id.Version != 7)
        {
            return new SourceImportResult.Invalid(new() { ["importId"] = ["Falta importId: un UUID v7 del cliente para esta creación (un reintento manda el mismo)."] });
        }

        if (chosen is null)
        {
            return new SourceImportResult.Invalid(new() { ["name"] = ["Confirma el nombre de la app (la vista previa propone uno)."] });
        }

        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(packSha256 + "\n" + chosen)));
        await using var importLock = await ApplyLock.TryAcquireAsync(db, id, ct).ConfigureAwait(false);
        if (importLock is null)
        {
            return Conflict("importId", "Esta creación se está ejecutando ahora: espera y vuelve a intentarlo con el mismo importId.");
        }

        var record = await db.SourceImports.FirstOrDefaultAsync(i => i.ImportId == id, ct).ConfigureAwait(false);
        if (record is not null)
        {
            if (record.RequestHash != requestHash)
            {
                return Conflict("importId", "Este importId ya se usó con otro paquete u otro nombre: genera uno nuevo para cada creación.");
            }

            return record.Status switch
            {
                // Ya terminada (un reintento tras un timeout): la misma respuesta, sin crear nada.
                SourceImport.Completed => await DoneAsync(record, summary, warnings, ct, "existing").ConfigureAwait(false),
                SourceImport.Compensated => Conflict("importId", "Esta creación no se pudo terminar y se deshizo: vuelve a intentarlo (es otra creación)."),
                SourceImport.Abandoned => Conflict("importId",
                    $"Esta creación quedó abandonada: la app «{record.AppName}» ya tenía cambios y se conservó tal cual, sin el análisis. Para sumarlo, ábrela y usa «Importar proyecto local»."),
                _ => await RunAsync(record, manifest, discovery, formatVersion, contentFingerprint, summary, warnings).ConfigureAwait(false),
            };
        }

        if (names.Contains(chosen))
        {
            return Conflict("name", "Ya hay una app con ese nombre: elige otro.");
        }

        // Una creación sin terminar desde esta misma fuente (de otro importId): se termina o se deshace antes de seguir.
        var stale = await db.SourceImports.FirstOrDefaultAsync(i => i.SourceId == sourceId && i.Status == SourceImport.Pending, ct).ConfigureAwait(false);
        if (stale is not null && !await TryRecoverAsync(stale.ImportId).ConfigureAwait(false))
        {
            return Conflict("source", "Otra creación de una app desde esta misma fuente está en curso (o no se pudo resolver todavía): espera un momento y vuelve a intentarlo.");
        }

        var now = clock.GetUtcNowForDb();
        record = new SourceImport
        {
            ImportId = id,
            SourceId = sourceId,
            AppId = Guid.CreateVersion7(),
            AppName = chosen,
            PackSha256 = packSha256,
            RequestHash = requestHash,
            Status = SourceImport.Pending,
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.SourceImports.Add(record);
        try
        {
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return Conflict("source", "Otra creación de una app desde esta misma fuente empezó al mismo tiempo: espera a que termine.");
        }

        await checkpoints.ReachedAsync("pending", id).ConfigureAwait(false);
        return await RunAsync(record, manifest, discovery, formatVersion, contentFingerprint, summary, warnings).ConfigureAwait(false);
    }

    /// <summary>
    /// Ejecuta (o retoma) una creación pendiente: la app (idempotente) y, en una sola transacción, el primer análisis y
    /// <c>completed</c>. Quien llama tiene su candado. No usa el token de la solicitud: si el cliente se va, termina igual.
    /// </summary>
    private async Task<SourceImportResult> RunAsync(
        SourceImport record, JsonElement manifest, JsonElement discovery, int formatVersion, string contentFingerprint,
        DiscoveryUploadSummary summary, IReadOnlyList<DiscoveryApplyWarning> warnings)
    {
        try
        {
            var created = await apps.CreateAppAsync(record.AppId, record.AppName, record.CreatedBy, record.CreatedAt, CancellationToken.None)
                .ConfigureAwait(false);
            if (created == AppCreation.IdTaken)
            {
                throw new InvalidOperationException($"El id {record.AppId} ya es de otra app.");
            }

            await checkpoints.ReachedAsync("app", record.ImportId).ConfigureAwait(false);
            var sourceName = manifest.GetProperty("source").GetProperty("name").GetString()!;
            await snapshots.SaveAsync(
                record.AppId, record.SourceId, sourceName, formatVersion, manifest, discovery, record.PackSha256, contentFingerprint,
                record.CreatedBy, CancellationToken.None,
                snapshot =>
                {
                    // El análisis y la bitácora en la misma transacción: nunca hay un análisis sin su creación terminada.
                    record.Status = SourceImport.Completed;
                    record.SnapshotId = snapshot.Id;
                    record.Error = null;
                    record.UpdatedAt = clock.GetUtcNowForDb();
                }).ConfigureAwait(false);
            return await DoneAsync(record, summary, warnings, CancellationToken.None).ConfigureAwait(false);
        }
        catch (ImportAbandonedException)
        {
            throw; // una caída simulada: ni se compensa ni se sigue
        }
#pragma warning disable CA1031 // cualquier fallo al escribir se compensa o queda pendiente; la excepción queda en el log
        catch (Exception ex)
#pragma warning restore CA1031
        {
            LogImportFailed(logger, ex, record.ImportId);
            db.ChangeTracker.Clear();
            return await CompensateAsync(record.ImportId, ex.Message).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Deshace una creación que falló: borra la app solo si nadie la tocó (mismo nombre, sin features, módulos, catálogo,
    /// análisis ni decisiones). Si no se puede sin riesgo, la deja <c>pending</c> con el error: un reintento la termina.
    /// </summary>
    private async Task<SourceImportResult> CompensateAsync(Guid importId, string error, bool abandonIfEdited = false)
    {
        try
        {
            var record = await db.SourceImports.FirstAsync(i => i.ImportId == importId).ConfigureAwait(false);
            record.Error = Truncate(error, 1000);
            record.UpdatedAt = clock.GetUtcNowForDb();
            var discoveryData = await db.Snapshots.AnyAsync(s => s.AppId == record.AppId).ConfigureAwait(false)
                || await db.Bindings.AnyAsync(b => b.AppId == record.AppId).ConfigureAwait(false);
            var removal = discoveryData
                ? AppRemoval.Edited
                : await apps.DeleteUntouchedAppAsync(record.AppId, record.AppName, CancellationToken.None).ConfigureAwait(false);
            if (removal == AppRemoval.Edited && abandonIfEdited)
            {
                // Nadie la va a terminar (su ejecución murió y otra creación de la fuente espera): se suelta sin borrar nada.
                record.Status = SourceImport.Abandoned;
                record.Error = Truncate("La app ya tenía cambios: se conservó sin el análisis. " + error, 1000);
                await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
                LogAbandoned(logger, importId, record.AppId);
                return new SourceImportResult.Unfinished("La creación anterior quedó abandonada sin borrar su app.");
            }

            if (removal == AppRemoval.Edited)
            {
                await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
                return new SourceImportResult.Unfinished(
                    "No se pudo terminar de crear la app y ya tiene cambios, así que no se borró: quedó pendiente. Reintenta con el mismo archivo para terminarla.");
            }

            record.Status = SourceImport.Compensated;
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            return new SourceImportResult.Unfinished("No se pudo crear la app: se deshizo y no quedó nada. Vuelve a intentarlo.");
        }
        catch (ImportAbandonedException)
        {
            throw;
        }
#pragma warning disable CA1031 // si tampoco se puede deshacer, queda pending: un reintento la retoma
        catch (Exception ex)
#pragma warning restore CA1031
        {
            LogCompensationFailed(logger, ex, importId);
            db.ChangeTracker.Clear();
            return new SourceImportResult.Unfinished("No se pudo crear la app ni deshacerla: quedó pendiente. Reintenta con el mismo archivo para terminarla.");
        }
    }

    /// <summary>
    /// Una creación pendiente de otro <c>importId</c> desde la misma fuente: si nadie la está ejecutando (su candado está
    /// libre), se deshace con las mismas reglas (su paquete no está aquí para terminarla). True si ya no bloquea.
    /// </summary>
    private async Task<bool> TryRecoverAsync(Guid otherImportId)
    {
        await using var otherLock = await ApplyLock.TryAcquireAsync(db, otherImportId, CancellationToken.None).ConfigureAwait(false);
        if (otherLock is null)
        {
            return false;
        }

        db.ChangeTracker.Clear();
        LogRecovering(logger, otherImportId);
        await CompensateAsync(otherImportId, "Se resolvió al empezar otra creación desde la misma fuente.", abandonIfEdited: true).ConfigureAwait(false);
        db.ChangeTracker.Clear();
        return !await db.SourceImports.AnyAsync(i => i.ImportId == otherImportId && i.Status == SourceImport.Pending).ConfigureAwait(false);
    }

    private async Task<SourceImportResult> DoneAsync(
        SourceImport record, DiscoveryUploadSummary summary, IReadOnlyList<DiscoveryApplyWarning> warnings, CancellationToken ct, string status = "created")
    {
        var snapshot = await db.Snapshots.AsNoTracking().FirstAsync(s => s.Id == record.SnapshotId, ct).ConfigureAwait(false);
        return new SourceImportResult.Done(new DiscoverySourceImportResponse(
            record.ImportId, false, status, new DiscoveryNewApp(record.AppId, record.AppName, false),
            SnapshotHandlers.Response(snapshot), summary with { AppId = record.AppId }, warnings));
    }

    /// <summary>Avisos de la vista previa: la fuente ya está en otras apps (se vincula a una nueva, no a esas).</summary>
    private async Task<IReadOnlyList<DiscoveryApplyWarning>> WarningsAsync(Guid sourceId, CancellationToken ct)
    {
        var others = await db.Sources.AsNoTracking().Where(s => s.Id == sourceId).Select(s => s.AppId).Distinct().CountAsync(ct).ConfigureAwait(false);
        var pending = await db.SourceImports.AsNoTracking().AnyAsync(i => i.SourceId == sourceId && i.Status == SourceImport.Pending, ct).ConfigureAwait(false);
        var warnings = new List<DiscoveryApplyWarning>();
        if (others > 0)
        {
            warnings.Add(new DiscoveryApplyWarning("source-in-other-apps", string.Create(CultureInfo.InvariantCulture,
                $"Este proyecto ya está en {others} app(s). Crear otra no las cambia ni comparte sus decisiones: si querías reanalizarlo, carga el paquete desde esa app.")));
        }

        if (pending)
        {
            warnings.Add(new DiscoveryApplyWarning("pending-import",
                "Hay una creación de app sin terminar desde este proyecto: al confirmar se deshace si nadie la está ejecutando."));
        }

        return warnings;
    }

    /// <summary>El nombre propuesto: el de la fuente, o con un número si ya hay una app que se llama así.</summary>
    internal static string UniqueName(string name, IReadOnlySet<string> taken)
    {
        name = Truncate(name.Trim().Length == 0 ? "Proyecto local" : name.Trim(), AppNameMaxLength);
        if (!taken.Contains(name))
        {
            return name;
        }

        for (var n = 2; ; n++)
        {
            var suffix = string.Create(CultureInfo.InvariantCulture, $" ({n})");
            var candidate = Truncate(name, AppNameMaxLength - suffix.Length).TrimEnd() + suffix;
            if (!taken.Contains(candidate))
            {
                return candidate;
            }
        }
    }

    private static SourceImportResult.Conflict Conflict(string path, string message) =>
        new(new Dictionary<string, string[]> { [path] = [message] });

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];

    [LoggerMessage(Level = LogLevel.Error, Message = "La creación de app {ImportId} falló a mitad de camino.")]
    private static partial void LogImportFailed(ILogger logger, Exception exception, Guid importId);

    [LoggerMessage(Level = LogLevel.Error, Message = "No se pudo deshacer la creación de app {ImportId}: queda pending.")]
    private static partial void LogCompensationFailed(ILogger logger, Exception exception, Guid importId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "La creación de app interrumpida {ImportId} quedó abandonada: la app {AppId} tenía cambios y se conservó.")]
    private static partial void LogAbandoned(ILogger logger, Guid importId, Guid appId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Se deshace la creación de app interrumpida {ImportId}.")]
    private static partial void LogRecovering(ILogger logger, Guid importId);
}

/// <summary>Una caída simulada en las pruebas: ni compensa ni sigue (como <c>ApplyAbandonedException</c>).</summary>
internal sealed class ImportAbandonedException : Exception
{
    public ImportAbandonedException()
    {
    }

    public ImportAbandonedException(string message)
        : base(message)
    {
    }

    public ImportAbandonedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
