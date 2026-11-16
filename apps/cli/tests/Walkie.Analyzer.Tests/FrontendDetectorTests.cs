using System.Text.Json.Nodes;
using Walkie.Analyzer.Detectors;
using Walkie.Analyzer.Frontend;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Front (spec walkie-live, tarea 8; ADR-0013): React Router, Next.js, Angular, llamadas HTTP, navegación y candidatos a
/// feature, con proyectos ficticios (una tienda inventada). Lo esperado se escribe a mano: es la verdad de cada fixture.
/// </summary>
public sealed class FrontendDetectorTests
{
    // ---------- Escáner: casos difíciles ----------

    [Theory]
    [InlineData("const s = 'x'; // <Route path=\"/comentada\" element={<A />} />\nexport const r = <Route path=\"/real\" element={<A />} />;", "/real")]
    [InlineData("const t = <p>Don't use '/no' here, it's fine</p>;\nexport const r = <Route path=\"/tras-apostrofes\" element={<A />} />;", "/tras-apostrofes")]
    [InlineData("const re = /path: '\\/regex'/g; const x = a / b / 2;\nexport const r = <Route path=\"/tras-regex\" element={<A />} />;", "/tras-regex")]
    [InlineData("const n = `x${`y${'}'}`}z`;\nexport const r = <Route path=\"/tras-plantillas\" element={<A />} />;", "/tras-plantillas")]
    [InlineData("const id = <T,>(x: T): T => x;\nexport const r = <Route path=\"/tras-generico\" element={<A />} />;", "/tras-generico")]
    [InlineData("export const m = <Menu<App> items={[]} />;\nexport const r = <Route path=\"/tras-tipo-jsx\" element={<A />} />;", "/tras-tipo-jsx")]
    [InlineData("export const r = <Routes>{/* <Route path=\"/en-comentario-jsx\" /> */}{a < b ? <Route path=\"/condicional\" element={<A />} /> : null}</Routes>;", "/condicional")]
    public void El_escaner_encuentra_la_ruta_real_y_no_las_de_comentarios_textos_ni_regex(string code, string expected)
    {
        var facts = ScriptFacts.Read("import { Route, Routes } from 'react-router-dom';\n" + code, jsx: true);

        Assert.False(facts.HasErrors);
        Assert.Equal([expected], facts.Routes.Select(r => r.Path));
    }

    [Fact]
    public void Un_tipo_con_path_no_es_una_ruta()
    {
        var facts = ScriptFacts.Read("""
            import { Routes } from '@angular/router';
            type Meta = { path: string, component: unknown };
            interface Otra { path: string; children?: Otra[] }
            export const routes: Routes = [{ path: 'real', component: RealComponent }];
            """, jsx: false);

        Assert.Equal(["real"], facts.Routes.Select(r => r.Path));
        Assert.DoesNotContain(facts.Routes, r => r.Dynamic is not null);
    }

    [Fact]
    public void Las_llamadas_se_leen_con_genericos_anidados_plantillas_constantes_y_sumas()
    {
        var facts = ScriptFacts.Read("""
            import axios from 'axios';
            import { HttpClient } from '@angular/common/http';
            const BASE = '/api/v2';
            const api = axios.create({ baseURL: '/api/v3' });
            export class Datos {
              constructor(private http: HttpClient) {}
              a() { return this.http.get<Array<Map<string, Array<number>>>>('/api/generico'); }
              b(id: string) { return fetch(`${BASE}/facturas/${id}?q=1`, { method: 'PUT' }); }
              c(pedido: { id: string }) { return axios.delete('/api/pedidos/' + pedido.id); }
              d() { return api.get('/items'); }
              e(url: string) { return fetch(url); }
              f() { return fetch('https://otro.example.com/x'); }
              g() { /* fetch('/api/comentada') */ return axios.post('api/relativa', {}); }
            }
            """, jsx: false);

        Assert.Equal(
            ["GET /api/generico", "PUT /api/v2/facturas/{id}?q=1", "DELETE /api/pedidos/{id}", "GET /api/v3/items", "POST /api/relativa"],
            facts.Http.Where(h => h.Path is not null && !h.External).Select(h => $"{h.Method} {h.Path}"));
        Assert.Contains(facts.Http, h => h.Unresolved == "url");
        Assert.Contains(facts.Http, h => h.External);
        Assert.Contains(facts.Http, h => h.Relative && h.Path == "/api/relativa");
    }

