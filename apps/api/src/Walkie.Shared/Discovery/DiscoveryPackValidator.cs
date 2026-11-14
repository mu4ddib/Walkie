using System.Globalization;
using System.Text.Json;
using Walkie.Shared.Schemas;

namespace Walkie.Shared.Discovery;

/// <summary>
/// Valida un <c>.walkiepack</c> ya extraído (spec walkie-live, ADR-0014): primero el formato y las versiones (con
/// mensaje propio), después los schemas y, si los cumplen, la integridad que un schema no expresa. Función pura, sin
/// base ni archivos: la usan el analizador antes de escribir y la API al recibir. Errores por ruta dentro del
/// paquete (ej. <c>discovery.json/entities/3/evidence/0</c>); vacío si es válido.
/// </summary>
public static class DiscoveryPackValidator
{
    private const string M = DiscoveryFormat.ManifestPath;
    private const string D = DiscoveryFormat.DiscoveryPath;

    /// <summary>Valida el paquete completo.</summary>
    public static Dictionary<string, string[]> Validate(JsonElement manifest, JsonElement discovery)
    {
        var errors = new Errors();
        if (!CheckVersions(manifest, errors))
        {
            return errors.ToDictionary();
        }

        errors.AddAll(WalkieSchemas.Errors(WalkieSchemas.DiscoveryPack, manifest, M));
        errors.AddAll(WalkieSchemas.Errors(WalkieSchemas.Discovery, discovery, D));
        if (errors.Any)
        {
            return errors.ToDictionary();
        }

        CheckIntegrity(manifest, discovery, errors);
        return errors.ToDictionary();
    }

    /// <summary>
    /// Formato y versiones, antes que nada: un paquete de una versión más nueva se rechaza con un mensaje que dice
    /// qué hacer, no con los errores de schema de campos que este lector no conoce.
    /// </summary>
    public static Dictionary<string, string[]> ValidateVersions(JsonElement manifest)
    {
        var errors = new Errors();
        CheckVersions(manifest, errors);
        return errors.ToDictionary();
    }

    private static bool CheckVersions(JsonElement manifest, Errors errors)
    {
        if (manifest.ValueKind != JsonValueKind.Object)
        {
            errors.Add(M, "El manifest no es un objeto JSON.");
            return false;
        }

        if (!manifest.TryGetProperty("format", out var format) || format.ValueKind != JsonValueKind.String
            || format.GetString() != DiscoveryFormat.Name)
        {
            errors.Add($"{M}/format", $"No es un .walkiepack: format tiene que ser «{DiscoveryFormat.Name}».");
            return false;
        }

        if (!manifest.TryGetProperty("formatVersion", out var version) || !TryInteger(version, out var number) || number < 0)
        {
            errors.Add($"{M}/formatVersion", "Falta formatVersion o no es un entero de 0 en adelante.");
            return false;
        }

        if (number > DiscoveryFormat.CurrentVersion)
        {
            errors.Add($"{M}/formatVersion", string.Create(CultureInfo.InvariantCulture,
                $"El paquete es de la versión {number} del formato y Walkie entiende hasta la {DiscoveryFormat.CurrentVersion}: actualiza Walkie o genera el paquete con un analizador compatible."));
            return false;
        }

        if (manifest.TryGetProperty("schemaVersion", out var graph) && TryInteger(graph, out var graphVersion)
            && graphVersion > WalkieInfo.SchemaVersion)
        {
            errors.Add($"{M}/schemaVersion", string.Create(CultureInfo.InvariantCulture,
                $"El paquete usa la versión {graphVersion} del grafo y Walkie entiende hasta la {WalkieInfo.SchemaVersion}: actualiza Walkie."));
            return false;
        }

        return true;
    }

