using System.Text.Json.Nodes;
using Walkie.Analyzer;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Identidad de pantallas y candidatos a feature en un monorepo (ADR-0014, formatVersion 1): la clave lleva el ámbito de
/// la app (su carpeta, o el que elige el equipo en <c>.walkie/source.json</c>). Proyectos ficticios.
/// </summary>
public sealed class AppScopeTests
{
    [Fact]
    public void Dos_apps_React_con_la_misma_ruta_son_dos_pantallas_con_su_navegacion_y_sus_llamadas()
    {
        using var project = new TempProject().Shop("tienda", "tienda-web", "ventas").Shop("admin", "admin-web", "compras");

        var result = project.Analyze();

        // 1 y 4: rutas anidadas iguales en dos apps, cada una con su clave y su app.
        Assert.Equal(
            ["screen:admin:/pedidos", "screen:admin:/pedidos/{}", "screen:tienda:/pedidos", "screen:tienda:/pedidos/{}"],
            result.Keys("screen"));
        Assert.Equal("tienda", result.EntityOf("screen:tienda:/pedidos/{}")!["app"]!.GetValue<string>());
        Assert.DoesNotContain("ambiguous-route", result.LimitationCodes());

        // La navegación queda dentro de cada app.
        var navigation = result.RelationKeys().Where(k => k.StartsWith("navigates:", StringComparison.Ordinal)).ToArray();
        Assert.Equal(
            ["navigates:screen:admin:/pedidos->screen:admin:/pedidos/{}", "navigates:screen:tienda:/pedidos->screen:tienda:/pedidos/{}"],
            navigation);

        // 5: cada llamada sale de la pantalla de su app.
        var calls = result.RelationKeys().Where(k => k.StartsWith("calls:", StringComparison.Ordinal)).ToArray();
        Assert.Equal(
            ["calls:screen:admin:/pedidos->api:GET /api/compras", "calls:screen:tienda:/pedidos->api:GET /api/ventas"],
            calls);
        Assert.Equal(["screen:tienda:/pedidos"], result.EntityOf("api:GET /api/ventas")!["derivedFrom"]!.AsArray().Select(k => k!.GetValue<string>()));
    }

    [Fact]
    public void Dos_candidatos_a_feature_con_el_mismo_nombre_en_dos_apps_son_dos_con_sus_miembros()
    {
        using var project = new TempProject().Shop("tienda", "tienda-web", "ventas").Shop("admin", "admin-web", "compras");

        var result = project.Analyze();

        Assert.Equal(["feature:admin:Pedidos", "feature:tienda:Pedidos"], result.Keys("feature"));
        var tienda = result.EntityOf("feature:tienda:Pedidos")!;
        Assert.Equal("tienda", tienda["app"]!.GetValue<string>());
        Assert.Equal(
            ["api:GET /api/ventas", "screen:tienda:/pedidos", "screen:tienda:/pedidos/{}"],
            tienda["members"]!.AsArray().Select(m => m!.GetValue<string>()));
        Assert.Equal(
            ["screen:admin:/pedidos", "screen:admin:/pedidos/{}"],
            result.EntityOf("feature:admin:Pedidos")!["derivedFrom"]!.AsArray().Select(m => m!.GetValue<string>()));
    }

    [Fact]
    public void React_y_Angular_con_pedidos_en_un_monorepo_son_dos_pantallas()
    {
        using var project = new TempProject().React().AngularStandalone();

        var keys = project.Analyze().Keys("screen");

        Assert.Contains("screen:web:/pedidos", keys);
        Assert.Contains("screen:ng:/pedidos", keys);
    }

    [Fact]
    public void Repetir_el_analisis_de_un_monorepo_da_el_mismo_paquete_byte_a_byte()
    {
        using var project = new TempProject().Shop("tienda", "tienda-web", "ventas").Shop("admin", "admin-web", "compras");
        var first = Path.Combine(project.Parent, "a.walkiepack");
        var second = Path.Combine(project.Parent, "b.walkiepack");

        ProjectAnalyzer.Write(project.Analyze(), first, new AnalyzerLimits());
        ProjectAnalyzer.Write(project.Analyze(), second, new AnalyzerLimits());

        Assert.Equal(File.ReadAllBytes(first), File.ReadAllBytes(second));
    }

    [Fact]
    public void Una_app_en_la_raiz_tiene_ambito_punto()
    {
        using var project = new TempProject().Shop("", "raiz", "ventas");

        Assert.Equal(["screen:.:/pedidos", "screen:.:/pedidos/{}"], project.Analyze().Keys("screen"));
    }

