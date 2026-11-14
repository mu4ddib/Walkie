using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Shared.Schemas;

namespace Walkie.IntegrationTests;

/// <summary>
/// Contrato del <c>.walkiepack</c> (spec walkie-live, tarea 1; ADR-0013): los ejemplos de
/// <c>packages/schema/examples/walkiepack</c> cumplen <c>walkie-discovery-pack</c> y <c>walkie-discovery</c>, y cada
/// variante inválida falla con la ruta del error. Sin base ni HTTP; datos ficticios.
/// </summary>
public sealed class DiscoveryPackSchemaTests
{
    [Fact]
    public void Los_ejemplos_cumplen_los_schemas()
    {
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryPack, Element(Example("manifest.json"))));
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Discovery, Element(Example("discovery.json"))));
    }

    [Theory]
    [InlineData("formato-ajeno", "/format")]
    [InlineData("version-desconocida", "/formatVersion")]
    [InlineData("analizador-sin-semver", "/analyzer/version")]
    [InlineData("fuente-sin-id", "/source")]
    [InlineData("ruta-absoluta", "/limitations/0/path")]
    [InlineData("ruta-de-windows", "/limitations/0/path")]
    [InlineData("glob-absoluto", "/scope/exclude/0")]
    [InlineData("campo-desconocido", "/")]
    [InlineData("tecnologia-sin-evidencia", "/technologies/0/evidence")]
    [InlineData("sin-includeSnippets", "/")]
    public void Un_manifest_invalido_falla_con_la_ruta_del_error(string variant, string path)
    {
        var manifest = Example("manifest.json");
        switch (variant)
        {
            case "formato-ajeno": manifest["format"] = "walkie-package"; break;
            case "version-desconocida": manifest["formatVersion"] = 1; break;
            case "analizador-sin-semver": manifest["analyzer"]!["version"] = "latest"; break;
            case "fuente-sin-id": manifest["source"]!.AsObject().Remove("id"); break;
            case "ruta-absoluta": manifest["limitations"]![0]!["path"] = "/home/persona/tienda/src/a.cs"; break;
            case "ruta-de-windows": manifest["limitations"]![0]!["path"] = "C:/proyectos/tienda/a.cs"; break;
            case "glob-absoluto": manifest["scope"]!["exclude"]![0] = "/etc/**"; break;
            case "campo-desconocido": manifest["rootPath"] = "/home/persona/tienda"; break;
            case "tecnologia-sin-evidencia": manifest["technologies"]![0]!["evidence"] = new JsonArray(); break;
            case "sin-includeSnippets": manifest.Remove("includeSnippets"); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        var errors = WalkieSchemas.Errors(WalkieSchemas.DiscoveryPack, Element(manifest));

        Assert.Contains(path, errors.Keys);
    }

    [Theory]
    [InlineData("entidad-sin-evidencia", "/entities/0")]
    [InlineData("evidencia-vacia", "/entities/0/evidence")]
    [InlineData("clave-de-tipo-desconocido", "/entities/0/key")]
    [InlineData("http-fuera-de-api", "/entities/1")]
    [InlineData("recurso-sin-subtipo", "/entities/4")]
    [InlineData("ruta-de-pantalla-fuera-de-screen", "/entities/0")]
    [InlineData("interfaces-fuera-de-modulo", "/entities/2")]
    [InlineData("relacion-de-tipo-desconocido", "/relations/0/kind")]
    [InlineData("relacion-sin-evidencia", "/relations/0")]
    [InlineData("evidencia-que-sale-del-proyecto", "/evidence/0/path")]
    [InlineData("evidencia-con-ruta-absoluta", "/evidence/0/path")]
    [InlineData("confianza-desconocida", "/evidence/0/confidence")]
    [InlineData("evidencia-sin-detector", "/evidence/0")]
    public void Un_discovery_invalido_falla_con_la_ruta_del_error(string variant, string path)
    {
        var discovery = Example("discovery.json");
        var entities = discovery["entities"]!.AsArray();
        switch (variant)
        {
            case "entidad-sin-evidencia": entities[0]!.AsObject().Remove("evidence"); break;
            case "evidencia-vacia": entities[0]!["evidence"] = new JsonArray(); break;
            case "clave-de-tipo-desconocido": entities[0]!["key"] = "endpoint:GET /api/pedidos"; break;
            case "http-fuera-de-api": entities[1]!["http"] = new JsonObject { ["method"] = "GET", ["path"] = "/x" }; break;
            case "recurso-sin-subtipo": entities[4]!.AsObject().Remove("resource"); break;
            case "ruta-de-pantalla-fuera-de-screen": entities[0]!["route"] = "/pedidos"; break;
            case "interfaces-fuera-de-modulo": entities[2]!["interfaces"] = new JsonArray(); break;
            case "relacion-de-tipo-desconocido": discovery["relations"]![0]!["kind"] = "uses"; break;
            case "relacion-sin-evidencia": discovery["relations"]![0]!.AsObject().Remove("evidence"); break;
            case "evidencia-que-sale-del-proyecto": discovery["evidence"]![0]!["path"] = "src/../../secretos.json"; break;
            case "evidencia-con-ruta-absoluta": discovery["evidence"]![0]!["path"] = "/srv/tienda/docker-compose.yml"; break;
            case "confianza-desconocida": discovery["evidence"]![0]!["confidence"] = "certain"; break;
            case "evidencia-sin-detector": discovery["evidence"]![0]!.AsObject().Remove("detector"); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        var errors = WalkieSchemas.Errors(WalkieSchemas.Discovery, Element(discovery));

        Assert.Contains(path, errors.Keys);
    }

    [Theory]
    [InlineData("web/src/..hidden/a.ts")]
    [InlineData("docs/v1..2/openapi.json")]
    [InlineData(".github/workflows/ci.yml")]
    public void Una_ruta_relativa_con_puntos_que_no_sube_de_carpeta_es_valida(string relative)
    {
        var discovery = Example("discovery.json");
        discovery["evidence"]![0]!["path"] = relative;

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Discovery, Element(discovery)));
    }

    private static JsonObject Example(string name) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "packages", "schema", "examples", "walkiepack", name)))!
            .AsObject();

    private static JsonElement Element(JsonNode node) => JsonSerializer.SerializeToElement(node);

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("No se encontró la raíz del repo (global.json).");
    }
}
