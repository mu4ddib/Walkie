using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>Evidencia y relaciones de un hallazgo (<c>walkie-discovery-evidence</c>).</summary>
internal sealed record EntityEvidence(Guid SnapshotId, Guid FoundIn, string EntityKey, IReadOnlyList<JsonElement> Evidence, IReadOnlyList<JsonElement> Relations);

/// <summary>
/// Lo que el inspector de la revisión muestra de un hallazgo (spec walkie-live, tarea 5): la evidencia que cita y sus
/// relaciones. Lee solo esa entidad (clave primaria), sus evidencias (clave primaria) y sus relaciones (índices por
/// origen y destino), nunca la evidencia del análisis entero. Si el hallazgo no está en el análisis, lo busca en el
/// anterior: así un hallazgo que ya no aparece muestra la evidencia que tenía.
/// </summary>
internal sealed class EvidenceHandlers(DiscoveryDbContext db)
{
    public const int MaxRelations = 100;

    public async Task<EntityEvidence?> EvidenceAsync(Guid snapshotId, string entityKey, CancellationToken ct)
    {
        var snapshot = await db.Snapshots.AsNoTracking()
            .Where(s => s.Id == snapshotId).Select(s => new { s.Id, s.PreviousSnapshotId })
            .FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (snapshot is null)
        {
            return null;
        }

        foreach (var candidate in new[] { snapshot.Id, snapshot.PreviousSnapshotId })
        {
            if (candidate is not { } foundIn)
            {
                continue;
            }

            var data = await db.Entities.AsNoTracking()
                .Where(e => e.SnapshotId == foundIn && e.Key == entityKey).Select(e => e.Data)
                .FirstOrDefaultAsync(ct).ConfigureAwait(false);
            if (data is null)
            {
                continue;
            }

            List<string> ids;
            using (var entity = JsonDocument.Parse(data))
            {
                ids = [.. entity.RootElement.GetProperty("evidence").EnumerateArray().Select(e => e.GetString()!)];
            }

            var evidence = await db.Evidence.AsNoTracking()
                .Where(e => e.SnapshotId == foundIn && ids.Contains(e.Id))
                .Select(e => new { e.Id, e.Data }).ToListAsync(ct).ConfigureAwait(false);
            var relations = await db.Relations.AsNoTracking()
                .Where(r => r.SnapshotId == foundIn && (r.FromKey == entityKey || r.ToKey == entityKey))
                .OrderBy(r => r.Key).Take(MaxRelations)
                .Select(r => new { r.Key, r.Data }).ToListAsync(ct).ConfigureAwait(false);
            return new EntityEvidence(
                snapshot.Id,
                foundIn,
                entityKey,
                [.. evidence.OrderBy(e => e.Id, StringComparer.Ordinal).Select(e => Parse(e.Data))],
                [.. relations.OrderBy(r => r.Key, StringComparer.Ordinal).Select(r => Parse(r.Data))]);
        }

        return null;
    }

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}
