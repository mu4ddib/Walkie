using System.Text.Json.Nodes;
using Json.Schema;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryExamples;

namespace Walkie.IntegrationTests;

/// <summary>
/// Schemas de Walkie Live (spec walkie-live, ADR-0013 y ADR-0014): los ejemplos de <c>packages/schema/examples</c>
/// los cumplen y cada variante inválida falla con la ruta del error. Sin base ni HTTP; datos ficticios.
/// </summary>
public sealed class DiscoveryPackSchemaTests
{
    [Theory]
    [InlineData("tienda-demo")]
    [InlineData("parcial")]
    public void Los_paquetes_de_ejemplo_cumplen_los_schemas(string project)
    {
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.DiscoveryPack, Element(Pack(project, "manifest.json"))));
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Discovery, Element(Pack(project, "discovery.json"))));
    }

    [Theory]
    [InlineData("snapshot.json")]
    [InlineData("binding-linked.json")]
    [InlineData("binding-rejected.json")]
    [InlineData("review.json")]
    [InlineData("apply.json")]
    [InlineData("apply-result.json")]
    [InlineData("upload-preview.json")]
    [InlineData("upload-created.json")]
    [InlineData("review-ambiguous.json")]
    [InlineData("sources.json")]
    [InlineData("evidence.json")]
    public void Los_registros_de_ejemplo_cumplen_su_schema(string file)
    {
        Assert.Empty(WalkieSchemas.Errors(RecordSchema(file), Element(Record(file))));
    }

    [Theory]
    [InlineData("formato-ajeno", "/format")]
    [InlineData("analizador-sin-semver", "/analyzer/version")]
    [InlineData("fuente-sin-id", "/source")]
    [InlineData("ruta-absoluta", "/limitations/0/path")]
    [InlineData("ruta-de-windows", "/limitations/0/path")]
    [InlineData("glob-absoluto", "/scope/exclude/0")]
    [InlineData("campo-desconocido", "/")]
    [InlineData("posiciones-del-editor", "/")]
    [InlineData("tecnologia-sin-evidencia", "/technologies/0/evidence")]
    [InlineData("sin-includeSnippets", "/")]
    [InlineData("sin-detectores", "/detectors")]
    [InlineData("detector-saltado-sin-motivo", "/detectors/0")]
    [InlineData("detector-con-estado-desconocido", "/detectors/0/status")]
    [InlineData("completitud-desconocida", "/completeness")]
    [InlineData("sin-fecha-de-generacion", "/")]
    public void Un_manifest_invalido_falla_con_la_ruta_del_error(string variant, string path)
    {
        var manifest = Pack("tienda-demo", "manifest.json");
        switch (variant)
        {
            case "formato-ajeno": manifest["format"] = "walkie-package"; break;
            case "analizador-sin-semver": manifest["analyzer"]!["version"] = "latest"; break;
            case "fuente-sin-id": manifest["source"]!.AsObject().Remove("id"); break;
            case "ruta-absoluta": manifest["limitations"]![0]!["path"] = "/home/persona/tienda/src/a.cs"; break;
            case "ruta-de-windows": manifest["limitations"]![0]!["path"] = "C:/proyectos/tienda/a.cs"; break;
            case "glob-absoluto": manifest["scope"]!["exclude"]![0] = "/etc/**"; break;
            case "campo-desconocido": manifest["rootPath"] = "/home/persona/tienda"; break;
            case "posiciones-del-editor": manifest["layout"] = new JsonObject { ["n1"] = new JsonObject { ["x"] = 0, ["y"] = 0 } }; break;
            case "tecnologia-sin-evidencia": manifest["technologies"]![0]!["evidence"] = new JsonArray(); break;
            case "sin-includeSnippets": manifest.Remove("includeSnippets"); break;
            case "sin-detectores": manifest["detectors"] = new JsonArray(); break;
            case "detector-saltado-sin-motivo": manifest["detectors"]![0]!["status"] = "skipped"; break;
            case "detector-con-estado-desconocido": manifest["detectors"]![0]!["status"] = "partial"; break;
            case "completitud-desconocida": manifest["completeness"] = "casi"; break;
            case "sin-fecha-de-generacion": manifest.Remove("generatedAt"); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, WalkieSchemas.Errors(WalkieSchemas.DiscoveryPack, Element(manifest)).Keys);
    }

    [Theory]
    [InlineData("entidad-sin-evidencia", "/entities/0")]
    [InlineData("evidencia-vacia", "/entities/0/evidence")]
    [InlineData("clave-de-tipo-desconocido", "/entities/0/key")]
    [InlineData("api-sin-contrato", "/entities/0")]
    [InlineData("http-fuera-de-api", "/entities/2")]
    [InlineData("recurso-sin-subtipo", "/entities/5")]
    [InlineData("pantalla-sin-ruta", "/entities/6")]
    [InlineData("modulo-sin-miembros", "/entities/4")]
    [InlineData("interfaces-fuera-de-modulo", "/entities/3")]
    [InlineData("sin-base", "/entities/0")]
    [InlineData("inferido-con-confianza-alta", "/entities/4/confidence")]
    [InlineData("observado-con-derivedFrom", "/entities/0")]
    [InlineData("sin-fingerprint", "/entities/0")]
    [InlineData("fingerprint-malformado", "/entities/0/fingerprint")]
    [InlineData("confirmacion-en-el-paquete", "/entities/0")]
    [InlineData("posicion-en-la-entidad", "/entities/0")]
    [InlineData("relacion-de-tipo-desconocido", "/relations/0/kind")]
    [InlineData("relacion-sin-evidencia", "/relations/0")]
    [InlineData("relacion-inferida-con-confianza-alta", "/relations/0/confidence")]
    [InlineData("evidencia-que-sale-del-proyecto", "/evidence/0/path")]
    [InlineData("evidencia-con-ruta-absoluta", "/evidence/0/path")]
    [InlineData("confianza-desconocida", "/evidence/0/confidence")]
    [InlineData("evidencia-sin-detector", "/evidence/0")]
    [InlineData("fragmento-demasiado-largo", "/evidence/0/snippet")]
    public void Un_discovery_invalido_falla_con_la_ruta_del_error(string variant, string path)
    {
        var discovery = Pack("tienda-demo", "discovery.json");
        var entities = discovery["entities"]!.AsArray();
        switch (variant)
        {
            case "entidad-sin-evidencia": entities[0]!.AsObject().Remove("evidence"); break;
            case "evidencia-vacia": entities[0]!["evidence"] = new JsonArray(); break;
            case "clave-de-tipo-desconocido": entities[0]!["key"] = "endpoint:GET /api/pedidos"; break;
            case "api-sin-contrato": entities[0]!.AsObject().Remove("http"); break;
            case "http-fuera-de-api": entities[2]!["http"] = new JsonObject { ["method"] = "GET", ["path"] = "/x" }; break;
            case "recurso-sin-subtipo": entities[5]!.AsObject().Remove("resource"); break;
            case "pantalla-sin-ruta": entities[6]!.AsObject().Remove("route"); break;
            case "modulo-sin-miembros": entities[4]!.AsObject().Remove("members"); break;
            case "interfaces-fuera-de-modulo": entities[3]!["interfaces"] = new JsonArray(); break;
            case "sin-base": entities[0]!.AsObject().Remove("basis"); break;
            case "inferido-con-confianza-alta": entities[4]!["confidence"] = "high"; break;
            case "observado-con-derivedFrom": entities[0]!["derivedFrom"] = new JsonArray("service:Tienda.Api"); break;
            case "sin-fingerprint": entities[0]!.AsObject().Remove("fingerprint"); break;
            case "fingerprint-malformado": entities[0]!["fingerprint"] = "md5:abc"; break;
            case "confirmacion-en-el-paquete": entities[0]!["decision"] = "linked"; break;
            case "posicion-en-la-entidad": entities[0]!["x"] = 120; break;
            case "relacion-de-tipo-desconocido": discovery["relations"]![0]!["kind"] = "uses"; break;
            case "relacion-sin-evidencia": discovery["relations"]![0]!.AsObject().Remove("evidence"); break;
            case "relacion-inferida-con-confianza-alta": discovery["relations"]![0]!["confidence"] = "high"; break;
            case "evidencia-que-sale-del-proyecto": discovery["evidence"]![0]!["path"] = "src/../../secretos.json"; break;
            case "evidencia-con-ruta-absoluta": discovery["evidence"]![0]!["path"] = "/srv/tienda/docker-compose.yml"; break;
            case "confianza-desconocida": discovery["evidence"]![0]!["confidence"] = "certain"; break;
            case "evidencia-sin-detector": discovery["evidence"]![0]!.AsObject().Remove("detector"); break;
            case "fragmento-demasiado-largo": discovery["evidence"]![0]!["snippet"] = new string('x', 2001); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, WalkieSchemas.Errors(WalkieSchemas.Discovery, Element(discovery)).Keys);
    }

    [Theory]
    [InlineData("binding-linked.json", "vinculado-sin-destino", "/")]
    [InlineData("binding-rejected.json", "descartado-con-destino", "/")]
    [InlineData("binding-linked.json", "destino-de-tipo-desconocido", "/target/kind")]
    [InlineData("binding-linked.json", "version-cero", "/version")]
    [InlineData("apply.json", "crear-sin-id", "/operations/1")]
    [InlineData("apply.json", "vincular-sin-destino", "/operations/0")]
    [InlineData("apply.json", "descartar-con-destino", "/operations/3")]
    [InlineData("apply.json", "operacion-desconocida", "/operations/0/op")]
    [InlineData("apply.json", "sin-operaciones", "/operations")]
    [InlineData("review.json", "coincidencia-sin-motivo", "/items/1")]
    [InlineData("review.json", "vinculado-sin-vinculo", "/items/0")]
    [InlineData("review.json", "match-fuera-de-matched", "/items/2")]
    [InlineData("snapshot.json", "hash-malformado", "/packSha256")]
    [InlineData("apply-result.json", "estado-desconocido", "/status")]
    [InlineData("upload-preview.json", "vista-previa-que-dice-creado", "/status")]
    [InlineData("upload-created.json", "creado-sin-analisis", "/")]
    [InlineData("review-ambiguous.json", "candidatos-con-propuesta-de-vincular", "/items/0/proposal/op")]
    [InlineData("review-ambiguous.json", "candidatos-en-un-vinculado", "/items/0")]
    public void Un_registro_invalido_falla_con_la_ruta_del_error(string file, string variant, string path)
    {
        var record = Record(file);
        switch (variant)
        {
            case "vinculado-sin-destino": record.Remove("target"); break;
            case "descartado-con-destino": record["target"] = new JsonObject { ["kind"] = "feature", ["id"] = Guid.NewGuid().ToString() }; break;
            case "destino-de-tipo-desconocido": record["target"]!["kind"] = "canvasNode"; break;
            case "version-cero": record["version"] = 0; break;
            case "crear-sin-id": record["operations"]![1]!.AsObject().Remove("id"); break;
            case "vincular-sin-destino": record["operations"]![0]!.AsObject().Remove("target"); break;
            case "descartar-con-destino": record["operations"]![3]!["target"] = new JsonObject { ["kind"] = "feature", ["id"] = Guid.NewGuid().ToString() }; break;
            case "operacion-desconocida": record["operations"]![0]!["op"] = "delete"; break;
            case "sin-operaciones": record["operations"] = new JsonArray(); break;
            case "coincidencia-sin-motivo": record["items"]![1]!.AsObject().Remove("match"); break;
            case "vinculado-sin-vinculo": record["items"]![0]!.AsObject().Remove("binding"); break;
            case "match-fuera-de-matched": record["items"]![2]!["match"] = record["items"]![1]!["match"]!.DeepClone(); break;
            case "hash-malformado": record["packSha256"] = "no-es-un-hash"; break;
            case "estado-desconocido": record["status"] = "partial"; break;
            case "vista-previa-que-dice-creado": record["status"] = "created"; break;
            case "creado-sin-analisis": record.Remove("snapshot"); break;
            case "candidatos-con-propuesta-de-vincular": record["items"]![0]!["proposal"] = new JsonObject { ["op"] = "link", ["target"] = record["items"]![0]!["candidates"]![0]!["target"]!.DeepClone() }; break;
            case "candidatos-en-un-vinculado": record["items"]![0]!["status"] = "matched"; record["items"]![0]!["match"] = record["items"]![0]!["candidates"]![0]!.DeepClone(); break;
            default: throw new ArgumentOutOfRangeException(nameof(variant), variant, null);
        }

        Assert.Contains(path, WalkieSchemas.Errors(RecordSchema(file), Element(record)).Keys);
    }

    [Theory]
    [InlineData("web/src/..hidden/a.ts")]
    [InlineData("docs/v1..2/openapi.json")]
    [InlineData(".github/workflows/ci.yml")]
    public void Una_ruta_relativa_con_puntos_que_no_sube_de_carpeta_es_valida(string relative)
    {
        var discovery = Pack("tienda-demo", "discovery.json");
        discovery["evidence"]![0]!["path"] = relative;

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Discovery, Element(discovery)));
    }

    private static JsonSchema RecordSchema(string file) => file switch
    {
        "snapshot.json" => WalkieSchemas.DiscoverySnapshot,
        "binding-linked.json" or "binding-rejected.json" => WalkieSchemas.DiscoveryBinding,
        "review.json" => WalkieSchemas.DiscoveryReview,
        "apply.json" => WalkieSchemas.DiscoveryApply,
        "apply-result.json" => WalkieSchemas.DiscoveryApplyResult,
        "upload-preview.json" or "upload-created.json" => WalkieSchemas.DiscoveryUpload,
        "review-ambiguous.json" => WalkieSchemas.DiscoveryReview,
        "sources.json" => WalkieSchemas.DiscoverySources,
        "evidence.json" => WalkieSchemas.DiscoveryEvidence,
        _ => throw new ArgumentOutOfRangeException(nameof(file), file, null),
    };
}
