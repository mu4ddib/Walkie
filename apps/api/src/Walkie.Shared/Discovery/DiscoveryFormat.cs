using System.Text.Json.Nodes;

namespace Walkie.Shared.Discovery;

/// <summary>
/// Versiones del formato <c>.walkiepack</c> (spec walkie-live, ADR-0014). Debe coincidir con
/// <c>properties.formatVersion.const</c> de <c>packages/schema/walkie-discovery-pack.schema.json</c>.
/// </summary>
public static class DiscoveryFormat
{
    /// <summary>Valor de <c>format</c> en el manifest.</summary>
    public const string Name = "walkiepack";

    /// <summary>Versión que escribe y valida este código.</summary>
    public const int CurrentVersion = 0;

    /// <summary>Archivo del manifest dentro del <c>.walkiepack</c>.</summary>
    public const string ManifestPath = "manifest.json";

    /// <summary>Archivo de entidades, relaciones y evidencia dentro del <c>.walkiepack</c>.</summary>
    public const string DiscoveryPath = "discovery.json";

    /// <summary>
    /// Migraciones puras de la versión <c>i</c> a la <c>i + 1</c> (índice = versión de origen): un lector acepta
    /// cualquier versión desde 0 hasta <see cref="CurrentVersion"/> subiéndola paso a paso antes de validarla.
    /// Siempre hay exactamente <see cref="CurrentVersion"/> migraciones; hoy ninguna.
    /// </summary>
    public static IReadOnlyList<Migration> Migrations { get; } = [];

    /// <summary>Sube un paquete de <paramref name="fromVersion"/> a <see cref="CurrentVersion"/>.</summary>
    public static (JsonObject Manifest, JsonObject Discovery) Upgrade(int fromVersion, JsonObject manifest, JsonObject discovery)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(fromVersion);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(fromVersion, CurrentVersion);
        for (var version = fromVersion; version < CurrentVersion; version++)
        {
            (manifest, discovery) = Migrations[version](manifest, discovery);
            manifest["formatVersion"] = version + 1;
        }

        return (manifest, discovery);
    }
}

/// <summary>Migración de una versión del formato a la siguiente: no lee nada fuera de los dos documentos.</summary>
public delegate (JsonObject Manifest, JsonObject Discovery) Migration(JsonObject manifest, JsonObject discovery);