    [Fact]
    public void Un_archivo_roto_marca_error_sin_tragarse_lo_que_pudo_leer()
    {
        var facts = ScriptFacts.Read("""
            import { Route } from 'react-router-dom';
            export const ok = <Route path="/antes" element={<A />} />;
            export function Roto() { return <div><Route path="/rota" element={<X />
            """, jsx: true);

        Assert.True(facts.HasErrors);
        Assert.Contains(facts.Routes, r => r.Path == "/antes");
    }

    // ---------- React Router ----------

    [Fact]
    public void React_Router_da_pantallas_con_rutas_anidadas_indice_lazy_y_titulo_del_componente()
    {
        using var project = new TempProject().React();

        var result = project.Analyze();

        Assert.Equal(
            ["screen:web:/", "screen:web:/admin", "screen:web:/admin/usuarios", "screen:web:/admin/usuarios/{}", "screen:web:/clientes", "screen:web:/login", "screen:web:/pedidos", "screen:web:/pedidos/{}"],
            result.Keys("screen"));
        var home = result.EntityOf("screen:web:/")!;
        Assert.Equal("Home", home["title"]!.GetValue<string>()); // el índice gana al layout en la misma ruta
        var pedido = result.EntityOf("screen:web:/pedidos/{}")!;
        Assert.Equal("/pedidos/:pedidoId", pedido["route"]!.GetValue<string>());
        Assert.Equal("observed", pedido["basis"]!.GetValue<string>());
        Assert.Equal("medium", pedido["confidence"]!.GetValue<string>());
        Assert.Equal("react", pedido["technology"]!.GetValue<string>());
        var evidence = Evidence(result, pedido);
        Assert.Equal("react-router", evidence["detector"]!.GetValue<string>());
        Assert.Equal("web/src/main.tsx", evidence["path"]!.GetValue<string>());
        Assert.Equal(15, evidence["lines"]!["start"]!.GetValue<int>());
        Assert.Contains("dynamic-route", result.LimitationCodes());
        Assert.Equal("Usuario", result.EntityOf("screen:web:/admin/usuarios/{}")!["title"]!.GetValue<string>());
        Assert.Contains("service:tienda-web", result.Keys("service"));
    }

    [Fact]
    public void Un_componente_sin_ruta_no_es_pantalla_y_un_Link_desde_una_pantalla_es_navegacion()
    {
        using var project = new TempProject().React();

        var result = project.Analyze();

        Assert.DoesNotContain("screen:web:/menu", result.Keys());
        Assert.Contains("navigates:screen:web:/pedidos->screen:web:/pedidos/{}", result.RelationKeys());
        Assert.Contains("navigates:screen:web:/pedidos->screen:web:/login", result.RelationKeys());
    }

    // ---------- Llamadas HTTP ----------

    [Fact]
    public void Las_llamadas_de_una_pantalla_son_calls_desde_ella_y_las_de_otros_archivos_desde_la_app()
    {
        using var project = new TempProject().React();

        var result = project.Analyze();

        Assert.Contains("calls:screen:web:/pedidos->api:GET /api/pedidos", result.RelationKeys());
        Assert.Contains("calls:screen:web:/pedidos->api:POST /api/pedidos", result.RelationKeys());
        Assert.Contains("calls:screen:web:/pedidos->api:DELETE /api/pedidos/{}", result.RelationKeys());
        Assert.Contains("calls:service:tienda-web->api:GET /api/pedidos/{}", result.RelationKeys()); // el loader está en main.tsx
        var api = result.EntityOf("api:DELETE /api/pedidos/{}")!;
        Assert.Equal("inferred", api["basis"]!.GetValue<string>());
        Assert.Equal("/api/pedidos/{id}", api["http"]!["path"]!.GetValue<string>());
        Assert.Equal(["screen:web:/pedidos"], api["derivedFrom"]!.AsArray().Select(k => k!.GetValue<string>()));
        Assert.Contains("dynamic-http-url", result.LimitationCodes());
        Assert.DoesNotContain(result.Keys("api"), k => k.Contains("comentada", StringComparison.Ordinal));
    }

