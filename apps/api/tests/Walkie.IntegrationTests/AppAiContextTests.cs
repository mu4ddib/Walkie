using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Export.Features;
using Walkie.Shared.Schemas;

namespace Walkie.IntegrationTests;

/// <summary>
/// Contexto para IA de una app completa (spec exportar-e-importar, tarea 2): features, catálogo con su uso, mapa y
/// vacíos; JSON contra <c>walkie-app-ai-context.schema.json</c> y Markdown. Función pura. Datos ficticios.
/// </summary>
public sealed class AppAiContextTests
{
    private static readonly Guid App = Guid.Parse("0198f0c0-5555-7000-8000-000000000005");
    private static readonly Guid Login = Guid.Parse("0198f0c0-6666-7000-8000-000000000006");
    private static readonly Guid Transferir = Guid.Parse("0198f0c0-7777-7000-8000-000000000007");
    private static readonly Guid Clientes = Guid.Parse("0198f0c0-8888-7000-8000-000000000008");
    private static readonly Guid Sobrante = Guid.Parse("0198f0c0-9999-7000-8000-000000000009");
    private static readonly DateTimeOffset ExportedAt = new(2026, 11, 12, 20, 0, 0, TimeSpan.Zero);

    [Fact]
    public void El_json_cumple_el_schema_con_cada_feature_el_catalogo_con_su_uso_y_el_mapa()
    {
        var context = MarkdownDocument.BuildAppAiContext(Input());
        using var doc = JsonDocument.Parse(MarkdownDocument.AppAiContextJson(context));
        var root = doc.RootElement;

        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AppAiContext, root));
        Assert.Equal("walkie-app-ai-context", root.GetProperty("format").GetString());
        Assert.Equal("Banca de prueba", root.GetProperty("app").GetProperty("name").GetString());
        Assert.Equal(["Iniciar sesión", "Transferir"],
            root.GetProperty("features").EnumerateArray().Select(f => f.GetProperty("feature").GetProperty("name").GetString()));

        var catalog = root.GetProperty("catalog").EnumerateArray().ToList();
        Assert.Equal(["Consultar cliente", "Notificaciones"], catalog.Select(i => i.GetProperty("title").GetString()));
        Assert.Equal(["Iniciar sesión", "Transferir"], catalog[0].GetProperty("usedBy").EnumerateArray().Select(u => u.GetString()));
        Assert.Equal("GET", catalog[0].GetProperty("http").GetProperty("method").GetString());
        Assert.Empty(catalog[1].GetProperty("usedBy").EnumerateArray());

        var link = Assert.Single(root.GetProperty("map").GetProperty("links").EnumerateArray());
        Assert.Equal("Iniciar sesión", link.GetProperty("from").GetString());
        Assert.Equal("Transferir", link.GetProperty("to").GetString());
        Assert.Equal("Ir a transferir", link.GetProperty("via").GetString());

        var gaps = root.GetProperty("gaps").EnumerateArray().ToList();
        Assert.Contains(gaps, g => g.GetProperty("kind").GetString() == "unused-catalog-item" && !g.TryGetProperty("feature", out _));
        Assert.Contains(gaps, g => g.TryGetProperty("feature", out var f) && f.GetString() == "Transferir");
    }

    [Fact]
    public void El_markdown_tiene_indice_mapa_catalogo_y_cada_feature_un_nivel_mas_abajo()
    {
        var markdown = MarkdownDocument.RenderAppAiContext(MarkdownDocument.BuildAppAiContext(Input()));

        Assert.StartsWith("# Contexto para IA: Banca de prueba (app completa)\n\n> Documento generado por Walkie", markdown, StringComparison.Ordinal);
        string[] order = ["## Features", "## Mapa de la app", "## Catálogo compartido", "## Vacíos detectados (resumen)",
            "## Feature: Iniciar sesión", "### Propósito", "### Componentes", "## Feature: Transferir"];
        var at = order.Select(h => markdown.IndexOf(h, StringComparison.Ordinal)).ToArray();
        Assert.All(at, i => Assert.True(i > 0));
        Assert.Equal(at.Order(), at);
        Assert.Contains("- **Iniciar sesión** (3 componentes", markdown, StringComparison.Ordinal);
        Assert.Contains(": El cliente entra con su documento.", markdown, StringComparison.Ordinal);
        Assert.Contains("- **Transferir** (", markdown, StringComparison.Ordinal);
        Assert.Contains(": sin descripción.", markdown, StringComparison.Ordinal);
        Assert.Contains("- **Iniciar sesión** → **Transferir** (por el portal «Ir a transferir»)", markdown, StringComparison.Ordinal);
        Assert.Contains("usado en: Iniciar sesión, Transferir", markdown, StringComparison.Ordinal);
        Assert.Contains("- El componente «Notificaciones» (Servicio) del catálogo no lo usa ningún lienzo.", markdown, StringComparison.Ordinal);
        // Las features no repiten la nota de introducción.
        Assert.Equal(1, markdown.Split("> Documento generado por Walkie").Length - 1);
        // Un componente dentro de una feature queda en nivel 4.
        Assert.Contains("#### Consultar cliente (API)", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Una_app_sin_features_ni_catalogo_lo_dice()
    {
        var context = MarkdownDocument.BuildAppAiContext(new AppAiContextInput(App, "Vacía", [], [], ExportedAt));
        var markdown = MarkdownDocument.RenderAppAiContext(context);

        Assert.Contains("La app aún no tiene features.", markdown, StringComparison.Ordinal);
        Assert.Contains("La app no tiene componentes compartidos.", markdown, StringComparison.Ordinal);
        Assert.Contains("No se detectaron vacíos.", markdown, StringComparison.Ordinal);
        using var doc = JsonDocument.Parse(MarkdownDocument.AppAiContextJson(context));
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.AppAiContext, doc.RootElement));
    }

    /// <summary>
    /// «Iniciar sesión» (con descripción) usa «Consultar cliente» del catálogo y lleva a «Transferir» por un portal;
    /// «Transferir» también usa «Consultar cliente». «Notificaciones» está en el catálogo y nadie la usa.
    /// </summary>
    private static AppAiContextInput Input()
    {
        static JsonElement Parse(JsonObject graph)
        {
            using var doc = JsonDocument.Parse(graph.ToJsonString());
            return doc.RootElement.Clone();
        }

        static JsonObject Graph(JsonObject nodes, JsonObject edges) => new()
        {
            ["schemaVersion"] = 0, ["version"] = 1, ["nodes"] = nodes, ["edges"] = edges, ["layout"] = new JsonObject(),
        };

        var login = Graph(
            new JsonObject
            {
                ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login" },
                ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "x", ["catalogId"] = Clientes.ToString() },
                ["p1"] = new JsonObject
                {
                    ["id"] = "p1", ["type"] = "portal", ["title"] = "Ir a transferir", ["targetFeatureId"] = Transferir.ToString(),
                },
            },
            new JsonObject
            {
                ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "c1", ["kind"] = "request" },
                ["e2"] = new JsonObject { ["id"] = "e2", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" },
            });
        var transferir = Graph(
            new JsonObject { ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "x", ["catalogId"] = Clientes.ToString() } },
            new JsonObject());

        return new AppAiContextInput(
            App,
            "Banca de prueba",
            [
                (new FeatureSummary(Login, App, "Banca de prueba", "Iniciar sesión", "El cliente entra con su documento."), Parse(login)),
                (new FeatureSummary(Transferir, App, "Banca de prueba", "Transferir"), Parse(transferir)),
            ],
            [
                new CatalogItemResponse(Clientes, App, "api", "Consultar cliente", null, TestJson.Http("GET", "/clientes/{id}"), 1),
                new CatalogItemResponse(Sobrante, App, "service", "Notificaciones", null, null, 1),
            ],
            ExportedAt);
    }
}
