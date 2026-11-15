using System.Text.Json;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Hallazgo → elemento del catálogo (spec walkie-live, tarea 6; ADR-0014). Transformación explícita y sin inventar:
/// <list type="bullet">
/// <item>el tipo es el del hallazgo (<c>api</c>, <c>service</c>, <c>database</c>, <c>resource</c>) y el título, el suyo;</item>
/// <item>la descripción solo si el análisis la trajo (hoy, de un documento OpenAPI escrito por el equipo);</item>
/// <item><c>http</c>, <c>database</c>, <c>resource</c> y <c>runtime</c> se copian tal cual: el paquete usa los mismos
/// <c>$defs</c> que el catálogo, así que no hay conversión que pueda perder ni agregar datos.</item>
/// </list>
/// Nada de la procedencia entra al elemento: si es observado o inferido, la confianza y la evidencia viven en el
/// vínculo (ADR-0012). Lo que no tiene evidencia queda vacío y se avisa (<see cref="Warnings"/>); la validación es la
/// oficial del catálogo (<see cref="IAppWriter.ValidateCatalogItem"/>), no una copia.
/// </summary>
internal static class CatalogDraft
{
    /// <summary>Lo que se puede crear en esta tarea. <c>module</c> y <c>feature</c> llegan en la tarea 9; una pantalla entra con su feature.</summary>
    public static readonly string[] Kinds = ["api", "service", "database", "resource"];

    public static CreateCatalogItemRequest From(JsonElement entity)
    {
        var kind = entity.GetProperty("kind").GetString()!;
        return new CreateCatalogItemRequest(
            kind,
            entity.GetProperty("title").GetString()!,
            Text(entity, "description"),
            kind == "api" ? Element(entity, "http") : null,
            kind == "database" ? Element(entity, "database") : null,
            kind == "resource" ? Element(entity, "resource") : null,
            kind == "service" ? Text(entity, "runtime") : null);
    }

    /// <summary>
    /// Lo que la persona tiene que saber antes de confirmar: si es inferido, si su confianza es baja, si una base es solo
    /// el modelo de EF y qué campos quedan vacíos por falta de evidencia. <paramref name="detectors"/>: los detectores de su
    /// evidencia.
    /// </summary>
    public static IEnumerable<DiscoveryApplyWarning> Warnings(string key, JsonElement entity, IReadOnlyCollection<string> detectors)
    {
        var kind = entity.GetProperty("kind").GetString()!;
        var basis = entity.GetProperty("basis").GetString();
        var confidence = entity.GetProperty("confidence").GetString();
        if (basis == "inferred")
        {
            var from = entity.TryGetProperty("derivedFrom", out var derived)
                ? string.Join(", ", derived.EnumerateArray().Take(3).Select(d => d.GetString()))
                : null;
            yield return new DiscoveryApplyWarning("inferred", Truncate(
                $"Walkie lo dedujo{(from is null ? "" : $" de {from}")}, no lo vio directamente en el código (confianza {Confidence(confidence)}). "
                + "Crearlo es tu decisión: confírmalo antes."), key);
        }
        else if (confidence == "low")
        {
            yield return new DiscoveryApplyWarning("low-confidence", "El análisis lo vio con confianza baja: revisa su evidencia antes de crearlo.", key);
        }

        if (kind == "database" && detectors.Count > 0 && detectors.All(d => d == "efcore"))
        {
            yield return new DiscoveryApplyWarning("logical-database",
                "Sale de un DbContext de Entity Framework: es el modelo de datos de la aplicación, no confirma qué base física lo guarda ni dónde corre.",
                key);
        }

        var missing = Missing(kind, entity).ToList();
        if (missing.Count > 0)
        {
            yield return new DiscoveryApplyWarning("to-complete",
                $"Sin evidencia para {string.Join(", ", missing)}: quedan vacíos. Complétalos en el catálogo si los conoces.", key);
        }
    }

    /// <summary>Campos útiles del catálogo que el análisis no trajo (no se inventan).</summary>
    private static IEnumerable<string> Missing(string kind, JsonElement entity)
    {
        if (Text(entity, "description") is null)
        {
            yield return "descripción";
        }

        switch (kind)
        {
            case "api":
                var http = Element(entity, "http");
                if (Element(http, "auth") is null)
                {
                    yield return "autenticación";
                }

                if (Element(http, "responses") is null)
                {
                    yield return "respuestas";
                }

                break;
            case "service" when Text(entity, "runtime") is null:
                yield return "dónde corre";
                break;
            case "database":
                var database = Element(entity, "database");
                if (Element(database, "engine") is null)
                {
                    yield return "motor";
                }

                if (Element(database, "tables") is null)
                {
                    yield return "estructura";
                }

                break;
            case "resource" when Element(Element(entity, "resource"), "provider") is null:
                yield return "proveedor";
                break;
        }
    }

    private static string Confidence(string? confidence) => confidence switch
    {
        "high" => "alta",
        "medium" => "media",
        _ => "baja",
    };

    private static JsonElement? Element(JsonElement? parent, string property) =>
        parent is { ValueKind: JsonValueKind.Object } p && p.TryGetProperty(property, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.Clone()
            : null;

    private static string? Text(JsonElement entity, string property) =>
        entity.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()
            : null;

    private static string Truncate(string text) => text.Length <= 500 ? text : text[..500];
}
