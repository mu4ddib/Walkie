namespace Walkie.Modules.Apps.Contracts;

/// <summary>Resultado de <see cref="IAppWriter.CreateCatalogItemAsync(Guid, Guid, CreateCatalogItemRequest, string, CancellationToken)"/>.</summary>
public enum CatalogItemCreation
{
    /// <summary>Se creó ahora.</summary>
    Created,

    /// <summary>Ya existía con ese id, en esa app y con ese tipo: un reintento. No se escribió nada.</summary>
    AlreadyCreated,

    /// <summary>El id ya es de otro elemento (otra app u otro tipo). No se escribió nada.</summary>
    IdTaken,
}

/// <summary>Resultado de <see cref="IAppWriter.DeleteUntouchedCatalogItemAsync"/>.</summary>
public enum CatalogItemRemoval
{
    /// <summary>Se borró.</summary>
    Deleted,

    /// <summary>No existe (nunca se creó o ya se borró).</summary>
    NotFound,

    /// <summary>Se dejó: alguien lo editó después de crearlo (versión mayor que 1).</summary>
    Edited,

    /// <summary>Se dejó: un lienzo lo usa.</summary>
    InUse,
}

/// <summary>Resultado de <see cref="IAppWriter.CreateFeatureAsync(Guid, Guid, string, string, string?, string, CancellationToken)"/>.</summary>
public enum FeatureCreation
{
    /// <summary>Se creó ahora.</summary>
    Created,

    /// <summary>Ya existía con ese id, en esa app y con ese tipo: un reintento. No se escribió nada.</summary>
    AlreadyCreated,

    /// <summary>El id ya es de otra feature o módulo (otra app u otro tipo). No se escribió nada.</summary>
    IdTaken,
}

/// <summary>Resultado de <see cref="IAppWriter.DeleteUntouchedFeatureAsync"/>.</summary>
public enum FeatureRemoval
{
    /// <summary>Se borró.</summary>
    Deleted,

    /// <summary>No existe (nunca se creó o ya se borró).</summary>
    NotFound,

    /// <summary>Se dejó: alguien le cambió el nombre o la descripción después de crearla.</summary>
    Edited,
}
