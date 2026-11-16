using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Decisiones tomadas sobre pantallas y candidatos a feature con las claves de la versión 0 del formato
/// (<c>screen:/pedidos</c>, <c>feature:Pedidos</c>), que en la versión 1 llevan el ámbito de la app (ADR-0014). Los
/// análisis guardados no se tocan (son inmutables); lo que se resuelve es a qué clave nueva pasa cada decisión vieja:
/// <list type="bullet">
/// <item><b>Una sola contraparte</b> en el análisis nuevo (la misma ruta o el mismo nombre en una sola app) y sin
/// decisión propia: la decisión pasa a la clave nueva al subir el análisis (<see cref="Carry"/>), sin perder la vieja.</item>
/// <item><b>Varias</b> (la misma ruta en dos apps): no se elige. La decisión vieja sigue activa con su clave, no cuenta
/// como desaparecida y la revisión la muestra en cada contraparte (<c>legacyBinding</c>) para que una persona decida.</item>
/// <item><b>Ninguna</b>: es un hallazgo que no está, con las reglas de siempre para <c>missing</c>.</item>
/// </list>
/// Una decisión es de la versión 0 si el hallazgo sobre el que se tomó no tiene <c>app</c>: se mira en el análisis en
/// que se decidió, no se deduce de la forma de la clave.
/// </summary>
internal static class LegacyBindings
{
    /// <summary>Clave de la versión 0 → claves con ámbito del análisis actual que le corresponden.</summary>
    public static Dictionary<string, List<string>> Counterparts(IEnumerable<string> currentKeys)
    {
        var map = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var key in currentKeys.Order(StringComparer.Ordinal))
        {
            if (DiscoveryKeys.WithoutScope(key) is not { } legacy)
            {
                continue;
            }

            if (!map.TryGetValue(legacy, out var list))
            {
                map[legacy] = list = [];
            }

            list.Add(key);
        }

        return map;
    }

    /// <summary>
    /// De los vínculos activos que no están en el análisis actual y tienen contraparte, los que se decidieron sobre un
    /// hallazgo de la versión 0 (clave → vínculo).
    /// </summary>
    public static async Task<Dictionary<string, Binding>> FindAsync(
        DiscoveryDbContext db, IEnumerable<Binding> bindings, IReadOnlySet<string> current, Dictionary<string, List<string>> counterparts, CancellationToken ct)
    {
        var candidates = bindings
            .Where(b => b.Decision is not null && b.SnapshotId is not null && !current.Contains(b.EntityKey) && counterparts.ContainsKey(b.EntityKey))
            .ToList();
        if (candidates.Count == 0)
        {
            return new Dictionary<string, Binding>(StringComparer.Ordinal);
        }

        var snapshotIds = candidates.Select(b => b.SnapshotId!.Value).Distinct().ToList();
        var keys = candidates.Select(b => b.DecidedKey ?? b.EntityKey).Distinct().ToList();
        var decided = await db.Entities.AsNoTracking()
            .Where(e => snapshotIds.Contains(e.SnapshotId) && keys.Contains(e.Key) && (e.Kind == "screen" || e.Kind == "feature"))
            .Select(e => new { e.SnapshotId, e.Key, e.Data })
            .ToListAsync(ct).ConfigureAwait(false);
        var legacy = decided.Where(e => !HasApp(e.Data)).Select(e => (e.SnapshotId, e.Key)).ToHashSet();
        return candidates.Where(b => legacy.Contains((b.SnapshotId!.Value, b.DecidedKey ?? b.EntityKey)))
            .ToDictionary(b => b.EntityKey, StringComparer.Ordinal);
    }

    /// <summary>
    /// Pasa una decisión vieja a su única contraparte (<paramref name="target"/>, la fila de la clave nueva: nueva o
    /// restablecida). La fila nueva conserva quién decidió, cuándo, el destino y el análisis en que se decidió (con la
    /// clave vieja en <c>DecidedKey</c>). Si el contenido no cambió desde entonces (<see cref="FormatV1.LegacyFingerprint"/>),
    /// guarda el fingerprint nuevo para no marcarla <c>changed</c> solo por la migración. La fila vieja queda sin
    /// decisión, con una nota, como al restablecer.
    /// </summary>
    public static void Carry(Binding legacy, Binding target, JsonElement newEntity)
    {
        var fingerprint = newEntity.GetProperty("fingerprint").GetString()!;
        target.Decision = legacy.Decision;
        target.TargetKind = legacy.TargetKind;
        target.TargetId = legacy.TargetId;
        target.TargetTitle = legacy.TargetTitle;
        target.EntityFingerprint = legacy.EntityFingerprint == FormatV1.LegacyFingerprint(newEntity) ? fingerprint : legacy.EntityFingerprint;
        target.SnapshotId = legacy.SnapshotId;
        target.DecidedKey = legacy.DecidedKey ?? legacy.EntityKey;
        target.ApplyId = legacy.ApplyId;
        target.Note = legacy.Note;
        target.DecidedBy = legacy.DecidedBy;
        target.DecidedAt = legacy.DecidedAt;
        target.PendingApplyId = null;
        target.Version++;

        legacy.Decision = null;
        legacy.TargetKind = null;
        legacy.TargetId = null;
        legacy.TargetTitle = null;
        legacy.EntityFingerprint = null;
        legacy.SnapshotId = null;
        legacy.DecidedKey = null;
        legacy.Note = Truncate($"La decisión pasó a {target.EntityKey}: la versión 1 del formato distingue la app (ADR-0014).", 500);
        legacy.Version++;
    }

    private static bool HasApp(string data)
    {
        using var document = JsonDocument.Parse(data);
        return document.RootElement.TryGetProperty("app", out _);
    }

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];
}
