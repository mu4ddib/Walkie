using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using static Walkie.IntegrationTests.DiscoveryExamples;

namespace Walkie.IntegrationTests;

/// <summary>
/// Compatibilidad del contrato de Walkie Live con lo que ya existe (ADR-0012 y ADR-0014): reutiliza los
/// <c>$defs</c> del grafo sin duplicarlos, lo descubierto pasa al catálogo sin traducir, y las claves y los
/// fingerprints reconocen un componente entre análisis sin depender de líneas ni de rutas. Datos ficticios.
/// </summary>
public sealed class DiscoveryCompatibilityTests
{
    [Fact]
    public void Una_entidad_del_catalogo_se_convierte_en_un_elemento_valido_sin_traducir_sus_campos()
    {
        foreach (var entity in Pack("tienda-demo", "discovery.json")["entities"]!.AsArray()
            .Where(e => e!["kind"]!.GetValue<string>() is "api" or "service" or "database" or "resource"))
        {
            var item = new JsonObject
            {
                ["id"] = Guid.CreateVersion7().ToString(),
                ["appId"] = Guid.CreateVersion7().ToString(),
                ["type"] = entity!["kind"]!.GetValue<string>(),
                ["title"] = entity["title"]!.GetValue<string>(),
                ["version"] = 1,
            };
            foreach (var field in new[] { "description", "http", "database", "resource", "runtime" })
            {
                if (entity[field] is { } value)
                {
                    item[field] = value.DeepClone();
                }
            }

            Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.CatalogItem, Element(item)));
        }
    }

    [Fact]
    public void El_contrato_de_una_api_descubierta_es_el_mismo_que_valida_el_catalogo()
    {
        var api = Pack("parcial", "discovery.json")["entities"]![0]!;

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Http, Element(api["http"]!)));
    }

    [Fact]
    public void El_fingerprint_no_cambia_con_la_evidencia_la_confianza_ni_el_orden_de_los_campos()
    {
        var entity = Pack("tienda-demo", "discovery.json")["entities"]![0]!.AsObject();
        var original = DiscoveryFingerprint.Entity(Element(entity));

        var moved = entity.DeepClone().AsObject();
        moved["evidence"] = new JsonArray("ev-otra-linea");
        moved["confidence"] = "medium";
        var reordered = new JsonObject(moved.Reverse().Select(p => KeyValuePair.Create(p.Key, p.Value?.DeepClone())));

        Assert.Equal(original, DiscoveryFingerprint.Entity(Element(reordered)));
        Assert.Equal(original, entity["fingerprint"]!.GetValue<string>());
    }

    [Fact]
    public void El_fingerprint_cambia_si_cambia_lo_que_describe_la_entidad()
    {
        var entity = Pack("tienda-demo", "discovery.json")["entities"]![0]!.AsObject();
        var original = DiscoveryFingerprint.Entity(Element(entity));

        entity["http"]!["path"] = "/api/pedidos/{pedidoId}/detalle";

        Assert.NotEqual(original, DiscoveryFingerprint.Entity(Element(entity)));
    }

    [Fact]
    public void El_json_canonico_escapa_lo_minimo_y_ordena_las_claves()
    {
        using var doc = JsonDocument.Parse("""{ "b": "línea\nnueva \"citada\" \u0001", "a": [2, 1], "c": { "z": true, "y": null } }""");

        Assert.Equal(
            "{\"a\":[2,1],\"b\":\"línea\\nnueva \\\"citada\\\" \\u0001\",\"c\":{\"y\":null,\"z\":true}}",
            DiscoveryFingerprint.Canonical(doc.RootElement, null));
    }

    [Theory]
    [InlineData("GET", "/api/pedidos/{pedidoId}", "api:GET /api/pedidos/{}")]
    [InlineData("get", "api/pedidos/{id:int}/", "api:GET /api/pedidos/{}")]
    [InlineData("DELETE", "//api//pedidos/:pedidoId?force=true", "api:DELETE /api/pedidos/{}")]
    [InlineData("GET", "/api/archivos/{*ruta}", "api:GET /api/archivos/{}")]
    [InlineData("POST", "/api/Pedidos", "api:POST /api/Pedidos")]
    [InlineData("GET", "/", "api:GET /")]
    public void La_clave_de_una_api_no_depende_del_nombre_ni_del_estilo_de_sus_parametros(string method, string path, string key)
    {
        Assert.Equal(key, DiscoveryKeys.Api(method, path));
    }

    [Theory]
    [InlineData("/pedidos/:pedidoId", "screen:/pedidos/{}")]
    [InlineData("/pedidos/[pedidoId]", "screen:/pedidos/{}")]
    [InlineData("/blog/[...slug]#arriba", "screen:/blog/{}")]
    [InlineData("pedidos", "screen:/pedidos")]
    public void La_clave_de_una_pantalla_es_la_misma_en_React_Router_Next_y_Angular(string route, string key)
    {
        Assert.Equal(key, DiscoveryKeys.Screen(route));
    }

    [Fact]
    public void Las_demas_claves_salen_del_nombre_y_no_de_la_ruta_del_archivo()
    {
        Assert.Equal("service:Tienda.Api", DiscoveryKeys.Service(" Tienda.Api "));
        Assert.Equal("database:postgresql/tienda", DiscoveryKeys.Database("PostgreSQL", "tienda"));
        Assert.Equal("resource:queue/pedidos-creados", DiscoveryKeys.Resource("queue", "pedidos-creados"));
        Assert.Equal("module:Tienda.Pedidos", DiscoveryKeys.Module("Tienda.Pedidos"));
        Assert.Equal("feature:Ver pedido", DiscoveryKeys.Feature("Ver pedido"));
        Assert.Equal("calls:screen:/a->api:GET /a", DiscoveryKeys.Relation("calls", "screen:/a", "api:GET /a"));
    }
}
