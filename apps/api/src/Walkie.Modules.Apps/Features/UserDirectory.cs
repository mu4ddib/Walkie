using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

/// <summary>
/// Anota a quien entra (ADR-0015): su <c>sub</c>, su correo y su nombre según el token. Escribe la primera vez, cuando
/// cambia el correo o el nombre, o como mucho una vez cada <see cref="Refresh"/> por persona (caché en memoria): no una
/// escritura por solicitud.
/// </summary>
internal sealed class UserDirectory(AppsDbContext db, IMemoryCache cache, TimeProvider clock) : IUserDirectory
{
    private static readonly TimeSpan Refresh = TimeSpan.FromMinutes(10);

    public async Task SeenAsync(string userId, string? email, string? name, CancellationToken cancellationToken)
    {
        var normalized = Normalize(email, AppUser.EmailMaxLength)?.ToLowerInvariant();
        var display = Normalize(name, AppUser.NameMaxLength) ?? "";
        var key = "walkie.user." + userId;
        if (cache.TryGetValue(key, out string? seen) && seen == normalized + "\n" + display)
        {
            return;
        }

        var now = clock.GetUtcNowForDb();
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO apps.users (id, email, name, first_seen_at, last_seen_at)
            VALUES ({userId}, {normalized}, {display}, {now}, {now})
            ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_seen_at = EXCLUDED.last_seen_at
            """, cancellationToken).ConfigureAwait(false);
        cache.Set(key, normalized + "\n" + display, Refresh);
    }

    private static string? Normalize(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is var t && t.Length > max ? t[..max] : value.Trim();
}