    [Fact]
    public void Con_dos_pantallas_en_un_archivo_cada_llamada_y_cada_Link_son_de_su_componente()
    {
        using var project = new TempProject()
            .Write("web/package.json", """{ "name": "w", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0" } }""")
            .Write("web/src/main.tsx", """
                import { createBrowserRouter } from 'react-router-dom';
                import { Lista, Detalle } from './pages';
                export const router = createBrowserRouter([{ path: '/pedidos', element: <Lista /> }, { path: '/pedidos/:id', element: <Detalle /> }]);
                """)
            .Write("web/src/pages.tsx", """
                import { Link } from 'react-router-dom';
                const suelta = fetch('/api/al-cargar');
                export function Lista() { fetch('/api/pedidos', { method: 'POST' }); return <Link to="/pedidos/1">Ver</Link>; }
                export const Detalle = ({ id }: { id: string }) => { fetch(`/api/pedidos/${id}`); return <Link to="/pedidos">Volver</Link>; };
                """);

        var result = project.Analyze();

        Assert.Equal(
            ["calls:screen:web:/pedidos->api:POST /api/pedidos", "calls:screen:web:/pedidos/{}->api:GET /api/pedidos/{}", "calls:service:w->api:GET /api/al-cargar"],
            result.RelationKeys().Where(k => k.StartsWith("calls:", StringComparison.Ordinal)));
        Assert.Equal(
            ["navigates:screen:web:/pedidos->screen:web:/pedidos/{}", "navigates:screen:web:/pedidos/{}->screen:web:/pedidos"],
            result.RelationKeys().Where(k => k.StartsWith("navigates:", StringComparison.Ordinal)));
    }

    [Fact]
    public void Una_llamada_a_una_API_que_el_backend_ya_descubrio_usa_esa_misma_API_sin_duplicarla()
    {
        using var project = new TempProject().Dotnet().React();

        var result = project.Analyze();

        // ASP.NET Core declara GET /api/pedidos/{pedidoId:guid}; el front llama a `/api/pedidos/${params.pedidoId}`.
        var api = result.EntityOf("api:GET /api/pedidos/{}")!;
        Assert.Equal("observed", api["basis"]!.GetValue<string>());
        Assert.Equal(1, result.Keys("api").Count(k => k == "api:GET /api/pedidos/{}"));
        Assert.False(api.ContainsKey("derivedFrom"));
        Assert.Contains("exposes:service:Tienda.Api->api:GET /api/pedidos/{}", result.RelationKeys());
        Assert.Contains("calls:service:tienda-web->api:GET /api/pedidos/{}", result.RelationKeys());
    }

    [Fact]
    public void Una_llamada_a_otro_dominio_se_avisa_sin_dejar_el_analisis_parcial_por_eso()
    {
        using var project = new TempProject()
            .Write("web/package.json", """{ "name": "w", "dependencies": { "react": "^19.0.0" } }""")
            .Write("web/src/x.ts", "export const f = () => fetch('https://api.example.com/precios');");

        var result = project.Analyze();

        Assert.Contains("external-http-url", result.LimitationCodes());
        Assert.Empty(result.Keys("api"));
        Assert.False(result.Partial);
    }

    // ---------- Next.js ----------

    [Fact]
    public void Next_App_Router_da_pantallas_por_carpetas_y_sus_route_handlers_son_APIs_de_la_app()
    {
        using var project = new TempProject()
            .Write("next/package.json", """{ "name": "tienda-next", "dependencies": { "next": "15.0.0", "react": "^19.0.0" } }""")
            .Write("next/app/page.tsx", "export default function Inicio() { return <main />; }")
            .Write("next/app/(tienda)/pedidos/page.tsx", "import Link from 'next/link';\nexport default function P() { return <Link href=\"/pedidos/1\">Uno</Link>; }")
            .Write("next/app/(tienda)/pedidos/[id]/page.tsx", "export default function P() { return null; }")
            .Write("next/app/docs/[...slug]/page.tsx", "export default function D() { return null; }")
            .Write("next/app/_privado/page.tsx", "export default function X() { return null; }")
            .Write("next/app/@modal/login/page.tsx", "export default function M() { return null; }")
            .Write("next/app/layout.tsx", "export default function L({ children }) { return children; }")
            .Write("next/app/api/pedidos/route.ts", "export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }");

        var result = project.Analyze();

        Assert.Equal(["screen:next:/", "screen:next:/docs/{}", "screen:next:/pedidos", "screen:next:/pedidos/{}"], result.Keys("screen"));
        Assert.Equal("high", result.EntityOf("screen:next:/pedidos/{}")!["confidence"]!.GetValue<string>());
        Assert.Equal("/pedidos/[id]", result.EntityOf("screen:next:/pedidos/{}")!["route"]!.GetValue<string>());
        Assert.Equal(["api:GET /api/pedidos", "api:POST /api/pedidos"], result.Keys("api"));
        Assert.Equal("observed", result.EntityOf("api:GET /api/pedidos")!["basis"]!.GetValue<string>());
        Assert.Contains("exposes:service:tienda-next->api:POST /api/pedidos", result.RelationKeys());
        Assert.Contains("navigates:screen:next:/pedidos->screen:next:/pedidos/{}", result.RelationKeys());
    }

