using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Walkie.Modules.Apps.Features;

/// <summary>
/// Retoma las eliminaciones que quedaron pendientes (un paso falló o el proceso se cayó en medio; ADR-0017). Cada
/// <c>Deletion:RecoverySeconds</c> (60 por defecto; 0 la apaga) toma las que tienen la concesión vencida y corre de nuevo
/// su fase 2, que es idempotente.
/// </summary>
internal sealed partial class DeletionRecovery(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<DeletionRecovery> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = configuration.GetValue("Deletion:RecoverySeconds", 60);
        if (seconds <= 0)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(seconds));
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                await RecoverOnceAsync(scopes, stoppingToken).ConfigureAwait(false);
            }
#pragma warning disable CA1031 // La recuperación nunca debe tumbar el host: lo intenta en la vuelta siguiente.
            catch (Exception ex) when (ex is not OperationCanceledException)
#pragma warning restore CA1031
            {
                LogFailed(logger, ex);
            }
        }
    }

    /// <summary>Una vuelta: retoma las pendientes que se pueden retomar y devuelve cuántas intentó.</summary>
    public static async Task<int> RecoverOnceAsync(IServiceScopeFactory scopes, CancellationToken ct)
    {
        IReadOnlyList<Guid> pending;
        await using (var scope = scopes.CreateAsyncScope())
        {
            pending = await scope.ServiceProvider.GetRequiredService<DeletionHandlers>().ResumableAsync(ct).ConfigureAwait(false);
        }

        foreach (var id in pending)
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<DeletionHandlers>().RunAsync(id, ownsLease: false, ct).ConfigureAwait(false);
        }

        return pending.Count;
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "No se pudieron retomar las eliminaciones pendientes.")]
    private static partial void LogFailed(ILogger logger, Exception exception);
}
