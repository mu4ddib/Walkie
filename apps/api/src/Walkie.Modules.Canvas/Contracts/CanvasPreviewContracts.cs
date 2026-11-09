namespace Walkie.Modules.Canvas.Contracts;

/// <summary>
/// Vista previa del último lienzo guardado de una feature (miniaturas de la galería): solo posición, tamaño
/// y tipo de cada nodo, y los extremos de cada conexión. Un <c>ref</c> lleva el tipo de su elemento del catálogo.
/// </summary>
public sealed record CanvasPreview(
    Guid FeatureId, DateTimeOffset UpdatedAt, IReadOnlyList<PreviewNode> Nodes, IReadOnlyList<PreviewEdge> Edges);

public sealed record PreviewNode(string Id, string Type, double X, double Y, double? W, double? H);

public sealed record PreviewEdge(string From, string To);
