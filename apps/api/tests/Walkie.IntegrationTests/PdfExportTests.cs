using System.Text.Json;
using System.Text.Json.Nodes;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Export.Features;

namespace Walkie.IntegrationTests;

/// <summary>
/// PDF de una feature (spec exportar-e-importar, tarea 4; ADR-0008): portada, página del lienzo y contenido con
/// tablas e imágenes. Función pura: sin base ni HTTP. Con <c>WALKIE_PDF=&lt;carpeta&gt;</c> guarda el PDF para mirarlo.
/// Datos ficticios.
/// </summary>
public sealed class PdfExportTests
{
    private static readonly Guid Feature = Guid.Parse("0198f0c0-aaaa-7000-8000-00000000000a");
    private static readonly DateTimeOffset ExportedAt = new(2026, 11, 12, 21, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Con_la_imagen_del_lienzo_tiene_portada_pagina_del_lienzo_y_contenido()
    {
        var context = MarkdownDocument.BuildAiContext(Input(Graph()));
        var screen = new PdfImage(TestImages.RealPng(64, 48), "image/png");

        var pdf = MarkdownDocument.RenderPdf(context, new PdfImage(TestImages.RealPng(1600, 900), "image/png"),
            new Dictionary<string, PdfImage> { ["s1"] = screen });
        Save(pdf, "con-lienzo");

        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
        using var doc = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.Equal("Iniciar sesión", doc.Info.Title);
        Assert.True(doc.PageCount >= 3, $"páginas: {doc.PageCount}");
        // La página del lienzo es apaisada; la portada, vertical.
        Assert.True(doc.Pages[1].Width.Point > doc.Pages[1].Height.Point);
        Assert.True(doc.Pages[0].Width.Point < doc.Pages[0].Height.Point);
        // Las dos imágenes (lienzo y pantalla) van dentro.
        Assert.Equal(2, CountImages(doc));
    }

    [Fact]
    public void Sin_imagen_del_lienzo_no_tiene_esa_pagina_y_una_imagen_webp_no_rompe_el_documento()
    {
        var context = MarkdownDocument.BuildAiContext(Input(Graph()));

        var pdf = MarkdownDocument.RenderPdf(context, null,
            new Dictionary<string, PdfImage> { ["s1"] = new(TestImages.Create("webp", 8, 8), "image/webp") });

        using var doc = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.All(doc.Pages.Cast<PdfPage>(), p => Assert.True(p.Width.Point < p.Height.Point));
        Assert.Equal(0, CountImages(doc));
    }

    [Fact]
    public void La_imagen_del_lienzo_conserva_su_proporcion()
    {
        var context = MarkdownDocument.BuildAiContext(Input(Graph()));
        foreach (var (w, h) in new[] { (1600, 400), (600, 900) })
        {
            var pdf = MarkdownDocument.RenderPdf(context, new PdfImage(TestImages.RealPng(w, h), "image/png"), new Dictionary<string, PdfImage>());
            using var doc = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
            // La matriz con que se dibuja la imagen (a 0 0 d e f cm): su ancho y alto en la página guardan la proporción.
            var content = System.Text.Encoding.Latin1.GetString(doc.Pages[1].Contents.Elements.GetDictionary(0)?.Stream?.UnfilteredValue
                ?? ((PdfSharp.Pdf.PdfDictionary)doc.Pages[1].Contents.Elements[0]).Stream.UnfilteredValue);
            var m = System.Text.RegularExpressions.Regex.Match(content, @"([\d.]+) 0 0 ([\d.]+) [\d.-]+ [\d.-]+ cm\s*/I");
            Assert.True(m.Success, content);
            var ratio = double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture)
                / double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
            Assert.InRange(ratio, (double)w / h * 0.98, (double)w / h * 1.02);
        }
    }

    [Fact]
    public void Un_lienzo_vacio_da_un_pdf_valido()
    {
        var empty = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = new JsonObject(), ["edges"] = new JsonObject(), ["layout"] = new JsonObject(),
        };
        var pdf = MarkdownDocument.RenderPdf(MarkdownDocument.BuildAiContext(Input(empty)), null, new Dictionary<string, PdfImage>());

