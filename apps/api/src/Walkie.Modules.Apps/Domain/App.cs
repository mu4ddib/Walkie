namespace Walkie.Modules.Apps.Domain;

/// <summary>Aplicación documentada. Contiene features y su catálogo (<see cref="CatalogItem"/>).</summary>
internal sealed class App
{
    public const int NameMaxLength = 120;

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }

    /// <summary>Claim <c>sub</c> de quien la creó (ADR-0003).</summary>
    public required string CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public List<Feature> Features { get; } = [];
    public List<AppMembership> Members { get; } = [];

    /// <summary>
    /// Una app nueva con quien la crea como <c>owner</c> (ADR-0015), en el mismo guardado: ninguna app queda sin dueño,
    /// la cree quien la cree (vacía, importada o desde un proyecto local).
    /// </summary>
    public static App Create(string name, string userId, DateTimeOffset now, Guid? id = null)
    {
        var app = new App { Id = id ?? Guid.CreateVersion7(), Name = name.Trim(), CreatedBy = userId, CreatedAt = now };
        app.Members.Add(new AppMembership { AppId = app.Id, UserId = userId, Role = AppMembership.Owner, GrantedBy = userId, GrantedAt = now });
        return app;
    }
}
