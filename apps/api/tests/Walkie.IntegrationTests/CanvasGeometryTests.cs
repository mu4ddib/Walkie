using System.Text.Json;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Features;

namespace Walkie.IntegrationTests;

/// <summary>
/// La API valida las posiciones con el tamaño con que el navegador dibuja cada caja (spec walkie-live-documentacion,
/// revisión final, punto 1), no con lo nominal (184 × 72). Medido en Chromium: una API de firma corta mide 184 × 89;
/// una de 38 caracteres, 264 × 166; una de 104, 264 × 242. Sin base de datos: <see cref="BoxSizes"/> y
/// <see cref="CanvasDraft"/> son puros.
/// </summary>
public sealed class CanvasGeometryTests
{
    private static readonly Guid Catalog1 = Guid.Parse("0198f0c0-1111-7000-8000-000000000001");
    private static readonly Guid Catalog2 = Guid.Parse("0198f0c0-1111-7000-8000-000000000002");

    [Theory]
    // Lo medido en el navegador (título y firma iguales, como una API descubierta): la estimación nunca es menor.
    [InlineData("GET /api/apps", 184, 89)]
    [InlineData("POST /api/apps/{appId}/import", 245, 89)]
    [InlineData("PUT /api/apps/{appId}/map/layout", 264, 109)]
    [InlineData("PUT /api/apps/{appId}/members/{userId}", 264, 166)]
    [InlineData("POST /api/apps/{appId}/sources/snapshots", 264, 166)]
    [InlineData("GET /api/abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij", 264, 204)]
    [InlineData("GET /api/abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcde", 264, 242)]
    public void Una_API_no_mide_menos_que_en_el_navegador(string signature, double measuredWidth, double measuredHeight)
    {
        var (w, h) = BoxSizes.Estimate(signature, http: signature);
        Assert.InRange(w, measuredWidth, BoxSizes.MaxWidth);
        Assert.True(h >= measuredHeight, $"{signature}: estimado {h}, medido {measuredHeight}");
        Assert.True(h <= measuredHeight + 48, $"{signature}: estimado {h}, demasiado holgado para lo medido ({measuredHeight})");
    }

    [Theory]
    [InlineData(4, 15, 86)]
    [InlineData(20, 67, 104)]
    [InlineData(40, 67, 123)]
    [InlineData(120, 107, 162)]
    public void Una_pantalla_con_titulo_largo_y_ruta_crece_como_en_el_navegador(int title, int description, double measuredHeight)
    {
        var (_, h) = BoxSizes.Estimate(new string('a', title), description: new string('b', description));
        Assert.True(h >= measuredHeight, $"estimado {h}, medido {measuredHeight}");
    }

    [Fact]
    public void Lo_guardado_manda_y_lo_que_falta_se_estima_por_el_contenido()
    {
        using var group = JsonDocument.Parse("""{ "x": 0, "y": 0, "w": 600, "h": 400 }""");
        Assert.Equal((600d, 400d), BoxSizes.OfSaved(null, group.RootElement));

        using var node = JsonDocument.Parse("""{ "id": "m", "type": "module", "title": "Pagos" }""");
        using var moduleBox = JsonDocument.Parse("""{ "x": 0, "y": 0, "w": 420 }""");
        var (w, h) = BoxSizes.OfSaved(node.RootElement, moduleBox.RootElement);
        Assert.Equal(420, w);
        Assert.True(h >= 69);

        // Un componente se dibuja como su elemento: título y firma (dos o tres líneas cada uno si es largo).
        using var reference = JsonDocument.Parse("""{ "id": "r", "type": "ref", "title": "PUT /api/apps/{appId}/members/{userId}", "catalogId": "0198f0c0-1111-7000-8000-000000000001" }""");
        using var at = JsonDocument.Parse("""{ "x": 0, "y": 0 }""");
        Assert.True(BoxSizes.OfSaved(reference.RootElement, at.RootElement).H >= 166);
    }

    [Fact]
    public void El_lienzo_inicial_rechaza_cajas_que_solo_no_se_enciman_con_el_tamano_nominal()
    {
        // Dos APIs de firma larga a 104 px de distancia (la grilla de antes): con 184 × 72 pasaban; dibujadas, se enciman.
        var draft = Draft(
            Ref("api:a", "PUT /api/apps/{appId}/members/{userId}", Catalog1),
            Ref("api:b", "POST /api/apps/{appId}/sources/snapshots", Catalog2));
        var (graph, errors) = CanvasDraft.Graph(draft, Input(("api:a", 0, 0), ("api:b", 0, 104)), "/operations/0/canvas");
        Assert.Null(graph);
        var message = Assert.Single(errors["/operations/0/canvas/layout/api:b"]);
        Assert.Contains("Se encima con api:a", message, StringComparison.Ordinal);
        Assert.Contains("264 × ", message, StringComparison.Ordinal); // dice el tamaño con que se dibuja

        // Con lugar para lo que miden (y aire), se acepta.
        var (ok, none) = CanvasDraft.Graph(draft, Input(("api:a", 0, 0), ("api:b", 0, 200)), "/operations/0/canvas");
        Assert.NotNull(ok);
        Assert.Empty(none);
    }

