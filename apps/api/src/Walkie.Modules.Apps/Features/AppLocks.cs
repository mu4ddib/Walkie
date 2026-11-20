using System.Buffers.Binary;
using Npgsql;
using NpgsqlTypes;

namespace Walkie.Modules.Apps.Features;

/// <summary>
/// Candado por app en PostgreSQL (ADR-0017), con una conexión propia que lo mantiene mientras dura:
/// <list type="bullet">
/// <item><b>Compartido</b>: toda solicitud que escribe en una app (filtro de <see cref="AppAuthorization"/>). Muchas a la vez.</item>
/// <item><b>Exclusivo</b>: una eliminación, desde que revisa el impacto y marca hasta que termina la limpieza. Espera a que
/// terminen las escrituras en curso y ninguna nueva empieza mientras lo tiene. Dos ejecuciones de la misma eliminación
/// (la solicitud, la recuperación, otra instancia) nunca lo tienen a la vez.</item>
/// </list>
/// Si el proceso o la conexión se caen, PostgreSQL lo suelta solo; la ficha de <see cref="Domain.Deletion.OwnerToken"/>
/// impide que un ejecutor que lo perdió siga escribiendo la bitácora.
/// </summary>
internal sealed class AppLocks(string connectionString)
{
    /// <summary>Espacio de las claves (<c>pg_advisory_lock(int, int)</c>): no choca con los candados de una sola clave de Discovery.</summary>
    public const int Space = 0x57414C4B; // "WALK"

    /// <summary>Cuánto espera una escritura o una eliminación antes de rendirse (409 «ocupada»).</summary>
    public static readonly TimeSpan WaitLimit = TimeSpan.FromSeconds(30);

    /// <summary>Nombre de la sesión que tiene el candado exclusivo de una eliminación (lo usan las pruebas para cortarla).</summary>
    public static string DeletionSession(Guid deletionId) => $"walkie-deletion:{deletionId}";

    public const string WriteSession = "walkie-app-write";

    public Task<AppLock?> SharedAsync(Guid appId, CancellationToken ct) => AcquireAsync(appId, shared: true, wait: true, WriteSession, ct);

    public Task<AppLock?> ExclusiveAsync(Guid appId, string session, CancellationToken ct) => AcquireAsync(appId, shared: false, wait: true, session, ct);

    public Task<AppLock?> TryExclusiveAsync(Guid appId, string session, CancellationToken ct) => AcquireAsync(appId, shared: false, wait: false, session, ct);

    /// <summary>Los 4 últimos bytes del UUID (aleatorios en v7). Dos apps con la misma clave solo se esperan entre sí.</summary>
    public static int Key(Guid appId)
    {
        Span<byte> bytes = stackalloc byte[16];
        appId.TryWriteBytes(bytes, bigEndian: true, out _);
        return BinaryPrimitives.ReadInt32BigEndian(bytes[12..]);
    }

    private async Task<AppLock?> AcquireAsync(Guid appId, bool shared, bool wait, string session, CancellationToken ct)
    {
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(ct).ConfigureAwait(false);
            await using (var setup = new NpgsqlCommand("SELECT set_config('application_name', @session, false), set_config('lock_timeout', @timeout, false)", connection))
            {
                setup.Parameters.AddWithValue("session", session);
                setup.Parameters.AddWithValue("timeout", $"{(int)WaitLimit.TotalMilliseconds}ms");
                await setup.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            var function = (shared, wait) switch
            {
                (true, true) => "pg_advisory_lock_shared",
                (true, false) => "pg_try_advisory_lock_shared",
                (false, true) => "pg_advisory_lock",
                (false, false) => "pg_try_advisory_lock",
            };
            await using var command = new NpgsqlCommand($"SELECT {function}(@space, @key)::text", connection);
            command.Parameters.Add(new NpgsqlParameter("space", NpgsqlDbType.Integer) { Value = Space });
            command.Parameters.Add(new NpgsqlParameter("key", NpgsqlDbType.Integer) { Value = Key(appId) });
            try
            {
                var result = (string?)await command.ExecuteScalarAsync(ct).ConfigureAwait(false);
                if (!wait && result != "true")
                {
                    await connection.DisposeAsync().ConfigureAwait(false);
                    return null;
                }
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.LockNotAvailable)
            {
                await connection.DisposeAsync().ConfigureAwait(false);
                return null;
            }

            return new AppLock(connection, shared, Key(appId));
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }
}

/// <summary>Un candado tomado; soltarlo devuelve la conexión al pool sin el candado ni el nombre de sesión.</summary>
internal sealed class AppLock(NpgsqlConnection connection, bool shared, int key) : IAsyncDisposable
{
    /// <summary>¿Sigue viva la conexión que lo mantiene? Si se cortó, el candado ya no es nuestro.</summary>
    public async Task<bool> HeldAsync()
    {
        try
        {
            await using var command = new NpgsqlCommand(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND classid = @space::oid AND objid = @key::oid AND objsubid = 2 AND granted",
                connection);
            command.Parameters.Add(new NpgsqlParameter("space", NpgsqlDbType.Bigint) { Value = (long)(uint)AppLocks.Space });
            command.Parameters.Add(new NpgsqlParameter("key", NpgsqlDbType.Bigint) { Value = (long)(uint)key });
            return (long)(await command.ExecuteScalarAsync().ConfigureAwait(false))! > 0;
        }
        catch (NpgsqlException)
        {
            return false;
        }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (connection.FullState == System.Data.ConnectionState.Open)
            {
                await using var command = new NpgsqlCommand(
                    $"SELECT {(shared ? "pg_advisory_unlock_shared" : "pg_advisory_unlock")}(@space, @key); RESET application_name; RESET lock_timeout;", connection);
                command.Parameters.Add(new NpgsqlParameter("space", NpgsqlDbType.Integer) { Value = AppLocks.Space });
                command.Parameters.Add(new NpgsqlParameter("key", NpgsqlDbType.Integer) { Value = key });
                await command.ExecuteNonQueryAsync().ConfigureAwait(false);
            }
        }
        catch (NpgsqlException)
        {
            // La conexión se cortó: PostgreSQL ya soltó el candado. El pool descarta la conexión rota.
        }
        finally
        {
            await connection.DisposeAsync().ConfigureAwait(false);
        }
    }
}
