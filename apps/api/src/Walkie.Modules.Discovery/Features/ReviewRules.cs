using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Shared.Discovery;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Un elemento existente de Walkie en la app, candidato a coincidir con un hallazgo. <see cref="Type"/> es el tipo
/// del catálogo (<c>api</c>, <c>service</c>, <c>database</c>, <c>resource</c>) o <c>module</c>/<c>feature</c>;
/// <see cref="Signature"/>, la clave que tendría como hallazgo si su contrato la define (solo api, database y resource).
/// </summary>
internal sealed record ExistingTarget(string TargetKind, string Type, Guid Id, string Title, string? Signature)
{
    public DiscoveryTarget Reference => new(TargetKind, Id, Title);
}

/// <summary>
/// Coincidencias entre hallazgos y elementos existentes de la app (ADR-0014). Solo propone, nunca vincula:
/// <list type="number">
/// <item><b>Firma</b>: la clave normalizada del hallazgo es la del elemento, calculada con
/// <see cref="DiscoveryKeys"/> desde su contrato (api: método y ruta; database: motor y nombre; resource: subtipo y
/// nombre). Servicios, módulos y features no tienen firma verificable.</item>
/// <item><b>Título</b>: mismo título sin distinguir mayúsculas, acentos ni espacios repetidos. Es solo una sugerencia.</item>
/// </list>
/// Solo entre tipos compatibles, solo elementos de la misma app y sin los que ya están vinculados a otro hallazgo de
/// la fuente. Si hay varios candidatos por el mismo motivo no se elige ninguno: se devuelven todos.
/// </summary>
internal sealed class MatchIndex
{
    private readonly Dictionary<string, List<ExistingTarget>> bySignature = new(StringComparer.Ordinal);
    private readonly Dictionary<(string Type, string Title), List<ExistingTarget>> byTitle = new();

    public MatchIndex(IEnumerable<ExistingTarget> targets)
    {
        foreach (var target in targets)
        {
            if (target.Signature is { } signature)
            {
                Add(bySignature, signature, target);
            }

            Add(byTitle, (target.Type, NormalizeTitle(target.Title)), target);
        }
    }

    /// <summary>El tipo de elemento existente con el que puede coincidir un hallazgo; null si ninguno (una pantalla).</summary>
    public static string? TargetType(string entityKind) => entityKind switch
    {
        "api" or "service" or "database" or "resource" => entityKind,
        "module" => "module",
        "feature" => "feature",
        _ => null,
    };

    /// <summary>A qué tipo de destino se puede vincular un hallazgo: <c>catalogItem</c>, <c>module</c>, <c>feature</c> o ninguno.</summary>
    public static string? TargetKindFor(string entityKind) => entityKind switch
    {
        "api" or "service" or "database" or "resource" => "catalogItem",
        "module" => "module",
        "feature" => "feature",
        _ => null,
    };

    /// <summary>
    /// Coincidencia de un hallazgo: (match, null) si hay un solo candidato; (null, candidatos) si hay varios por el
    /// mismo motivo; (null, null) si ninguno. <paramref name="available"/> deja fuera los ya vinculados a otro hallazgo.
    /// </summary>
    public (DiscoveryMatch? Match, IReadOnlyList<DiscoveryMatch>? Candidates) Find(
        string entityKind, string key, string title, Func<ExistingTarget, bool> available)
    {
        if (TargetType(entityKind) is not { } type)
        {
            return (null, null);
        }

        var signature = bySignature.TryGetValue(key, out var bySig)
            ? bySig.Where(t => t.Type == type && available(t)).ToList()
            : [];
        if (signature.Count > 0)
        {
            return Pick(signature, "signature");
        }

        var titled = byTitle.TryGetValue((type, NormalizeTitle(title)), out var byName)
            ? byName.Where(available).ToList()
            : [];
        return titled.Count > 0 ? Pick(titled, "title") : (null, null);
    }

    private static (DiscoveryMatch?, IReadOnlyList<DiscoveryMatch>?) Pick(List<ExistingTarget> found, string reason) =>
        found.Count == 1
            ? (new DiscoveryMatch(found[0].Reference, reason), null)
            : (null, found.OrderBy(t => t.Id).Select(t => new DiscoveryMatch(t.Reference, reason)).ToList());

    /// <summary>Elementos existentes de ese tipo cuya firma es <paramref name="key"/> (crear otro los duplicaría).</summary>
    public IReadOnlyList<ExistingTarget> WithSignature(string type, string key) =>
        bySignature.TryGetValue(key, out var found) ? [.. found.Where(t => t.Type == type)] : [];

    /// <summary>Elementos existentes de ese tipo con el mismo título normalizado.</summary>
    public IReadOnlyList<ExistingTarget> WithTitle(string type, string title) =>
        byTitle.TryGetValue((type, NormalizeTitle(title)), out var found) ? found : [];

    /// <summary>La firma de un elemento del catálogo según su contrato, o null si no la tiene completa.</summary>
    public static string? Signature(string type, JsonElement? http, JsonElement? database, JsonElement? resource)
    {
        static string? Text(JsonElement? element, string property) =>
            element is { ValueKind: JsonValueKind.Object } e && e.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(value.GetString())
                ? value.GetString()
                : null;

        return type switch
        {
            "api" when Text(http, "method") is { } method && Text(http, "path") is { } path => DiscoveryKeys.Api(method, path),
            "database" when Text(database, "engine") is { } engine && Text(database, "name") is { } name => DiscoveryKeys.Database(engine, name),
            "resource" when Text(resource, "kind") is { } kind && Text(resource, "name") is { } name => DiscoveryKeys.Resource(kind, name),
            _ => null,
        };
    }

