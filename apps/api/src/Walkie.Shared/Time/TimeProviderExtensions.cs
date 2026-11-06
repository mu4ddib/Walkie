namespace Walkie.Shared.Time;

public static class TimeProviderExtensions
{
    /// <summary>
    /// Hora UTC truncada a microsegundos, la precisión de <c>timestamptz</c> en Postgres.
    /// Úsala al crear entidades: así la respuesta del POST coincide con lo que devuelve un GET posterior.
    /// </summary>
    public static DateTimeOffset GetUtcNowForDb(this TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.GetUtcNow();
        return now.AddTicks(-(now.Ticks % (TimeSpan.TicksPerMillisecond / 1000)));
    }
}