    private static void CheckIntegrity(JsonElement manifest, JsonElement discovery, Errors errors)
    {
        var entities = discovery.GetProperty("entities");
        var relations = discovery.GetProperty("relations");
        var evidence = discovery.GetProperty("evidence");

        // Detectores: ids únicos, cuáles corrieron y qué pueden producir.
        var detectors = new Dictionary<string, (string Status, HashSet<string> Entities, HashSet<string> Relations)>(StringComparer.Ordinal);
        var index = 0;
        foreach (var detector in manifest.GetProperty("detectors").EnumerateArray())
        {
            var id = detector.GetProperty("id").GetString()!;
            var produces = detector.GetProperty("produces");
            if (!detectors.TryAdd(id, (
                detector.GetProperty("status").GetString()!,
                Strings(produces.GetProperty("entities")),
                Strings(produces.GetProperty("relations")))))
            {
                errors.Add($"{M}/detectors/{index}/id", $"Detector repetido: {id}.");
            }

            index++;
        }

        var allRan = detectors.Values.All(d => d.Status == "ran");
        var wholeProject = manifest.GetProperty("scope").GetProperty("include").EnumerateArray()
            .Any(g => g.GetString() == "**/*");
        if (manifest.GetProperty("completeness").GetString() == "complete" && !(allRan && wholeProject))
        {
            errors.Add($"{M}/completeness",
                "Un análisis complete exige que todos los detectores hayan corrido sobre todo el proyecto (include **/*); si no, es partial.");
        }

        // Evidencia: ids únicos, en orden, de un detector que corrió (o falló a mitad) y sin fragmentos si no se pidieron.
        var evidenceDetector = new Dictionary<string, string>(StringComparer.Ordinal);
        var includeSnippets = manifest.GetProperty("includeSnippets").GetBoolean();
        Unique(evidence, "id", $"{D}/evidence", errors, (item, i, id) =>
        {
            var detector = item.GetProperty("detector").GetString()!;
            evidenceDetector[id] = detector;
            if (!detectors.TryGetValue(detector, out var info))
            {
                errors.Add($"{D}/evidence/{i}/detector", $"El detector {detector} no está en el manifest.");
            }
            else if (info.Status == "skipped")
            {
                errors.Add($"{D}/evidence/{i}/detector", $"El detector {detector} no corrió (skipped): no puede dar evidencia.");
            }

            if (!includeSnippets && item.TryGetProperty("snippet", out _))
            {
                errors.Add($"{D}/evidence/{i}/snippet", "Hay fragmentos de código sin includeSnippets.");
            }

            if (item.TryGetProperty("lines", out var lines)
                && lines.GetProperty("end").GetInt32() < lines.GetProperty("start").GetInt32())
            {
                errors.Add($"{D}/evidence/{i}/lines", "end es menor que start.");
            }
        });

        // Tecnologías del manifest.
        var technologies = new HashSet<string>(StringComparer.Ordinal);
        index = 0;
        foreach (var technology in manifest.GetProperty("technologies").EnumerateArray())
        {
            var id = technology.GetProperty("id").GetString()!;
            if (!technologies.Add(id))
            {
                errors.Add($"{M}/technologies/{index}/id", $"Tecnología repetida: {id}.");
            }

            EvidenceExists(technology.GetProperty("evidence"), evidenceDetector, $"{M}/technologies/{index}/evidence", errors);
            index++;
        }

        index = 0;
        foreach (var limitation in manifest.GetProperty("limitations").EnumerateArray())
        {
            if (limitation.TryGetProperty("detector", out var detector) && !detectors.ContainsKey(detector.GetString()!))
            {
                errors.Add($"{M}/limitations/{index}/detector", $"El detector {detector.GetString()} no está en el manifest.");
            }

            index++;
        }

        // Entidades: claves únicas, en orden y normalizadas; fingerprint correcto; referencias que existen.
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entity in entities.EnumerateArray())
        {
            keys.Add(entity.GetProperty("key").GetString()!);
        }

