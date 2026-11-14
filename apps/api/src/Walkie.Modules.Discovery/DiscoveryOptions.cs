namespace Walkie.Modules.Discovery;

/// <summary>
/// Sección <c>Discovery</c> de la configuración (ADR-0012). <see cref="Enabled"/> está apagado salvo que se encienda:
/// <c>appsettings.Development.json</c> lo enciende en desarrollo y nada lo enciende en producción. Encenderlo en un
/// entorno con usuarios reales exige antes la autorización por app (bloqueo de seguridad de ADR-0012): hoy cualquier
/// usuario autenticado vería la evidencia de cualquier app.
/// </summary>
public sealed class DiscoveryOptions
{
    public const string Section = "Discovery";

    /// <summary>Con <c>false</c>, todos los endpoints de Discovery responden 404.</summary>
    public bool Enabled { get; set; }
}

/// <summary>Límites al recibir un <c>.walkiepack</c> (los mismos que usa el analizador al generarlo, ADR-0013).</summary>
public static class DiscoveryLimits
{
    /// <summary>Tamaño máximo del archivo subido (el mismo que acepta la importación de un <c>.walkie</c>).</summary>
    public const long MaxPackBytes = 50L * 1024 * 1024;

    /// <summary>Tope de lo descomprimido, declarado y leído (contra zip bombs).</summary>
    public const long MaxUncompressedBytes = 200L * 1024 * 1024;

    public const int MaxEntities = 20_000;

    public const int MaxRelations = 100_000;

    public const int MaxEvidence = 100_000;
}
