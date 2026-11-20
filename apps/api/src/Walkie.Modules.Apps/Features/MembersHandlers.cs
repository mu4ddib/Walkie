using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

internal abstract record MemberResult
{
    public sealed record Done(AppMemberResponse? Member) : MemberResult;

    public sealed record NotFound : MemberResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : MemberResult;

    public sealed record Conflict(string Message) : MemberResult;

    public sealed record Forbidden(string Message) : MemberResult;
}

/// <summary>
/// Miembros de una app (ADR-0015). El rol de quien llama ya lo revisó <c>RequireAppRole</c>; aquí van las reglas
/// propias: sumar solo a quien ya entró a Walkie, no repetir, y que nunca falte un owner. Cambiar o quitar toma un
/// candado sobre la fila de la app, así dos owners que se quitan a la vez no la dejan sin dueño.
/// </summary>
internal sealed class MembersHandlers(AppsDbContext db, TimeProvider clock)
{
    public async Task<IReadOnlyList<AppMemberResponse>> ListAsync(Guid appId, CancellationToken ct) =>
        await (from m in db.Memberships.AsNoTracking()
               where m.AppId == appId
               join u in db.Users.AsNoTracking() on m.UserId equals u.Id into users
               from u in users.DefaultIfEmpty()
               orderby m.GrantedAt, m.UserId
               select new AppMemberResponse(m.UserId, u != null && u.Name != "" ? u.Name : m.UserId, u != null ? u.Email : null, m.Role, m.GrantedAt))
            .ToListAsync(ct).ConfigureAwait(false);

    public async Task<MemberResult> AddAsync(Guid appId, AddMemberRequest request, string actorId, CancellationToken ct)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.AsNoTracking().Where(u => u.Email == email).OrderByDescending(u => u.LastSeenAt)
            .FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (user is null)
        {
            return new MemberResult.Invalid(new() { ["email"] = ["Esa persona todavía no entró a Walkie: pídele que inicie sesión una vez y vuelve a intentarlo."] });
        }

        if (await db.Memberships.AnyAsync(m => m.AppId == appId && m.UserId == user.Id, ct).ConfigureAwait(false))
        {
            return new MemberResult.Conflict("Esa persona ya es miembro de la app: cambia su rol en la lista.");
        }

        var membership = new AppMembership
        {
            AppId = appId, UserId = user.Id, Role = request.Role, GrantedBy = actorId, GrantedAt = clock.GetUtcNowForDb(),
        };
        db.Memberships.Add(membership);
        try
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            return new MemberResult.Conflict("Esa persona ya es miembro de la app: cambia su rol en la lista.");
        }

        return new MemberResult.Done(new AppMemberResponse(user.Id, user.Name == "" ? user.Id : user.Name, user.Email, membership.Role, membership.GrantedAt));
    }

    public async Task<MemberResult> UpdateAsync(Guid appId, string userId, string role, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        await LockAppAsync(appId, ct).ConfigureAwait(false);
        var membership = await db.Memberships.SingleOrDefaultAsync(m => m.AppId == appId && m.UserId == userId, ct).ConfigureAwait(false);
        if (membership is null)
        {
            return new MemberResult.NotFound();
        }

        if (membership.Role == AppMembership.Owner && role != AppMembership.Owner && await IsLastOwnerAsync(appId, ct).ConfigureAwait(false))
        {
            return new MemberResult.Conflict("Es el único owner de la app: nombra a otro owner antes de cambiar su rol.");
        }

        membership.Role = role;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        await transaction.CommitAsync(ct).ConfigureAwait(false);
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, ct).ConfigureAwait(false);
        return new MemberResult.Done(new AppMemberResponse(userId, user is { Name.Length: > 0 } ? user.Name : userId, user?.Email, role, membership.GrantedAt));
    }

    public async Task<MemberResult> RemoveAsync(Guid appId, string userId, string actorId, AppRole actorRole, CancellationToken ct)
    {
        if (actorId != userId && actorRole != AppRole.Owner)
        {
            return new MemberResult.Forbidden("Solo un owner puede quitar a otra persona; tú puedes quitarte a ti mismo.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        await LockAppAsync(appId, ct).ConfigureAwait(false);
        var membership = await db.Memberships.SingleOrDefaultAsync(m => m.AppId == appId && m.UserId == userId, ct).ConfigureAwait(false);
        if (membership is null)
        {
            return new MemberResult.NotFound();
        }

        if (membership.Role == AppMembership.Owner && await IsLastOwnerAsync(appId, ct).ConfigureAwait(false))
        {
            return new MemberResult.Conflict("Es el único owner de la app: nombra a otro owner antes de quitarlo.");
        }

        db.Memberships.Remove(membership);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return new MemberResult.Done(null);
    }

    private Task<int> LockAppAsync(Guid appId, CancellationToken ct) =>
        db.Database.ExecuteSqlAsync($"SELECT 1 FROM apps.apps WHERE id = {appId} FOR UPDATE", ct);

    private async Task<bool> IsLastOwnerAsync(Guid appId, CancellationToken ct) =>
        await db.Memberships.CountAsync(m => m.AppId == appId && m.Role == AppMembership.Owner, ct).ConfigureAwait(false) <= 1;
}