    [Fact]
    public void Next_Pages_Router_omite_app_document_y_errores_y_avisa_de_pages_api()
    {
        using var project = new TempProject()
            .Write("site/package.json", """{ "name": "site", "dependencies": { "next": "14.2.0", "react": "^18.0.0" } }""")
            .Write("site/pages/index.tsx", "export default function I() { return null; }")
            .Write("site/pages/pedidos/index.tsx", "export default function P() { return null; }")
            .Write("site/pages/pedidos/[id].tsx", "export default function P() { return null; }")
            .Write("site/pages/_app.tsx", "export default function A() { return null; }")
            .Write("site/pages/_document.tsx", "export default function D() { return null; }")
            .Write("site/pages/404.tsx", "export default function N() { return null; }")
            .Write("site/pages/api/hola.ts", "export default function handler(req, res) { res.json({}); }");

        var result = project.Analyze();

        Assert.Equal(["screen:site:/", "screen:site:/pedidos", "screen:site:/pedidos/{}"], result.Keys("screen"));
        Assert.Contains("next-pages-api", result.LimitationCodes());
        Assert.Empty(result.Keys("api"));
    }

    // ---------- Angular ----------

    [Fact]
    public void Angular_standalone_sigue_loadChildren_y_loadComponent_y_su_servicio_llama_desde_la_app()
    {
        using var project = new TempProject().AngularStandalone();

        var result = project.Analyze();

        Assert.Equal(
            ["screen:ng:/", "screen:ng:/admin", "screen:ng:/admin/usuarios", "screen:ng:/pedidos", "screen:ng:/pedidos/{}", "screen:ng:/perfil"],
            result.Keys("screen"));
        Assert.Equal("Pedido detalle", result.EntityOf("screen:ng:/pedidos/{}")!["title"]!.GetValue<string>());
        Assert.Equal("angular", result.EntityOf("screen:ng:/perfil")!["technology"]!.GetValue<string>());
        Assert.Contains("calls:service:tienda-angular->api:GET /api/pedidos", result.RelationKeys());
        Assert.Contains("calls:service:tienda-angular->api:PUT /api/pedidos/{}", result.RelationKeys());
        Assert.Contains("navigates:screen:ng:/pedidos->screen:ng:/perfil", result.RelationKeys()); // routerLink de la plantilla
        Assert.Contains("navigates:screen:ng:/pedidos->screen:ng:/pedidos/{}", result.RelationKeys()); // [routerLink]="['/pedidos', p.id]"
        Assert.Contains("dynamic-http-url", result.LimitationCodes());
        Assert.DoesNotContain(result.Keys(), k => k.StartsWith("module:", StringComparison.Ordinal));
    }

    [Fact]
    public void Angular_con_NgModules_monta_las_rutas_forChild_del_modulo_cargado_en_diferido()
    {
        using var project = new TempProject().AngularNgModule(withModule: true);

        var result = project.Analyze();

        Assert.Equal(["screen:ventas:/inicio", "screen:ventas:/ventas", "screen:ventas:/ventas/{}"], result.Keys("screen"));
        Assert.Contains("calls:screen:ventas:/ventas->api:GET /api/ventas/resumen", result.RelationKeys());
        Assert.Contains("navigates:screen:ventas:/ventas->screen:ventas:/inicio", result.RelationKeys());
        Assert.DoesNotContain("lazy-routes-unresolved", result.LimitationCodes());
        Assert.DoesNotContain(result.Keys(), k => k.StartsWith("module:", StringComparison.Ordinal)); // un NgModule no es un módulo de Walkie
    }

    [Fact]
    public void Si_el_modulo_diferido_no_se_encuentra_sus_rutas_no_se_cuelgan_de_la_raiz()
    {
        using var project = new TempProject().AngularNgModule(withModule: false);

        var result = project.Analyze();

        Assert.Equal(["screen:ventas:/inicio"], result.Keys("screen"));
        Assert.Contains("lazy-routes-unresolved", result.LimitationCodes());
        Assert.True(result.Partial);
    }

    // ---------- Candidatos a feature ----------

