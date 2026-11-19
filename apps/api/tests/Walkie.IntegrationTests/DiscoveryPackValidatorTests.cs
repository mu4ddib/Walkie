using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Shared;
using Walkie.Shared.Discovery;
using static Walkie.IntegrationTests.DiscoveryExamples;

namespace Walkie.IntegrationTests;

/// <summary>
/// Integridad y versiones del <c>.walkiepack</c> (ADR-0014): lo que un schema no expresa —identificadores
/// duplicados, referencias inexistentes, fingerprints, orden, capacidades de los detectores, análisis parciales— y la
/// evolución del formato. <see cref="DiscoveryPackValidator"/> es puro: sin base ni HTTP. Datos ficticios.
/// </summary>
public sealed class DiscoveryPackValidatorTests
{
    [Theory]
    [InlineData("tienda-demo")]
    [InlineData("parcial")]
    public void Los_paquetes_de_ejemplo_son_validos(string project)
    {
        Assert.Empty(Validate(Pack(project, "manifest.json"), Pack(project, "discovery.json")));
    }

    [Fact]
    public void El_fingerprint_del_contenido_coincide_con_otra_implementacion_del_mismo_algoritmo()
    {
        // Los ejemplos se generaron con un script independiente (Python, mismo JSON canónico): si C# calcula lo mismo,
        // el algoritmo está bien especificado. Los de las entidades los comprueba el validador.
        var snapshot = Record("snapshot.json");

        Assert.Equal(
            snapshot["contentFingerprint"]!.GetValue<string>(),
            DiscoveryFingerprint.Content(Element(Pack("tienda-demo", "discovery.json"))));
    }

    [Theory]
    [InlineData("entidad-repetida", "discovery.json/entities/1/key")]
    [InlineData("evidencia-repetida", "discovery.json/evidence/1/id")]
    [InlineData("relacion-repetida", "discovery.json/relations/1/key")]
    [InlineData("detector-repetido", "manifest.json/detectors/1/id")]
    [InlineData("tecnologia-repetida", "manifest.json/technologies/1/id")]
    public void Un_identificador_duplicado_se_rechaza(string variant, string path)
    {
        var (manifest, discovery) = TiendaDemo();
        switch (variant)
        {
            case "entidad-repetida": Duplicate(discovery["entities"]!.AsArray(), 0); break;
            case "evidencia-repetida": Duplicate(discovery["evidence"]!.AsArray(), 0); break;
            case "relacion-repetida": Duplicate(discovery["relations"]!.AsArray(), 0); break;
            case "detector-repetido": Duplicate(manifest["detectors"]!.AsArray(), 0); break;
            case "tecnologia-repetida": Duplicate(manifest["technologies"]!.AsArray(), 0); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, Validate(manifest, discovery).Keys);
    }

    [Theory]
    [InlineData("evidencia-inexistente", "discovery.json/entities/0/evidence/0")]
    [InlineData("origen-inexistente", "discovery.json/relations/0/from")]
    [InlineData("destino-inexistente", "discovery.json/relations/0/to")]
    [InlineData("miembro-inexistente", "discovery.json/entities/4/members/0")]
    [InlineData("derivado-de-inexistente", "discovery.json/entities/4/derivedFrom/0")]
    [InlineData("interfaz-fuera-de-los-miembros", "discovery.json/entities/4/interfaces/0/entity")]
    [InlineData("tecnologia-inexistente", "discovery.json/entities/0/technology")]
    [InlineData("detector-inexistente", "discovery.json/evidence/0/detector")]
    [InlineData("limitacion-de-detector-inexistente", "manifest.json/limitations/0/detector")]
    [InlineData("tecnologia-con-evidencia-inexistente", "manifest.json/technologies/0/evidence/0")]
    [InlineData("se-referencia-a-si-misma", "discovery.json/entities/4/members/0")]
    public void Una_referencia_inexistente_se_rechaza(string variant, string path)
    {
        var (manifest, discovery) = TiendaDemo();
        var entities = discovery["entities"]!.AsArray();
        var module = entities[4]!;
        switch (variant)
        {
            case "evidencia-inexistente": entities[0]!["evidence"]![0] = "ev-no-existe"; break;
            case "origen-inexistente": discovery["relations"]![0]!["from"] = "screen:/no-existe"; break;
            case "destino-inexistente": discovery["relations"]![0]!["to"] = "api:GET /no-existe"; break;
            case "miembro-inexistente": module["members"]![0] = "api:GET /no-existe"; break;
            case "derivado-de-inexistente": module["derivedFrom"]![0] = "service:NoExiste"; break;
            case "interfaz-fuera-de-los-miembros": module["interfaces"]![0]!["entity"] = "database:postgresql/tienda"; break;
            case "tecnologia-inexistente": entities[0]!["technology"] = "cobol"; break;
            case "detector-inexistente": discovery["evidence"]![0]!["detector"] = "no-existe"; break;
            case "limitacion-de-detector-inexistente": manifest["limitations"]![0]!["detector"] = "no-existe"; break;
            case "tecnologia-con-evidencia-inexistente": manifest["technologies"]![0]!["evidence"]![0] = "ev-no-existe"; break;
            case "se-referencia-a-si-misma": module["members"]![0] = module["key"]!.GetValue<string>(); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, Validate(manifest, discovery).Keys);
    }

