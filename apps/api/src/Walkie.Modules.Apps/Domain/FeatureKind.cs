namespace Walkie.Modules.Apps.Domain;

/// <summary>Tipos de feature (columna <c>features.kind</c>, ADR-0010).</summary>
public static class FeatureKind
{
    public const string Feature = "feature";

    /// <summary>Módulo compartido (spec modulos-compartidos): un lienzo que otras features referencian.</summary>
    public const string Module = "module";
}