        using var doc = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.Equal(2, doc.PageCount);
    }

    private static int CountImages(PdfDocument doc) =>
        doc.Pages.Cast<PdfPage>()
            .Select(p => p.Resources.Elements.GetDictionary("/XObject"))
            .Where(x => x is not null)
            .SelectMany(x => x!.Elements.Values)
            .Count();

    private static void Save(byte[] pdf, string name)
    {
        if (Environment.GetEnvironmentVariable("WALKIE_PDF") is { Length: > 0 } dir)
        {
            File.WriteAllBytes(Path.Combine(dir, $"walkie-{name}.pdf"), pdf);
        }
    }

    private static AiContextInput Input(JsonObject graph)
    {
        using var doc = JsonDocument.Parse(graph.ToJsonString());
        return new AiContextInput(
            Feature, "Banca de prueba", "Iniciar sesión", "El cliente entra con su documento y su clave.",
            doc.RootElement.Clone(), new Dictionary<Guid, CatalogItemResponse>(), new Dictionary<Guid, string>(), ExportedAt);
    }

    /// <summary>Pantalla con inputs, API con contrato completo, base con tablas, cola con detalles y un recorrido.</summary>
    private static JsonObject Graph() => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = 4,
        ["nodes"] = JsonNode.Parse("""
            {
              "s1": { "id": "s1", "type": "screen", "title": "Login", "assetId": "0198f0c0-1111-7000-8000-000000000001",
                      "inputs": [{ "name": "documento", "type": "string", "required": true, "ruleIds": ["r1"] },
                                 { "name": "canal", "type": "enum", "options": ["app", "web"] }] },
              "r1": { "id": "r1", "type": "rule", "title": "Documento válido", "expression": "solo dígitos, de 6 a 10" },
              "a1": { "id": "a1", "type": "api", "title": "API Auth", "description": "Abre una sesión.",
                      "http": { "method": "POST", "path": "/sesiones",
                                "auth": { "type": "bearer", "description": "Token del canal" },
                                "params": [{ "name": "X-Canal", "in": "header", "type": "string", "required": true, "example": "app" }],
                                "request": { "fields": [{ "name": "documento", "type": "string", "required": true }], "example": "{ \"documento\": \"123\" }" },
                                "responses": [{ "status": 201, "description": "Sesión creada", "fields": [{ "name": "token", "type": "string" }] },
                                              { "status": 401, "description": "Clave incorrecta" }] } },
              "d1": { "id": "d1", "type": "database", "title": "Core",
                      "database": { "model": "relational", "engine": "PostgreSQL",
                                    "tables": [{ "name": "sesiones", "fields": [{ "name": "id", "type": "uuid", "key": "primary" },
                                                                                 { "name": "cliente_id", "type": "uuid", "key": "foreign", "nullable": true }] }] } },
              "q1": { "id": "q1", "type": "resource", "title": "Auditoría",
                      "resource": { "kind": "queue", "provider": "aws", "name": "auditoria", "details": [{ "key": "retención", "value": "4 días" }] } },
              "v1": { "id": "v1", "type": "service", "title": "Notificaciones", "runtime": "container", "notes": "Envía el aviso de ingreso." }
            }
            """),
        ["edges"] = JsonNode.Parse("""
            {
              "e1": { "id": "e1", "from": "s1", "to": "a1", "kind": "request" },
              "e2": { "id": "e2", "from": "a1", "to": "s1", "kind": "response", "replyTo": "e1", "status": 201, "outcome": "Va al inicio" },
              "e3": { "id": "e3", "from": "a1", "to": "d1", "kind": "writes" },
              "e4": { "id": "e4", "from": "a1", "to": "q1", "kind": "event" },
              "e5": { "id": "e5", "from": "q1", "to": "v1", "kind": "event" },
              "e6": { "id": "e6", "from": "s1", "to": "r1", "kind": "uses" }
            }
            """),
        ["layout"] = new JsonObject(),
        ["tours"] = JsonNode.Parse("""
            {
              "f1": { "id": "f1", "name": "Entrar", "kind": "flow",
                      "steps": [{ "edgeId": "e1", "note": "Envía documento y clave" }, { "edgeId": "e2" }] },
              "t1": { "id": "t1", "name": "Presentación", "kind": "guide", "steps": [{ "nodeId": "s1", "note": "Aquí empieza." }] }
            }
            """),
    };
}
