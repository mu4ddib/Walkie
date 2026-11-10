namespace Walkie.Modules.Canvas.Contracts;

/// <summary>Mapa de una app (<c>packages/schema/walkie-app-map.schema.json</c>, spec mapa-de-la-app).</summary>
public sealed record AppMap(
    Guid AppId,
    IReadOnlyList<MapFeature> Features,
    IReadOnlyList<MapLink> Links,
    IReadOnlyList<MapCatalogUse> Catalog,
    MapLayout Layout);

/// <summary>Resumen de una feature en el mapa (su nombre y descripción vienen de la lista de features).</summary>
public sealed record MapFeature(Guid Id, int Screens, int Apis, int Tours, int Flows, int UnresolvedPortals);

/// <summary>Conexión origen → destino con los portales que la forman.</summary>
public sealed record MapLink(Guid From, Guid To, IReadOnlyList<MapPortal> Portals);

/// <summary>Un portal del lienzo de origen y los títulos de las cajas que llegan a él.</summary>
public sealed record MapPortal(string NodeId, IReadOnlyList<string> Sources);

/// <summary>Elemento del catálogo y las features que lo usan.</summary>
public sealed record MapCatalogUse(Guid ItemId, string Type, string Title, IReadOnlyList<Guid> Features);

/// <summary>Distribución guardada del mapa (version 0 sin posiciones: nunca se guardó).</summary>
public sealed record MapLayout(int Version, IReadOnlyDictionary<string, MapPosition> Positions);

public sealed record MapPosition(double X, double Y);