        Unique(entities, "key", $"{D}/entities", errors, (entity, i, key) =>
        {
            var path = $"{D}/entities/{i}";
            var kind = entity.GetProperty("kind").GetString()!;
            if (!key.StartsWith(kind + ":", StringComparison.Ordinal))
            {
                errors.Add($"{path}/key", $"La clave de una entidad {kind} empieza por «{kind}:».");
            }

            var expected = ExpectedKey(entity, kind);
            if (expected is not null && expected != key)
            {
                errors.Add($"{path}/key", $"La clave no está normalizada: tendría que ser «{expected}».");
            }

            if (DiscoveryFingerprint.Entity(entity) != entity.GetProperty("fingerprint").GetString())
            {
                errors.Add($"{path}/fingerprint", "No coincide con el contenido de la entidad.");
            }

            if (entity.TryGetProperty("technology", out var technology) && !technologies.Contains(technology.GetString()!))
            {
                errors.Add($"{path}/technology", $"La tecnología {technology.GetString()} no está en el manifest.");
            }

            var cited = EvidenceExists(entity.GetProperty("evidence"), evidenceDetector, $"{path}/evidence", errors);
            Produces(kind, cited, detectors, d => d.Entities, $"{path}/kind", errors);
            KeysExist(entity, "members", keys, key, path, errors);
            KeysExist(entity, "derivedFrom", keys, key, path, errors);
            if (entity.TryGetProperty("interfaces", out var interfaces))
            {
                var members = Strings(entity.GetProperty("members"));
                var j = 0;
                foreach (var item in interfaces.EnumerateArray())
                {
                    var target = item.GetProperty("entity").GetString()!;
                    if (!members.Contains(target))
                    {
                        errors.Add($"{path}/interfaces/{j}/entity", $"{target} no está en members del módulo.");
                    }

                    j++;
                }
            }
        });

        // Relaciones: claves únicas, en orden y = kind:from->to; extremos que existen.
        Unique(relations, "key", $"{D}/relations", errors, (relation, i, key) =>
        {
            var path = $"{D}/relations/{i}";
            var kind = relation.GetProperty("kind").GetString()!;
            var from = relation.GetProperty("from").GetString()!;
            var to = relation.GetProperty("to").GetString()!;
            if (key != DiscoveryKeys.Relation(kind, from, to))
            {
                errors.Add($"{path}/key", $"La clave tiene que ser «{DiscoveryKeys.Relation(kind, from, to)}».");
            }

            if (!keys.Contains(from))
            {
                errors.Add($"{path}/from", $"No hay una entidad {from}.");
            }

            if (!keys.Contains(to))
            {
                errors.Add($"{path}/to", $"No hay una entidad {to}.");
            }

            var cited = EvidenceExists(relation.GetProperty("evidence"), evidenceDetector, $"{path}/evidence", errors);
            Produces(kind, cited, detectors, d => d.Relations, $"{path}/kind", errors);
        });