    [Fact]
    public void Las_features_se_proponen_por_carga_diferida_o_por_recurso_con_sus_pantallas_y_APIs()
    {
        using var project = new TempProject().React().AngularNgModule(withModule: true);

        var result = project.Analyze();

        var pedidos = result.EntityOf("feature:web:Pedidos")!;
        Assert.Equal("inferred", pedidos["basis"]!.GetValue<string>());
        Assert.Equal("low", pedidos["confidence"]!.GetValue<string>());
        Assert.Equal(
            ["api:DELETE /api/pedidos/{}", "api:GET /api/pedidos", "api:POST /api/pedidos", "screen:web:/pedidos", "screen:web:/pedidos/{}"],
            pedidos["members"]!.AsArray().Select(m => m!.GetValue<string>()));
        Assert.Contains("comparten el recurso «pedidos»", pedidos["description"]!.GetValue<string>(), StringComparison.Ordinal);
        var ventas = result.EntityOf("feature:ventas:Ventas")!;
        Assert.Equal("medium", ventas["confidence"]!.GetValue<string>());
        Assert.Contains("se cargan juntas", ventas["description"]!.GetValue<string>(), StringComparison.Ordinal);
        // Una pantalla sola (login, clientes, perfil) o la raíz no proponen nada.
        Assert.DoesNotContain("feature:web:Login", result.Keys());
        Assert.DoesNotContain("feature:web:Clientes", result.Keys());
        Assert.Equal(["frontend-features"], Evidence(result, pedidos)["detector"]!.GetValue<string>() is var d ? [d] : []);
    }

    // ---------- Monorepo, parcial y robustez ----------

    [Fact]
    public void En_un_monorepo_cada_app_es_un_servicio_y_la_misma_ruta_en_dos_apps_son_dos_pantallas()
    {
        using var project = new TempProject().React().AngularStandalone();

        var result = project.Analyze();

        Assert.Contains("service:tienda-web", result.Keys("service"));
        Assert.Contains("service:tienda-angular", result.Keys("service"));
        // Aceptación 2 (ADR-0014): /pedidos en React y en Angular son dos pantallas, cada una con su app y su evidencia.
        Assert.Contains("screen:web:/pedidos", result.Keys("screen"));
        Assert.Contains("screen:ng:/pedidos", result.Keys("screen"));
        Assert.Equal("web", result.EntityOf("screen:web:/pedidos")!["app"]!.GetValue<string>());
        Assert.Equal("ng", result.EntityOf("screen:ng:/pedidos")!["app"]!.GetValue<string>());
        Assert.All(EvidencePaths(result, "screen:web:/pedidos"), p => Assert.StartsWith("web/", p, StringComparison.Ordinal));
        Assert.All(EvidencePaths(result, "screen:ng:/pedidos"), p => Assert.StartsWith("ng/", p, StringComparison.Ordinal));
        Assert.DoesNotContain("ambiguous-route", result.LimitationCodes());
    }

    [Fact]
    public void Con_solo_algunos_detectores_el_analisis_es_parcial_y_no_hay_llamadas()
    {
        using var project = new TempProject().React();

        var result = project.Analyze(o => o with { Detectors = new HashSet<string> { "package-json", "react-router" } });

        Assert.True(result.Partial);
        Assert.Equal("skipped", result.Detectors.Single(d => d.Id == "frontend-http").Status);
        Assert.NotEmpty(result.Keys("screen"));
        Assert.DoesNotContain(result.RelationKeys(), k => k.StartsWith("calls:", StringComparison.Ordinal));
    }

    [Fact]
    public void Sin_apps_de_front_los_detectores_corren_y_dicen_por_que_no_encontraron_nada()
    {
        using var project = new TempProject().Dotnet();

        var result = project.Analyze();

        foreach (var id in new[] { "nextjs", "react-router", "angular-router", "frontend-http", "frontend-features" })
        {
            var run = result.Detectors.Single(d => d.Id == id);
            Assert.Equal("ran", run.Status);
            Assert.NotNull(run.Reason);
        }
    }

    [Fact]
    public void Un_archivo_roto_queda_como_limitacion_y_el_resto_se_analiza()
    {
        using var project = new TempProject().React().Write("web/src/Roto.tsx", "export function Roto() { return <div><span>sin cerrar ;");

        var result = project.Analyze();

        Assert.Contains("unparsed-file", result.LimitationCodes());
        Assert.Contains("screen:web:/pedidos", result.Keys());
        Assert.True(result.Partial);
    }

    [Fact]
    public void Vue_y_otros_enrutadores_quedan_como_no_analizados()
    {
        using var project = new TempProject()
            .Write("vue/package.json", """{ "name": "v", "dependencies": { "vue": "^3.5.0" } }""")
            .Write("tan/package.json", """{ "name": "t", "dependencies": { "react": "^19.0.0", "@tanstack/react-router": "^1.0.0" } }""");

        var result = project.Analyze();

        Assert.Equal(2, result.LimitationCodes().Count(c => c == "frontend-semantics-not-analyzed"));
        Assert.True(result.Partial);
    }