    [Fact]
    public void Renombrar_el_paquete_no_cambia_la_identidad_y_mover_la_carpeta_si_salvo_que_se_fije_el_ambito()
    {
        using var original = new TempProject().Shop("web", "tienda-web", "ventas");
        using var renamed = new TempProject().Shop("web", "otra-tienda", "ventas");
        using var moved = new TempProject().Shop("apps/web", "tienda-web", "ventas");
        using var pinned = new TempProject().Shop("apps/web", "tienda-web", "ventas")
            .Write(".walkie/source.json", """{ "id": "0198f0c0-aaaa-7000-8000-00000000c0de", "apps": { "apps/web": "web" } }""");

        var keys = original.Analyze().Keys("screen");

        Assert.Equal(keys, renamed.Analyze().Keys("screen"));
        Assert.Equal(["screen:apps/web:/pedidos", "screen:apps/web:/pedidos/{}"], moved.Analyze().Keys("screen"));
        Assert.Equal(keys, pinned.Analyze().Keys("screen"));
        Assert.Equal(original.Analyze().Keys("feature"), pinned.Analyze().Keys("feature"));
    }

    [Theory]
    [InlineData("""{ "apps": { "web": "con:dos puntos" } }""")]
    [InlineData("""{ "apps": { "web": "" } }""")]
    [InlineData("""{ "apps": ["web"] }""")]
    [InlineData("""{ "apps": { "web": "admin" } }""")] // repite el ámbito por defecto de la otra app
    public void Un_ambito_invalido_o_repetido_en_source_json_detiene_el_analisis(string sourceJson)
    {
        using var project = new TempProject().Shop("web", "tienda-web", "ventas").Shop("admin", "admin-web", "compras")
            .Write(".walkie/source.json", sourceJson);

        var error = Assert.Throws<AnalyzerException>(() => project.Analyze());

        Assert.Equal("invalid-source-file", error.Code);
    }

    [Fact]
    public void La_misma_API_publicada_por_dos_servicios_conserva_su_clave_y_se_avisa()
    {
        using var project = new TempProject().Backend("Ventas.Api").Backend("Compras.Api");

        var result = project.Analyze();

        Assert.Contains("api:GET /api/salud", result.Keys("api"));
        Assert.Contains("exposes:service:Compras.Api->api:GET /api/salud", result.RelationKeys());
        Assert.Contains("exposes:service:Ventas.Api->api:GET /api/salud", result.RelationKeys());
        var limitation = result.Manifest["limitations"]!.AsArray().Single(l => l!["code"]!.GetValue<string>() == "ambiguous-api")!;
        Assert.Contains("Compras.Api, Ventas.Api", limitation["message"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal("complete", result.Manifest["completeness"]!.GetValue<string>()); // un aviso, no deja el análisis parcial
    }

    [Fact]
    public void Un_detector_sin_nada_que_mirar_corre_y_uno_excluido_queda_skipped()
    {
        using var project = new TempProject().Shop("web", "tienda-web", "ventas");

        var all = project.Analyze();
        var some = project.Analyze(o => o with { Detectors = new HashSet<string> { "package-json", "react-router" } });

        // 11: no aplica (no hay Angular) = ran con su motivo; excluido con --detectors = skipped.
        var angular = Detector(all, "angular-router");
        Assert.Equal("ran", angular["status"]!.GetValue<string>());
        Assert.Contains("Angular", angular["reason"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal("complete", all.Manifest["completeness"]!.GetValue<string>());
        Assert.Equal("skipped", Detector(some, "angular-router")["status"]!.GetValue<string>());
        Assert.Equal("partial", some.Manifest["completeness"]!.GetValue<string>());
    }

    private static JsonObject Detector(AnalysisResult result, string id) =>
        result.Manifest["detectors"]!.AsArray().Single(d => d!["id"]!.GetValue<string>() == id)!.AsObject();
}

internal static class AppScopeFixtures
{
    /// <summary>Una app React en <paramref name="dir"/> con /pedidos y su detalle (anidado), un Link y una llamada a /api/<paramref name="api"/>.</summary>
    public static TempProject Shop(this TempProject project, string dir, string name, string api)
    {
        var prefix = dir.Length == 0 ? "" : dir + "/";
        return project
            .Write(prefix + "package.json", $$"""{ "name": "{{name}}", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""")
            .Write(prefix + "src/main.tsx", """
                import { createBrowserRouter } from 'react-router-dom';
                import { Pedidos, Pedido } from './pages';
                export const router = createBrowserRouter([
                  { path: '/pedidos', element: <Pedidos />, children: [{ path: ':id', element: <Pedido /> }] },
                ]);
                """)
            .Write(prefix + "src/pages.tsx", $$"""
                import { Link } from 'react-router-dom';
                export function Pedidos() {
                  fetch('/api/{{api}}');
                  return <Link to="/pedidos/1">ver</Link>;
                }
                export const Pedido = () => null;
                """);
    }

    /// <summary>Un servicio ASP.NET Core en <c>src/&lt;name&gt;</c> que publica <c>GET /api/salud</c>.</summary>
    public static TempProject Backend(this TempProject project, string name) => project
        .Write($"src/{name}/{name}.csproj", """<Project Sdk="Microsoft.NET.Sdk.Web"></Project>""")
        .Write($"src/{name}/Program.cs", """
            var app = WebApplication.CreateBuilder(args).Build();
            app.MapGet("/api/salud", () => "ok");
            app.Run();
            """);
}