    [Theory]
    [InlineData("fingerprint-que-no-coincide", "discovery.json/entities/0/fingerprint")]
    [InlineData("clave-de-api-sin-normalizar", "discovery.json/entities/0/key")]
    [InlineData("clave-de-pantalla-sin-normalizar", "discovery.json/entities/6/key")]
    [InlineData("pantalla-de-otra-app", "discovery.json/entities/6/key")]
    [InlineData("feature-de-otra-app", "discovery.json/entities/3/key")]
    [InlineData("clave-de-otro-tipo", "discovery.json/entities/2/key")]
    [InlineData("clave-de-relacion-que-no-coincide", "discovery.json/relations/0/key")]
    [InlineData("entidades-fuera-de-orden", "discovery.json/entities/1/key")]
    [InlineData("evidencia-fuera-de-orden", "discovery.json/evidence/1/id")]
    [InlineData("fragmento-sin-permiso", "discovery.json/evidence/0/snippet")]
    [InlineData("lineas-al-reves", "discovery.json/evidence/0/lines")]
    [InlineData("estadisticas-que-no-coinciden", "manifest.json/stats/entities")]
    public void Un_contenido_incoherente_se_rechaza(string variant, string path)
    {
        var (manifest, discovery) = TiendaDemo();
        var entities = discovery["entities"]!.AsArray();
        switch (variant)
        {
            case "fingerprint-que-no-coincide": entities[0]!["title"] = "Otro título"; break;
            case "clave-de-api-sin-normalizar": Rekey(discovery, "api:GET /api/pedidos/{}", "api:GET /api/pedidos/{pedidoId}"); break;
            case "clave-de-pantalla-sin-normalizar": Rekey(discovery, "screen:web:/pedidos/{}", "screen:web:/pedidos/:pedidoId"); break;
            case "pantalla-de-otra-app": discovery["entities"]![6]!["app"] = "admin"; break;
            case "feature-de-otra-app": discovery["entities"]![3]!["app"] = "admin"; break;
            case "clave-de-otro-tipo": Rekey(discovery, "database:postgresql/tienda", "databases:postgresql/tienda"); break;
            case "clave-de-relacion-que-no-coincide": discovery["relations"]![0]!["key"] = "calls:otra"; break;
            case "entidades-fuera-de-orden": Swap(entities, 0, 1); break;
            case "evidencia-fuera-de-orden": Swap(discovery["evidence"]!.AsArray(), 0, 1); break;
            case "fragmento-sin-permiso": discovery["evidence"]![0]!["snippet"] = "services:\n  api:"; break;
            case "lineas-al-reves": discovery["evidence"]![0]!["lines"] = new JsonObject { ["start"] = 12, ["end"] = 3 }; break;
            case "estadisticas-que-no-coinciden": manifest["stats"]!["entities"] = 99; break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, Validate(manifest, discovery).Keys);
    }

    [Fact]
    public void Un_fragmento_se_acepta_si_el_manifest_lo_permite()
    {
        var (manifest, discovery) = TiendaDemo();
        manifest["includeSnippets"] = true;
        discovery["evidence"]![0]!["snippet"] = "services:\n  api:\n    depends_on: [db]";

        Assert.Empty(Validate(manifest, discovery));
    }

    [Fact]
    public void Un_analisis_parcial_es_valido_y_uno_completo_exige_que_todo_haya_corrido()
    {
        var (manifest, discovery) = TiendaDemo();
        manifest["detectors"]![5]!["status"] = "skipped"; // package-json: solo aporta la evidencia de una tecnología
        manifest["detectors"]![5]!["reason"] = "No se pidió.";
        discovery["evidence"]!.AsArray().RemoveAt(10);   // ev-package-web
        manifest["technologies"]!.AsArray().RemoveAt(2); // react
        manifest["stats"]!["evidence"] = 11;
        foreach (var entity in discovery["entities"]!.AsArray().Where(e => e!["technology"]?.GetValue<string>() == "react"))
        {
            entity!.AsObject().Remove("technology");
            entity["fingerprint"] = DiscoveryFingerprint.Entity(Element(entity));
        }

        Assert.Equal(["manifest.json/completeness"], Validate(manifest, discovery).Keys);

        manifest["completeness"] = "partial";

        Assert.Empty(Validate(manifest, discovery));
    }