    [Fact]
    public void Las_pruebas_no_dan_pantallas_ni_llamadas()
    {
        using var project = new TempProject().React()
            .Write("web/src/pages/Pedidos.test.tsx", "import { Route } from 'react-router-dom';\nconst r = <Route path=\"/de-prueba\" element={<A />} />; fetch('/api/de-prueba');");

        var result = project.Analyze();

        Assert.DoesNotContain(result.Keys(), k => k.Contains("de-prueba", StringComparison.Ordinal));
    }

    // ---------- Identidad estable y determinismo ----------

    [Fact]
    public void Mover_lineas_reformatear_renombrar_variables_y_reordenar_no_cambia_claves_ni_fingerprints()
    {
        using var original = new TempProject().React();
        using var moved = new TempProject().React(reformatted: true);

        var a = original.Analyze();
        var b = moved.Analyze();

        Assert.Equal(a.Keys(), b.Keys());
        Assert.Equal(Fingerprints(a), Fingerprints(b));
        Assert.Equal(a.RelationKeys(), b.RelationKeys());
    }

    [Fact]
    public void Cambiar_una_ruta_cambia_su_clave_y_la_anterior_deja_de_aparecer()
    {
        using var before = new TempProject().React();
        using var after = new TempProject().React(renamedRoute: true);

        var a = before.Analyze().Keys("screen");
        var b = after.Analyze().Keys("screen");

        Assert.Contains("screen:web:/login", a);
        Assert.DoesNotContain("screen:web:/login", b);
        Assert.Contains("screen:web:/ingresar", b);
    }

    [Fact]
    public void El_mismo_arbol_da_el_mismo_paquete_byte_a_byte()
    {
        using var project = new TempProject().React().AngularStandalone();
        var first = Path.Combine(project.Parent, "a.walkiepack");
        var second = Path.Combine(project.Parent, "b.walkiepack");

        ProjectAnalyzer.Write(project.Analyze(), first, new AnalyzerLimits());
        ProjectAnalyzer.Write(project.Analyze(), second, new AnalyzerLimits());

        Assert.Equal(File.ReadAllBytes(first), File.ReadAllBytes(second));
    }

    [Fact]
    public void La_evidencia_no_lleva_codigo()
    {
        using var project = new TempProject().React();

        var result = project.Analyze();

        Assert.DoesNotContain(result.Discovery["evidence"]!.AsArray(), e => e!.AsObject().ContainsKey("snippet"));
        Assert.DoesNotContain("useState", result.Text(), StringComparison.Ordinal);
        Assert.DoesNotContain("JSON.stringify", result.Text(), StringComparison.Ordinal);
    }

    // ---------- Ayudas ----------

    private static JsonObject Evidence(AnalysisResult result, JsonObject entity)
    {
        var id = entity["evidence"]!.AsArray()[0]!.GetValue<string>();
        return result.Discovery["evidence"]!.AsArray().Single(e => e!["id"]!.GetValue<string>() == id)!.AsObject();
    }

    private static IEnumerable<string> EvidencePaths(AnalysisResult result, string key)
    {
        var ids = result.EntityOf(key)!["evidence"]!.AsArray().Select(e => e!.GetValue<string>()).ToHashSet();
        return result.Discovery["evidence"]!.AsArray().Where(e => ids.Contains(e!["id"]!.GetValue<string>())).Select(e => e!["path"]!.GetValue<string>());
    }

    private static string[] Fingerprints(AnalysisResult result) =>
        [.. result.Discovery["entities"]!.AsArray().Select(e => e!["fingerprint"]!.GetValue<string>())];
}

