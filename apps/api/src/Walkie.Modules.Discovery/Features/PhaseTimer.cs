using System.Diagnostics;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Tiempos por fase de una lectura (consultas, clasificación, proyección…), para medir sin adivinar. Solo lo pasan las
/// pruebas de rendimiento; el endpoint no lo usa (null).
/// </summary>
internal sealed class PhaseTimer
{
    private readonly Stopwatch watch = Stopwatch.StartNew();

    public Dictionary<string, double> Phases { get; } = new(StringComparer.Ordinal);

    /// <summary>Anota lo que pasó desde la última marca bajo <paramref name="phase"/> (sumando si se repite).</summary>
    public void Lap(string phase)
    {
        Phases[phase] = Phases.GetValueOrDefault(phase) + watch.Elapsed.TotalMilliseconds;
        watch.Restart();
    }
}
