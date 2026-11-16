using System.Text.Json;
using System.Text.Json.Nodes;

namespace Walkie.Shared.Discovery;

/// <summary>
/// Migración pura 0 → 1 del <c>.walkiepack</c> (ADR-0014): las pantallas y los candidatos a feature pasan a tener el
/// ámbito de su app (<see cref="AppScope"/>) en la clave y en <c>app</c>.
/// <para>
/// <b>Cómo se sabe la app</b> sin leer nada fuera del paquete: las apps son las carpetas de los <c>package.json</c> con
/// evidencia de <c>package-json</c> sobre React, Angular o Next.js (<c>dependencies.react</c>…), las mismas que reconoce
/// el analizador; una pantalla es de la app más interna que contiene cada archivo de su evidencia, y un candidato a
/// feature, de la app de sus pantallas. Sin <c>.walkie/source.json</c> (la versión 0 no lo leía), el ámbito es la carpeta.
/// </para>
/// <para>
/// <b>Si no es inequívoco</b> (la pantalla cita archivos de dos apps porque la versión 0 juntó la misma ruta de dos apps,
/// ninguna app la contiene, o un candidato mezcla pantallas de varias apps), no se elige una: la migración falla con el
/// error en la ruta de la entidad y pide volver a analizar el proyecto con la CLI actual.
/// </para>
/// Después reescribe todo lo que nombra esas claves (relaciones y sus claves, <c>members</c>, <c>derivedFrom</c>,
/// interfaces), recalcula los fingerprints de lo que cambió y vuelve a ordenar por clave. La evidencia, los conteos y
/// el manifest (salvo la versión) no cambian.
/// </summary>
public static class FormatV1
{
    private static readonly string[] Frameworks = ["react", "@angular/core", "next"];
    private static readonly string[] Sections = ["dependencies", "devDependencies", "peerDependencies"];

    public static (JsonObject Manifest, JsonObject Discovery) Migrate(JsonObject manifest, JsonObject discovery)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(discovery);
        var entities = Items(discovery, "entities");
        var relations = Items(discovery, "relations");
        var evidence = Items(discovery, "evidence");