/// <summary>Proyectos de front ficticios para <see cref="FrontendDetectorTests"/>.</summary>
internal static class FrontendFixtures
{
    /// <summary>
    /// Una app React con React Router: rutas por objetos (anidadas, índice, lazy, Component, dinámica, comodín) y JSX,
    /// una página que llama con fetch y axios y navega con Link, y un menú que no es pantalla.
    /// </summary>
    public static TempProject React(this TempProject project, bool reformatted = false, bool renamedRoute = false)
    {
        var login = renamedRoute ? "/ingresar" : "/login";
        var main = reformatted
            ? $$"""
                import { createBrowserRouter } from 'react-router-dom';
                import { Pedidos } from './pages/Pedidos';
                import { Pedido } from './pages/Pedido';
                import { Layout, Home, Login } from './shell';
                import { Admin, Usuarios, Usuario } from './admin';



                const otraRuta = window.location.hash;
                export const enrutador = createBrowserRouter([
                  { path: '{{login}}', Component: Login },
                  {
                    element: <Layout />,
                    path: '/',
                    children: [
                      { path: 'pedidos/:pedidoId', loader: ({ params }) => fetch(`/api/pedidos/${params.pedidoId}`), element: <Pedido /> },
                      { path: 'pedidos', element: <Pedidos /> },
                      { element: <Home />, index: true },
                      { lazy: () => import('./pages/Clientes'), path: 'clientes' },
                      { path: otraRuta, element: <Home /> },
                      { path: '*', element: <Home /> },
                    ],
                  },
                  { path: '/admin', element: <Admin />, children: [{ path: 'usuarios', element: <Usuarios /> }, { path: 'usuarios/:id', element: <Usuario /> }] },
                ]);
                """
            : $$"""
                import { createBrowserRouter } from 'react-router-dom';
                import { Pedidos } from './pages/Pedidos';
                import { Pedido } from './pages/Pedido';
                import { Layout, Home, Login } from './shell';
                import { Admin, Usuarios, Usuario } from './admin';

                const dinamica = window.location.hash;
                export const router = createBrowserRouter([
                  {
                    path: '/',
                    element: <Layout />,
                    children: [
                      { index: true, element: <Home /> },
                      { path: 'pedidos', element: <Pedidos /> },
                      { path: 'pedidos/:pedidoId', element: <Pedido />, loader: ({ params }) => fetch(`/api/pedidos/${params.pedidoId}`) },
                      { path: 'clientes', lazy: () => import('./pages/Clientes') },
                      { path: dinamica, element: <Home /> },
                      { path: '*', element: <Home /> },
                    ],
                  },
                  { path: '{{login}}', Component: Login },
                  { path: '/admin', element: <Admin />, children: [{ path: 'usuarios', element: <Usuarios /> }, { path: 'usuarios/:id', element: <Usuario /> }] },
                ]);
                """;
        return project
            .Write("web/package.json", """{ "name": "tienda-web", "dependencies": { "react": "^19.0.0", "react-router-dom": "^7.0.0", "axios": "^1.7.0" } }""")
            .Write("web/src/main.tsx", main)
            .Write("web/src/shell.tsx", """
                export const Layout = () => <div />;
                export const Home = () => <p>Inicio: don't panic</p>;
                export const Login = () => <form />;
                """)
            .Write("web/src/admin.tsx", "export const Admin = () => null;\nexport const Usuarios = () => null;\nexport const Usuario = () => null;\n")
            .Write("web/src/pages/Pedidos.tsx", $$"""
                import axios from 'axios';
                import { Link } from 'react-router-dom';

                export function Pedidos() {
                  async function crear(p: unknown) { await fetch('/api/pedidos', { method: 'POST', body: JSON.stringify(p) }); }
                  async function borrar(id: string) { await axios.delete(`/api/pedidos/${id}`); }
                  async function otra(url: string) { return fetch(url); }
                  // fetch('/api/comentada')
                  fetch('/api/pedidos');
                  return <ul><Link to="/pedidos/1">Uno</Link><Link to="{{login}}">Salir</Link></ul>;
                }
                """)
            .Write("web/src/pages/Pedido.tsx", "export function Pedido() { return null; }")
            .Write("web/src/pages/Clientes.tsx", "export default function Clientes() { return null; }")
            .Write("web/src/Menu.tsx", "import { Link } from 'react-router-dom';\nexport const Menu = () => <Link to=\"/pedidos\">Pedidos</Link>;");
    }

