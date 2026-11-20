using System.Buffers.Binary;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Puntos de una aplicación con creaciones (tarea 6) en los que una prueba puede simular un fallo o una caída:
/// <c>pending</c> (bitácora registrada), <c>created:{índice}</c> (después de crear ese paso), <c>finalize</c> (antes de la
/// transacción que guarda vínculos y marca <c>completed</c>). En producción no hace nada.
/// </summary>
internal interface IApplyCheckpoints
{
    Task ReachedAsync(string checkpoint, Guid applyId);
}

internal sealed class NoApplyCheckpoints : IApplyCheckpoints
{
    public Task ReachedAsync(string checkpoint, Guid applyId) => Task.CompletedTask;
}

/// <summary>
/// La aplicación se abandona en este punto sin compensar ni seguir, como si el proceso se hubiera caído (lo lanza un
/// <see cref="IApplyCheckpoints"/> de prueba). Cualquier otra excepción es un fallo y se compensa.
/// </summary>
/// <summary>
/// El lienzo de una feature cambió entre la vista previa (o el plan) y el momento de agregarle una pantalla (ADR-0018):
/// no se agregó nada; la aplicación se compensa y responde 409 para pedir una vista previa nueva.
/// </summary>
internal sealed class CanvasChangedException : Exception
{
    public CanvasChangedException()
    {
    }

    public CanvasChangedException(string entityKey)
        : base($"El lienzo cambió antes de incorporar {entityKey}.")
    {
    }

    public CanvasChangedException(string message, Exception inner)
        : base(message, inner)
    {
    }
}

internal sealed class ApplyAbandonedException : Exception
{
    public ApplyAbandonedException()
    {
    }

    public ApplyAbandonedException(string message)
        : base(message)
    {
    }

    public ApplyAbandonedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>
/// Candado de sesión de Postgres (<c>pg_try_advisory_lock</c>) sobre un <c>applyId</c>: solo una ejecución de esa
/// aplicación a la vez (doble clic, reintento mientras la primera sigue). Si el proceso muere, Postgres lo suelta con la
/// conexión, así un reintento puede retomar lo que quedó <c>pending</c> sin esperar un plazo.
/// </summary>
internal sealed class ApplyLock : IAsyncDisposable
{
    private readonly DiscoveryDbContext db;
    private readonly long key;

    private ApplyLock(DiscoveryDbContext db, long key)
    {
        this.db = db;
        this.key = key;
    }

    /// <summary>El candado, o null si otra ejecución de esa aplicación lo tiene ahora.</summary>
    public static async Task<ApplyLock?> TryAcquireAsync(DiscoveryDbContext db, Guid applyId, CancellationToken ct)
    {
        // La conexión queda abierta mientras dure el candado (EF cuenta las aperturas: anidar candados no la cierra antes).
        await db.Database.OpenConnectionAsync(ct).ConfigureAwait(false);
        var key = Key(applyId);
        var acquired = await db.Database.SqlQuery<bool>($"SELECT pg_try_advisory_lock({key}) AS \"Value\"")
            .SingleAsync(ct).ConfigureAwait(false);
        if (acquired)
        {
            return new ApplyLock(db, key);
        }

        await db.Database.CloseConnectionAsync().ConfigureAwait(false);
        return null;
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await db.Database.SqlQuery<bool>($"SELECT pg_advisory_unlock({key}) AS \"Value\"").SingleAsync().ConfigureAwait(false);
        }
        finally
        {
            await db.Database.CloseConnectionAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Los 8 bytes aleatorios del UUID v7 (los primeros son la hora, iguales para ids cercanos).</summary>
    private static long Key(Guid applyId)
    {
        Span<byte> bytes = stackalloc byte[16];
        applyId.TryWriteBytes(bytes, bigEndian: true, out _);
        return BinaryPrimitives.ReadInt64BigEndian(bytes[8..]);
    }
}
