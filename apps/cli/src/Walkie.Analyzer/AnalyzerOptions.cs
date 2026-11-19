namespace Walkie.Analyzer;

/// <summary>Qué analizar y cómo (spec walkie-live, ADR-0013).</summary>
public sealed record AnalyzerOptions
{
    /// <summary>Carpeta raíz del proyecto; se lee y nunca se ejecuta nada de ella.</summary>
    public required string Root { get; init; }

    /// <summary>Nombre de la fuente; por defecto, el guardado en <c>.walkie/source.json</c> o el de la carpeta.</summary>
    public string? Name { get; init; }

    /// <summary>Id de la fuente dado desde fuera: no se lee ni se escribe <c>.walkie/source.json</c>.</summary>
    public Guid? SourceId { get; init; }

    /// <summary>Si no hay id, crear <c>.walkie/source.json</c> en el proyecto (la única escritura dentro de él).</summary>
    public bool WriteSourceFile { get; init; } = true;

    /// <summary>Ids de los detectores a correr; null = todos. Los demás quedan <c>skipped</c> y el análisis, parcial.</summary>
    public IReadOnlySet<string>? Detectors { get; init; }

    public AnalyzerLimits Limits { get; init; } = new();

    /// <summary>Reloj de <c>generatedAt</c> (en las pruebas, fijo).</summary>
    public TimeProvider Clock { get; init; } = TimeProvider.System;
}

/// <summary>
/// Límites del análisis y del paquete. Pasar uno no es un error: el análisis queda parcial y lo dice en
/// <c>limitations</c>; solo el tamaño del paquete final aborta (la API no lo aceptaría).
/// </summary>
public sealed record AnalyzerLimits
{
    /// <summary>Archivos del alcance que se recorren; los demás no se miran.</summary>
    public int MaxFiles { get; init; } = 20_000;

    /// <summary>Tamaño máximo de un archivo que un detector lee.</summary>
    public long MaxFileBytes { get; init; } = 1024 * 1024;

    /// <summary>Entidades del paquete; las siguientes se descartan.</summary>
    public int MaxEntities { get; init; } = 20_000;

    /// <summary>Tamaño máximo del <c>.walkiepack</c> (el mismo que acepta la importación de un <c>.walkie</c>, ADR-0009).</summary>
    public long MaxPackBytes { get; init; } = 50L * 1024 * 1024;

    /// <summary>Limitaciones que se listan una por una; las siguientes se resumen en una.</summary>
    public int MaxLimitations { get; init; } = 100;
}