        var paths = new Dictionary<string, string>(StringComparer.Ordinal);
        var apps = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var item in evidence.OfType<JsonObject>())
        {
            if (Text(item, "id") is not { } id || Text(item, "path") is not { } path)
            {
                continue;
            }

            paths[id] = path;
            if (Text(item, "detector") == "package-json" && (path == "package.json" || path.EndsWith("/package.json", StringComparison.Ordinal))
                && Text(item, "symbol") is { } symbol && Sections.Any(s => Frameworks.Any(f => symbol == $"{s}.{f}")))
            {
                apps.Add(path.Length == "package.json".Length ? "" : path[..^"/package.json".Length]);
            }
        }

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var renamed = new Dictionary<string, string>(StringComparer.Ordinal);
        var scopes = new Dictionary<string, string>(StringComparer.Ordinal);
        var screens = new List<(int Index, JsonObject Entity)>();
        var features = new List<(int Index, JsonObject Entity)>();
        for (var i = 0; i < entities.Count; i++)
        {
            if (entities[i] is not JsonObject entity)
            {
                continue;
            }

            switch (Text(entity, "kind"))
            {
                case "screen": screens.Add((i, entity)); break;
                case "feature": features.Add((i, entity)); break;
            }
        }

        foreach (var (i, screen) in screens)
        {
            var key = Text(screen, "key") ?? "";
            var files = Strings(screen, "evidence").Select(id => paths.GetValueOrDefault(id)).OfType<string>().ToList();
            var owners = files.Select(f => AppOf(apps, f)).Distinct().ToList();
            if (owners is [{ } dir])
            {
                var scope = AppScope.FromDirectory(dir);
                scopes[key] = scope;
                renamed[key] = DiscoveryKeys.Screen(scope, Text(screen, "route") ?? key["screen:".Length..]);
            }
            else
            {
                errors[$"{DiscoveryFormat.DiscoveryPath}/entities/{i}"] = [Ambiguous(key, owners.Count == 0 || owners.Contains(null)
                    ? "ningún archivo de su evidencia está dentro de una app de React, Angular o Next.js del paquete"
                    : $"su evidencia está en varias apps ({string.Join(", ", owners.Select(o => AppScope.FromDirectory(o!)))}): la versión 0 juntaba la misma ruta de dos apps")];
            }
        }

        foreach (var (i, feature) in features)
        {
            var key = Text(feature, "key") ?? "";
            var members = Strings(feature, "members").Where(m => m.StartsWith("screen:", StringComparison.Ordinal)).ToList();
            var owners = members.Select(m => scopes.GetValueOrDefault(m)).Distinct().ToList();
            if (owners is [{ } scope])
            {
                scopes[key] = scope;
                renamed[key] = DiscoveryKeys.Feature(scope, key["feature:".Length..]);
                continue;
            }

            var why = owners.Count == 0 ? "no agrupa ninguna pantalla"
                : owners.Contains(null) ? "alguna de sus pantallas no tiene una app inequívoca"
                : $"agrupa pantallas de varias apps ({string.Join(", ", owners)}): la versión 0 juntaba candidatos del mismo nombre";
            errors[$"{DiscoveryFormat.DiscoveryPath}/entities/{i}"] = [Ambiguous(key, why)];
        }

        if (errors.Count > 0)
        {
            throw new DiscoveryMigrationException(errors);
        }

        string Rename(string key) => renamed.GetValueOrDefault(key, key);
        foreach (var entity in entities.OfType<JsonObject>())
        {
            var before = DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(entity));
            var key = Text(entity, "key") ?? "";
            if (renamed.TryGetValue(key, out var newKey))
            {
                entity["key"] = newKey;
                entity["app"] = scopes[key];
            }

            RenameAll(entity, "members", Rename);
            RenameAll(entity, "derivedFrom", Rename);
            if (entity["interfaces"] is JsonArray interfaces)
            {
                foreach (var item in interfaces.OfType<JsonObject>())
                {
                    if (Text(item, "entity") is { } target)
                    {
                        item["entity"] = Rename(target);
                    }
                }
            }

            // Solo cambia el fingerprint de lo que cambió de contenido (app o members); el resto queda igual.
            var after = DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(entity));
            if (after != before)
            {
                entity["fingerprint"] = after;
            }
        }

        foreach (var relation in relations.OfType<JsonObject>())
        {
            if (Text(relation, "from") is { } from && Text(relation, "to") is { } to && Text(relation, "kind") is { } kind
                && (renamed.ContainsKey(from) || renamed.ContainsKey(to)))
            {
                relation["from"] = Rename(from);
                relation["to"] = Rename(to);
                relation["key"] = DiscoveryKeys.Relation(kind, Rename(from), Rename(to));
            }
        }

        discovery["entities"] = SortByKey(entities);
        discovery["relations"] = SortByKey(relations);
        return (manifest, discovery);
    }

    /// <summary>
    /// El fingerprint que habría tenido en la versión 0 una pantalla o un candidato a feature de la versión 1: sin
    /// <c>app</c> y con sus <c>members</c> sin ámbito. Sirve para saber si lo que una persona decidió sobre la clave
    /// vieja sigue siendo lo mismo, sin marcarlo <c>changed</c> solo por la migración.
    /// </summary>
    public static string LegacyFingerprint(JsonElement v1Entity)
    {
        var entity = JsonNode.Parse(v1Entity.GetRawText())!.AsObject();
        entity.Remove("app");
        RenameAll(entity, "members", k => DiscoveryKeys.WithoutScope(k) ?? k);
        if (entity["interfaces"] is JsonArray interfaces)
        {
            foreach (var item in interfaces.OfType<JsonObject>())
            {
                if (Text(item, "entity") is { } target)
                {
                    item["entity"] = DiscoveryKeys.WithoutScope(target) ?? target;
                }
            }
        }

        return DiscoveryFingerprint.Entity(JsonSerializer.SerializeToElement(entity));
    }

    private static string? AppOf(SortedSet<string> apps, string path) =>
        apps.Where(dir => dir.Length == 0 || path.StartsWith(dir + "/", StringComparison.Ordinal)).MaxBy(dir => dir.Length);

    private static string Ambiguous(string key, string why) =>
        $"No se puede saber de qué app es {key}: {why}. Walkie no lo asigna a una app por su cuenta: vuelve a analizar el proyecto con la versión actual de walkie (walkie scan) y sube el paquete nuevo.";

    private static JsonArray SortByKey(JsonArray items)
    {
        var sorted = items.Select(i => i?.DeepClone()).OrderBy(i => i is JsonObject o ? Text(o, "key") : null, StringComparer.Ordinal).ToList();
        return new JsonArray([.. sorted]);
    }

    private static void RenameAll(JsonObject entity, string field, Func<string, string> rename)
    {
        if (entity[field] is not JsonArray array)
        {
            return;
        }

        for (var i = 0; i < array.Count; i++)
        {
            if (array[i] is JsonValue value && value.TryGetValue<string>(out var key))
            {
                array[i] = rename(key);
            }
        }
    }

    private static JsonArray Items(JsonObject document, string name) => document[name] as JsonArray ?? [];

    private static string? Text(JsonObject node, string name) =>
        node[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static IEnumerable<string> Strings(JsonObject node, string name) =>
        node[name] is JsonArray array ? array.OfType<JsonValue>().Select(v => v.TryGetValue<string>(out var s) ? s : null).OfType<string>() : [];
}