    [Theory]
    [InlineData("evidencia-de-un-detector-que-no-corrio", "discovery.json/evidence/9/detector")]
    [InlineData("tipo-que-ningun-detector-produce", "discovery.json/entities/6/kind")]
    public void Lo_descubierto_tiene_que_salir_de_lo_que_el_analizador_dice_que_puede_hacer(string variant, string path)
    {
        var (manifest, discovery) = TiendaDemo();
        manifest["completeness"] = "partial";
        switch (variant)
        {
            case "evidencia-de-un-detector-que-no-corrio":
                manifest["detectors"]![4]!["status"] = "skipped"; // openapi; ev-openapi-pedido es la evidencia 9
                manifest["detectors"]![4]!["reason"] = "No se pidió.";
                break;
            case "tipo-que-ningun-detector-produce":
                manifest["detectors"]![6]!["produces"]!["entities"] = new JsonArray("feature"); // react-router ya no produce screen
                break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, Validate(manifest, discovery).Keys);
    }

    [Fact]
    public void Una_version_mas_nueva_del_formato_se_rechaza_con_un_mensaje_propio_antes_del_schema()
    {
        var (manifest, discovery) = TiendaDemo();
        manifest["formatVersion"] = DiscoveryFormat.CurrentVersion + 1;
        manifest["campoDeLaVersionSiguiente"] = true;

        var errors = Validate(manifest, discovery);

        var (path, messages) = Assert.Single(errors);
        Assert.Equal("manifest.json/formatVersion", path);
        Assert.Contains("actualiza Walkie", Assert.Single(messages), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("otro-formato", "manifest.json/format")]
    [InlineData("version-negativa", "manifest.json/formatVersion")]
    [InlineData("version-como-texto", "manifest.json/formatVersion")]
    [InlineData("grafo-mas-nuevo", "manifest.json/schemaVersion")]
    public void Un_formato_o_una_version_que_no_se_entiende_se_rechaza_sin_mirar_el_resto(string variant, string path)
    {
        var (manifest, discovery) = TiendaDemo();
        switch (variant)
        {
            case "otro-formato": manifest["format"] = "walkie-package"; break;
            case "version-negativa": manifest["formatVersion"] = -1; break;
            case "version-como-texto": manifest["formatVersion"] = "0"; break;
            case "grafo-mas-nuevo": manifest["schemaVersion"] = WalkieInfo.SchemaVersion + 1; break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Equal([path], Validate(manifest, discovery).Keys);
    }

    [Fact]
    public void La_version_del_codigo_coincide_con_la_del_schema_y_hay_una_migracion_por_version()
    {
        using var schema = JsonDocument.Parse(File.ReadAllText(Path.Combine(
            RepoRoot(), "packages", "schema", "walkie-discovery-pack.schema.json")));

        Assert.Equal(DiscoveryFormat.CurrentVersion,
            schema.RootElement.GetProperty("properties").GetProperty("formatVersion").GetProperty("const").GetInt32());
        // Una migración por versión anterior (hoy, 0 → 1). Con una variable: xUnit2013 pide Assert.Single ante un 1 literal.
        var migrationsExpected = DiscoveryFormat.CurrentVersion;
        Assert.Equal(migrationsExpected, DiscoveryFormat.Migrations.Count);
    }

    [Fact]
    public void Subir_un_paquete_de_la_version_actual_no_lo_cambia()
    {
        var (manifest, discovery) = TiendaDemo();
        var before = Element(discovery);

        var (upgradedManifest, upgradedDiscovery) = DiscoveryFormat.Upgrade(DiscoveryFormat.CurrentVersion, manifest, discovery);

        Assert.True(JsonElement.DeepEquals(before, Element(upgradedDiscovery)));
        Assert.Equal(DiscoveryFormat.CurrentVersion, upgradedManifest["formatVersion"]!.GetValue<int>());
        Assert.Throws<ArgumentOutOfRangeException>(() => DiscoveryFormat.Upgrade(DiscoveryFormat.CurrentVersion + 1, manifest, discovery));
    }

    [Theory]
    [InlineData("tienda-demo")]
    [InlineData("parcial")]
    public void Cada_ejemplo_congelado_de_la_version_0_se_migra_a_su_ejemplo_actual_y_es_valido(string project)
    {
        // ADR-0014: los ejemplos de una versión vieja se conservan y se suben con el schema nuevo. Los actuales se
        // escribieron fuera de .NET con la misma regla: si coinciden, la migración hace lo que dice el ADR.
        var (manifest, discovery) = DiscoveryFormat.Upgrade(0, V0(project, "manifest.json"), V0(project, "discovery.json"));

        Assert.True(JsonElement.DeepEquals(Element(Pack(project, "discovery.json")), Element(discovery)));
        Assert.True(JsonElement.DeepEquals(Element(Pack(project, "manifest.json")), Element(manifest)));
        Assert.Empty(Validate(manifest, discovery));
    }

    [Fact]
    public void La_migracion_no_cambia_el_fingerprint_de_lo_que_no_es_pantalla_ni_feature_y_el_legado_coincide()
    {
        var old = V0("tienda-demo", "discovery.json")["entities"]!.AsArray().ToDictionary(e => e!["key"]!.GetValue<string>(), e => e!);
        var migrated = Pack("tienda-demo", "discovery.json")["entities"]!.AsArray();

        foreach (var entity in migrated)
        {
            var key = entity!["key"]!.GetValue<string>();
            var legacy = DiscoveryKeys.WithoutScope(key) ?? key;
            Assert.Equal(old[legacy]!["fingerprint"]!.GetValue<string>(), FormatV1.LegacyFingerprint(Element(entity)));
            if (legacy == key)
            {
                Assert.Equal(old[key]!["fingerprint"]!.GetValue<string>(), entity["fingerprint"]!.GetValue<string>());
            }
        }
    }

    [Theory]
    [InlineData("varias-apps", "su evidencia está en varias apps")]
    [InlineData("fuera-de-una-app", "ningún archivo de su evidencia")]
    public void Una_pantalla_v0_sin_app_inequivoca_no_se_migra_y_pide_reanalizar(string variant, string why)
    {
        var manifest = V0("tienda-demo", "manifest.json");
        var discovery = V0("tienda-demo", "discovery.json");
        var evidence = discovery["evidence"]!.AsArray();
        var screen = discovery["entities"]!.AsArray().Single(e => e!["kind"]!.GetValue<string>() == "screen")!;
        if (variant == "varias-apps")
        {
            evidence.Add(new JsonObject { ["id"] = "ev-package-admin", ["detector"] = "package-json", ["path"] = "admin/package.json", ["symbol"] = "dependencies.react", ["confidence"] = "high" });
            evidence.Add(new JsonObject { ["id"] = "ev-route-admin", ["detector"] = "react-router", ["path"] = "admin/src/routes.tsx", ["confidence"] = "medium" });
            screen["evidence"]!.AsArray().Add("ev-route-admin");
        }
        else
        {
            evidence.Single(e => e!["id"]!.GetValue<string>() == "ev-route-pedido")!["path"] = "otra/routes.tsx";
        }

        var error = Assert.Throws<DiscoveryMigrationException>(() => DiscoveryFormat.Upgrade(0, manifest, discovery));

        var messages = error.Errors.Values.SelectMany(m => m).ToList();
        Assert.Contains(messages, m => m.Contains("screen:/pedidos/{}", StringComparison.Ordinal) && m.Contains(why, StringComparison.Ordinal)
            && m.Contains("vuelve a analizar", StringComparison.Ordinal));
        Assert.Contains(messages, m => m.Contains("feature:Ver pedido", StringComparison.Ordinal)); // su feature tampoco se asigna
    }

    private static JsonObject V0(string project, string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "packages", "schema", "walkiepack", "v0", "examples", project, file)))!.AsObject();