    [Fact]
    public void Cajas_cortas_de_184_x_72_siguen_entrando_pegadas_con_8_px_de_aire()
    {
        var draft = Draft(new DiscoveryDraftNode("screen:a", "screen", "Inicio"), new DiscoveryDraftNode("screen:b", "screen", "Ayuda"));
        // Sin ruta ni firma: 184 de ancho; al lado con 8 px de aire, entra; con 4, no.
        Assert.Empty(CanvasDraft.Graph(draft, Input(("screen:a", 0, 0), ("screen:b", 192, 0)), "/c").Errors);
        Assert.NotEmpty(CanvasDraft.Graph(draft, Input(("screen:a", 0, 0), ("screen:b", 188, 0)), "/c").Errors);
    }

    [Fact]
    public void Incorporar_no_acepta_una_caja_nueva_encima_de_una_existente_grande_ni_de_un_grupo()
    {
        using var existing = JsonDocument.Parse("""
            {
              "version": 3,
              "nodes": {
                "big": { "id": "big", "type": "api", "title": "PUT /api/apps/{appId}/members/{userId}", "http": { "method": "PUT", "path": "/api/apps/{appId}/members/{userId}" } },
                "long": { "id": "long", "type": "screen", "title": "Una pantalla con un título muy largo que ocupa varias líneas en la caja del lienzo", "description": "Ruta: /pedidos/:id/lineas/:lineaId/detalle" }
              },
              "edges": {},
              "groups": { "g": { "id": "g", "name": "Infra", "kind": "custom" } },
              "layout": {
                "big": { "x": 0, "y": 0 },
                "long": { "x": 600, "y": 0 },
                "g": { "x": 0, "y": 400, "w": 600, "h": 300 }
              }
            }
            """);
        var draft = Draft(new DiscoveryDraftNode("screen:web:/", "screen", "Inicio", Route: "/"));

        // Debajo de la API grande, donde con 184 × 72 cabía (y = 96): se encima con lo que mide de verdad.
        var (_, errors) = CanvasDraft.Additions(draft, Input(("screen:web:/", 0, 96)), existing.RootElement, "/operations/0/canvas");
        var message = Assert.Single(errors["/operations/0/canvas/layout/screen:web:/"]);
        Assert.Contains("PUT /api/apps/{appId}/members/{userId}", message, StringComparison.Ordinal);
        Assert.Contains("sin mover nada", message, StringComparison.Ordinal);

        // Debajo de la pantalla de título largo (con 72 de alto, y = 80 era libre): también se encima.
        Assert.NotEmpty(CanvasDraft.Additions(draft, Input(("screen:web:/", 600, 80)), existing.RootElement, "/c").Errors);
        // Dentro del grupo guardado (sus medidas explícitas mandan).
        Assert.NotEmpty(CanvasDraft.Additions(draft, Input(("screen:web:/", 200, 500)), existing.RootElement, "/c").Errors);

        // A la derecha de todo, libre: entra y solo agrega la caja nueva, sin tocar lo que ya estaba.
        var (added, none) = CanvasDraft.Additions(draft, Input(("screen:web:/", 960, 0)), existing.RootElement, "/c");
        Assert.True(none.Count == 0, string.Join(" | ", none.SelectMany(e => e.Value)));
        Assert.Single(added!["layout"]!.AsObject());
        Assert.False(added["layout"]!.AsObject().ContainsKey("big"));
    }

    private static Draft Draft(params DiscoveryDraftNode[] nodes) => new([.. nodes], [], [], [], [], []);

    private static DiscoveryDraftNode Ref(string key, string title, Guid catalogId) => new(key, "ref", title, CatalogId: catalogId);

    private static CanvasInput Input(params (string Key, double X, double Y)[] boxes) => new(
        boxes.ToDictionary(b => b.Key, _ => Guid.CreateVersion7(), StringComparer.Ordinal),
        new Dictionary<string, Guid>(StringComparer.Ordinal),
        new Dictionary<string, Guid>(StringComparer.Ordinal),
        boxes.ToDictionary(b => b.Key, b => (b.X, b.Y), StringComparer.Ordinal));
}