    /// <summary>Título comparable: sin acentos, sin mayúsculas y con los espacios colapsados.</summary>
    public static string NormalizeTitle(string title)
    {
        var builder = new StringBuilder(title.Length);
        var space = false;
        foreach (var c in title.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsWhiteSpace(c))
            {
                space = builder.Length > 0;
                continue;
            }

            if (space)
            {
                builder.Append(' ');
                space = false;
            }

            builder.Append(char.ToUpperInvariant(c));
        }

        return builder.ToString();
    }

    private static void Add<TKey>(Dictionary<TKey, List<ExistingTarget>> index, TKey key, ExistingTarget target)
        where TKey : notnull
    {
        if (!index.TryGetValue(key, out var list))
        {
            index[key] = list = [];
        }

        list.Add(target);
    }
}

/// <summary>
/// Cuándo un hallazgo vinculado que ya no aparece se puede dar por desaparecido (<c>missing</c>, ADR-0014). Solo si el
/// análisis actual pudo verlo y no lo vio:
/// <list type="bullet">
/// <item>cada detector que dio su evidencia en el análisis anterior corrió entero (<c>ran</c>) en el actual;</item>
/// <item>cada archivo de esa evidencia está dentro del alcance actual (incluido y no excluido);</item>
/// <item>ninguna limitación actual alcanza a esos archivos o a esos detectores, y ninguna cortó el análisis entero.</item>
/// </list>
/// Si algo de eso no se cumple, no hay evidencia suficiente: el hallazgo no se muestra como desaparecido.
/// </summary>
internal static class MissingRules
{
    /// <summary>Limitaciones que cortan el análisis entero: después de ellas, la ausencia no prueba nada.</summary>
    private static readonly HashSet<string> Truncating = new(["file-limit", "entity-limit", "more-limitations"], StringComparer.Ordinal);

    public static bool CanConclude(JsonElement currentManifest, IReadOnlyList<(string Detector, string Path)> previousEvidence) =>
        WhyNot(currentManifest, previousEvidence) is null;

    /// <summary>
    /// Null si el análisis actual podía ver el hallazgo (se concluye <c>missing</c>); si no, por qué no alcanza su
    /// cobertura, en palabras para la persona (tarea 10: lo muestra la revisión como <c>unverified</c>).
    /// </summary>
    public static string? WhyNot(JsonElement currentManifest, IReadOnlyList<(string Detector, string Path)> previousEvidence)
    {
        if (previousEvidence.Count == 0)
        {
            return "No quedó evidencia del análisis anterior con que comparar.";
        }

        var ran = currentManifest.GetProperty("detectors").EnumerateArray()
            .Where(d => d.GetProperty("status").GetString() == "ran")
            .Select(d => d.GetProperty("id").GetString()!)
            .ToHashSet(StringComparer.Ordinal);
        var scope = currentManifest.GetProperty("scope");
        var include = Globs(scope.GetProperty("include"));
        var exclude = Globs(scope.GetProperty("exclude"));
        var limitations = currentManifest.GetProperty("limitations").EnumerateArray()
            .Select(l => (
                Code: l.GetProperty("code").GetString()!,
                Detector: l.TryGetProperty("detector", out var d) ? d.GetString() : null,
                Path: l.TryGetProperty("path", out var p) ? p.GetString() : null))
            .ToList();

        if (limitations.FirstOrDefault(l => Truncating.Contains(l.Code)) is { Code: { } cut })
        {
            return $"Este análisis se cortó antes de terminar ({cut}): lo que no miró no se da por desaparecido.";
        }

        foreach (var (detector, path) in previousEvidence)
        {
            if (!ran.Contains(detector))
            {
                return $"El detector {detector}, que lo había encontrado, no corrió entero en este análisis.";
            }

            if (!include.Any(g => g.IsMatch(path)) || exclude.Any(g => g.IsMatch(path)))
            {
                return $"{path} quedó fuera del alcance de este análisis.";
            }

            if (limitations.FirstOrDefault(l => Affects(l, detector, path)) is { Code: { } code })
            {
                return $"Una limitación de este análisis ({code}) alcanza a {path}.";
            }
        }

        return null;
    }

    /// <summary>Una limitación alcanza a una evidencia si es de su archivo (o de una carpeta que lo contiene) o de su detector sin archivo.</summary>
    private static bool Affects((string Code, string? Detector, string? Path) limitation, string detector, string path) =>
        limitation.Path is { } where
            ? path == where || path.StartsWith(where.TrimEnd('/') + "/", StringComparison.Ordinal)
            : limitation.Detector == detector;

    private static List<Regex> Globs(JsonElement array) =>
        [.. array.EnumerateArray().Select(g => Glob(g.GetString()!))];

    /// <summary><c>**</c> = cualquier cantidad de carpetas, <c>*</c> = dentro de una carpeta, <c>?</c> = un carácter.</summary>
    internal static Regex Glob(string pattern)
    {
        var regex = new StringBuilder("^");
        for (var i = 0; i < pattern.Length; i++)
        {
            var c = pattern[i];
            if (c == '*' && i + 1 < pattern.Length && pattern[i + 1] == '*')
            {
                var slash = i + 2 < pattern.Length && pattern[i + 2] == '/';
                regex.Append(slash ? "(.*/)?" : ".*");
                i += slash ? 2 : 1;
            }
            else
            {
                regex.Append(c switch
                {
                    '*' => "[^/]*",
                    '?' => "[^/]",
                    _ => Regex.Escape(c.ToString()),
                });
            }
        }

        return new Regex(regex.Append('$').ToString(), RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
    }
}