    private static (JsonObject Manifest, JsonObject Discovery) TiendaDemo() =>
        (Pack("tienda-demo", "manifest.json"), Pack("tienda-demo", "discovery.json"));

    private static Dictionary<string, string[]> Validate(JsonObject manifest, JsonObject discovery) =>
        DiscoveryPackValidator.Validate(Element(manifest), Element(discovery));

    private static void Duplicate(JsonArray array, int index) => array.Insert(index + 1, array[index]!.DeepClone());

    private static void Swap(JsonArray array, int a, int b)
    {
        var first = array[a]!.DeepClone();
        array[a] = array[b]!.DeepClone();
        array[b] = first;
    }

    /// <summary>Cambia la clave de una entidad y todas sus referencias (relaciones, miembros, derivadas).</summary>
    private static void Rekey(JsonObject discovery, string from, string to)
    {
        var text = discovery.ToJsonString().Replace(JsonSerializer.Serialize(from), JsonSerializer.Serialize(to), StringComparison.Ordinal);
        var replaced = JsonNode.Parse(text)!.AsObject();
        foreach (var relation in replaced["relations"]!.AsArray())
        {
            relation!["key"] = DiscoveryKeys.Relation(
                relation["kind"]!.GetValue<string>(), relation["from"]!.GetValue<string>(), relation["to"]!.GetValue<string>());
        }

        foreach (var name in new[] { "entities", "relations" })
        {
            discovery[name] = replaced[name]!.DeepClone();
        }
    }
}