        // Estadísticas.
        var stats = manifest.GetProperty("stats");
        foreach (var (name, array) in new[] { ("entities", entities), ("relations", relations), ("evidence", evidence) })
        {
            if (stats.GetProperty(name).GetInt32() != array.GetArrayLength())
            {
                errors.Add($"{M}/stats/{name}", string.Create(CultureInfo.InvariantCulture,
                    $"Dice {stats.GetProperty(name).GetInt32()} y discovery.json trae {array.GetArrayLength()}."));
            }
        }
    }

    /// <summary>La clave que tiene que tener una api (por su contrato) o una screen (por su ruta); null en las demás.</summary>
    private static string? ExpectedKey(JsonElement entity, string kind) => kind switch
    {
        "api" when entity.GetProperty("http") is var http
            && http.TryGetProperty("method", out var method) && http.TryGetProperty("path", out var route)
            => DiscoveryKeys.Api(method.GetString()!, route.GetString()!),
        "screen" => DiscoveryKeys.Screen(entity.GetProperty("route").GetString()!),
        _ => null,
    };

    /// <summary>Recorre una lista exigiendo <paramref name="field"/> único y en orden ordinal.</summary>
    private static void Unique(JsonElement array, string field, string path, Errors errors, Action<JsonElement, int, string> each)
    {
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        string? previous = null;
        var i = 0;
        foreach (var item in array.EnumerateArray())
        {
            var value = item.GetProperty(field).GetString()!;
            if (seen.TryGetValue(value, out var first))
            {
                errors.Add($"{path}/{i}/{field}", string.Create(CultureInfo.InvariantCulture, $"Repetido: también en {path}/{first}."));
            }
            else
            {
                seen[value] = i;
                if (previous is not null && string.CompareOrdinal(previous, value) > 0)
                {
                    errors.Add($"{path}/{i}/{field}", $"Fuera de orden: va antes que «{previous}» (orden por {field}).");
                }

                each(item, i, value);
            }

            previous = value;
            i++;
        }
    }

    private static HashSet<string> EvidenceExists(JsonElement ids, Dictionary<string, string> evidenceDetector, string path, Errors errors)
    {
        var detectors = new HashSet<string>(StringComparer.Ordinal);
        var i = 0;
        foreach (var id in ids.EnumerateArray())
        {
            if (evidenceDetector.TryGetValue(id.GetString()!, out var detector))
            {
                detectors.Add(detector);
            }
            else
            {
                errors.Add($"{path}/{i}", $"No hay una evidencia {id.GetString()}.");
            }

            i++;
        }

        return detectors;
    }

    /// <summary>Al menos uno de los detectores de su evidencia declara que puede producir ese tipo.</summary>
    private static void Produces(
        string kind,
        HashSet<string> cited,
        Dictionary<string, (string Status, HashSet<string> Entities, HashSet<string> Relations)> detectors,
        Func<(string Status, HashSet<string> Entities, HashSet<string> Relations), HashSet<string>> kinds,
        string path,
        Errors errors)
    {
        if (cited.Count > 0 && !cited.Any(d => detectors.TryGetValue(d, out var info) && kinds(info).Contains(kind)))
        {
            errors.Add(path, $"Ningún detector de su evidencia declara que produce {kind} (detectors/produces del manifest).");
        }
    }

    private static void KeysExist(JsonElement entity, string field, HashSet<string> keys, string self, string path, Errors errors)
    {
        if (!entity.TryGetProperty(field, out var list))
        {
            return;
        }

        var i = 0;
        foreach (var item in list.EnumerateArray())
        {
            var key = item.GetString()!;
            if (key == self)
            {
                errors.Add($"{path}/{field}/{i}", "Una entidad no se referencia a sí misma.");
            }
            else if (!keys.Contains(key))
            {
                errors.Add($"{path}/{field}/{i}", $"No hay una entidad {key}.");
            }

            i++;
        }
    }

    /// <summary>Entero de un valor que puede no ser un número (TryGetInt32 lanza si el valor es texto).</summary>
    private static bool TryInteger(JsonElement value, out int number)
    {
        number = 0;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out number);
    }

    private static HashSet<string> Strings(JsonElement array) =>
        array.EnumerateArray().Select(e => e.GetString()!).ToHashSet(StringComparer.Ordinal);

    /// <summary>Errores por ruta, sin repetir mensajes.</summary>
    private sealed class Errors
    {
        private readonly Dictionary<string, List<string>> byPath = new(StringComparer.Ordinal);

        public bool Any => byPath.Count > 0;

        public void Add(string path, string message)
        {
            if (!byPath.TryGetValue(path, out var list))
            {
                byPath[path] = list = [];
            }

            if (!list.Contains(message))
            {
                list.Add(message);
            }
        }

        public void AddAll(Dictionary<string, string[]> other)
        {
            foreach (var (path, messages) in other)
            {
                foreach (var message in messages)
                {
                    Add(path, message);
                }
            }
        }

        public Dictionary<string, string[]> ToDictionary() =>
            byPath.ToDictionary(e => e.Key, e => e.Value.ToArray(), StringComparer.Ordinal);
    }
}