    /// <summary>Angular standalone: provideRouter, loadChildren a un archivo de rutas, loadComponent, children, redirección y comodín.</summary>
    public static TempProject AngularStandalone(this TempProject project) => project
        .Write("ng/package.json", """{ "name": "tienda-angular", "dependencies": { "@angular/core": "^19.0.0", "@angular/router": "^19.0.0" } }""")
        .Write("ng/src/main.ts", """
            import { bootstrapApplication } from '@angular/platform-browser';
            import { provideRouter } from '@angular/router';
            import { routes } from './app/app.routes';
            bootstrapApplication(AppComponent, { providers: [provideRouter(routes)] });
            """)
        .Write("ng/src/app/app.routes.ts", """
            import { Routes } from '@angular/router';
            import { HomeComponent } from './home/home.component';
            import { PedidosComponent } from './pedidos/pedidos.component';
            import { PedidoDetalleComponent } from './pedidos/pedido-detalle.component';

            export const routes: Routes = [
              { path: '', component: HomeComponent },
              { path: 'pedidos', component: PedidosComponent, children: [{ path: ':id', component: PedidoDetalleComponent }] },
              { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
              { path: 'perfil', loadComponent: () => import('./perfil/perfil.component').then((m) => m.PerfilComponent) },
              { path: 'viejo', redirectTo: 'pedidos' },
              { path: '**', redirectTo: '' },
            ];
            """)
        .Write("ng/src/app/admin/admin.routes.ts", """
            import { Routes } from '@angular/router';
            import { AdminComponent } from './admin.component';
            import { UsuariosComponent } from './usuarios.component';
            export const ADMIN_ROUTES: Routes = [{ path: '', component: AdminComponent }, { path: 'usuarios', component: UsuariosComponent }];
            """)
        .Write("ng/src/app/home/home.component.ts", "export class HomeComponent {}")
        .Write("ng/src/app/admin/admin.component.ts", "export class AdminComponent {}")
        .Write("ng/src/app/admin/usuarios.component.ts", "export class UsuariosComponent {}")
        .Write("ng/src/app/perfil/perfil.component.ts", "export class PerfilComponent {}")
        .Write("ng/src/app/pedidos/pedido-detalle.component.ts", "export class PedidoDetalleComponent {}")
        .Write("ng/src/app/pedidos/pedidos.component.ts", """
            import { Component } from '@angular/core';
            @Component({ selector: 'app-pedidos', templateUrl: './pedidos.component.html' })
            export class PedidosComponent {}
            """)
        .Write("ng/src/app/pedidos/pedidos.component.html", """
            <a routerLink="/perfil">Perfil</a>
            <a [routerLink]="['/pedidos', p.id]" *ngFor="let p of pedidos">{{ p.id }}</a>
            <a routerLink="{{ dinamico }}">No</a>
            """)
        .Write("ng/src/app/pedidos/pedidos.service.ts", """
            import { Injectable, inject } from '@angular/core';
            import { HttpClient } from '@angular/common/http';
            import { environment } from '../../environments/environment';
            @Injectable({ providedIn: 'root' })
            export class PedidosService {
              private readonly http = inject(HttpClient);
              listar() { return this.http.get<Pedido[]>('/api/pedidos'); }
              actualizar(id: string, p: Pedido) { return this.http.put(`/api/pedidos/${id}`, p); }
              clientes() { return this.http.get(`${environment.apiUrl}/clientes`); }
            }
            """);

    /// <summary>Angular con NgModules: forRoot con loadChildren a un NgModule que importa su módulo de rutas forChild.</summary>
    public static TempProject AngularNgModule(this TempProject project, bool withModule)
    {
        project
            .Write("ventas/package.json", """{ "name": "ventas-angular", "dependencies": { "@angular/core": "^17.0.0" } }""")
            .Write("ventas/src/app/app-routing.module.ts", """
                import { NgModule } from '@angular/core';
                import { RouterModule, Routes } from '@angular/router';
                import { InicioComponent } from './inicio.component';
                const routes: Routes = [
                  { path: 'inicio', component: InicioComponent },
                  { path: 'ventas', loadChildren: () => import('./ventas/ventas.module').then((m) => m.VentasModule) },
                  { path: '', redirectTo: 'inicio', pathMatch: 'full' },
                ];
                @NgModule({ imports: [RouterModule.forRoot(routes)], exports: [RouterModule] })
                export class AppRoutingModule {}
                """)
            .Write("ventas/src/app/inicio.component.ts", "export class InicioComponent {}")
            .Write("ventas/src/app/ventas/ventas-routing.module.ts", """
                import { NgModule } from '@angular/core';
                import { RouterModule } from '@angular/router';
                import { VentasComponent } from './ventas.component';
                import { VentaComponent } from './venta.component';
                @NgModule({ imports: [RouterModule.forChild([{ path: '', component: VentasComponent }, { path: ':ventaId', component: VentaComponent }])] })
                export class VentasRoutingModule {}
                """)
            .Write("ventas/src/app/ventas/venta.component.ts", "export class VentaComponent {}")
            .Write("ventas/src/app/ventas/ventas.component.ts", """
                import { Component } from '@angular/core';
                import { Router } from '@angular/router';
                import { HttpClient } from '@angular/common/http';
                @Component({ selector: 'app-ventas', template: `<a routerLink="/inicio">Volver</a>` })
                export class VentasComponent {
                  constructor(private router: Router, private http: HttpClient) {}
                  abrir(id: number) { this.router.navigate(['/ventas', id]); }
                  resumen() { return this.http.get('/api/ventas/resumen'); }
                }
                """);
        return withModule
            ? project.Write("ventas/src/app/ventas/ventas.module.ts", """
                import { NgModule } from '@angular/core';
                import { VentasRoutingModule } from './ventas-routing.module';
                @NgModule({ imports: [VentasRoutingModule] })
                export class VentasModule {}
                """)
            : project;
    }
}
