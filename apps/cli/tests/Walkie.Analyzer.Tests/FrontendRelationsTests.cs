using System.Text.Json.Nodes;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Relaciones del front (spec walkie-live-arquitectura, ADR-0016): envoltorios HTTP (D2), quién hace cada llamada
/// (pantalla → hook → cliente) y navegación con funciones de rutas (D3), con proyectos ficticios (una tienda inventada).
/// Lo esperado se escribe a mano: es la verdad de cada fixture.
/// </summary>
public sealed class FrontendRelationsTests
{
    private const string Package = """{ "name": "tienda-web", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""";

    private const string Routes = """
        import { createBrowserRouter } from 'react-router-dom';
        import { PedidosPage } from './pages/PedidosPage';
        import { PedidoPage } from './pages/PedidoPage';
        import { InicioPage } from './pages/InicioPage';
        import { PEDIDOS_PATH } from './paths';
        export const router = createBrowserRouter([
          { path: '/', element: <InicioPage /> },
          { path: PEDIDOS_PATH, element: <PedidosPage /> },
          { path: '/pedidos/:pedidoId', element: <PedidoPage /> },
        ]);
        """;

    /// <summary>El cliente de Walkie: dos envoltorios hasta un único fetch con base configurable.</summary>
    private const string Client = """
        const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

        async function send(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
          const { token, headers, ...rest } = init;
          const res = await fetch(`${baseUrl}${path}`, { ...rest, headers: { ...headers } });
          return res;
        }

        async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
          const res = await send(path, init);
          return (await res.json()) as T;
        }

        export function listarPedidos(token: string): Promise<Pedido[]> {
          return request('/api/pedidos', { token });
        }

        export function obtenerPedido(token: string, pedidoId: string, signal?: AbortSignal): Promise<Pedido> {
          return request(`/api/pedidos/${encodeURIComponent(pedidoId)}`, { token, signal });
        }

        export function cancelarPedido(token: string, pedidoId: string): Promise<void> {
          return request(`/api/pedidos/${pedidoId}/cancelacion`, { token, method: 'POST' });
        }

        export function salud(): Promise<Response> {
          return send('/api/salud');
        }
        """;

    private const string Hooks = """
        import { listarPedidos, obtenerPedido, cancelarPedido } from './client';
        export function usePedidos() {
          return useQuery({ queryKey: ['pedidos'], queryFn: () => listarPedidos(useToken()) });
        }
        export function usePedido(pedidoId: string) {
          return useQuery({ queryKey: ['pedido', pedidoId], queryFn: ({ signal }) => obtenerPedido(useToken(), pedidoId, signal) });
        }
        export const useCancelar = (pedidoId: string) => useMutation({ mutationFn: () => cancelarPedido(useToken(), pedidoId) });
        """;

    private const string Paths = """
        export const PEDIDOS_PATH = '/pedidos';
        export const pedidoPath = (pedidoId: string) => `/pedidos/${pedidoId}`;
        export function inicioPath(seccion?: string): string {
          return seccion ? `/?seccion=${seccion}` : '/';
        }
        """;

    private static TempProject Shop() => new TempProject()
        .Write("web/package.json", Package)
        .Write("web/src/routes.tsx", Routes)
        .Write("web/src/paths.ts", Paths)
        .Write("web/src/api/client.ts", Client)
        .Write("web/src/api/hooks.ts", Hooks)
        .Write("web/src/pages/PedidosPage.tsx", """
            import { Link } from 'react-router-dom';
            import { usePedidos } from '../api/hooks';
            import { pedidoPath } from '../paths';
            import { FilaPedido } from '../components/FilaPedido';
            export function PedidosPage() {
              const pedidos = usePedidos();
              return <ul>{pedidos.data?.map((p) => <FilaPedido key={p.id} pedido={p} />)}</ul>;
            }
            """)
        .Write("web/src/components/FilaPedido.tsx", """
            import { Link } from 'react-router-dom';
            import { pedidoPath } from '../paths';
            export function FilaPedido({ pedido }: { pedido: Pedido }) {
              return <li><Link to={pedidoPath(pedido.id)}>{pedido.numero}</Link></li>;
            }
            """)
        .Write("web/src/pages/PedidoPage.tsx", """
            import { useNavigate, useParams } from 'react-router-dom';
            import { usePedido, useCancelar } from '../api/hooks';
            import { PEDIDOS_PATH, inicioPath } from '../paths';
            export function PedidoPage() {
              const { pedidoId = '' } = useParams();
              const pedido = usePedido(pedidoId);
              const cancelar = useCancelar(pedidoId);
              const navigate = useNavigate();
              return <button onClick={() => cancelar.mutate(undefined, { onSuccess: () => navigate(PEDIDOS_PATH) })}>Cancelar</button>;
            }
            """)
        .Write("web/src/pages/InicioPage.tsx", """
            import { Link } from 'react-router-dom';
            import { PEDIDOS_PATH } from '../paths';
            export function InicioPage() {
              return <Link to={PEDIDOS_PATH}>Ver pedidos</Link>;
            }
            """);

    private static JsonObject Relation(AnalysisResult result, string key) =>
        result.Discovery["relations"]!.AsArray().Select(r => r!.AsObject()).Single(r => r["key"]!.GetValue<string>() == key);

    [Fact]
    public void Los_envoltorios_del_cliente_dan_la_llamada_con_su_metodo_y_desde_la_pantalla_que_la_usa_por_su_hook()
    {
        using var project = Shop();
        var result = project.Analyze();

        var calls = result.RelationKeys().Where(k => k.StartsWith("calls:", StringComparison.Ordinal)).ToArray();
        Assert.Equal(
        [
            "calls:screen:web:/pedidos->api:GET /api/pedidos",
            "calls:screen:web:/pedidos/{}->api:GET /api/pedidos/{}",
            "calls:screen:web:/pedidos/{}->api:POST /api/pedidos/{}/cancelacion",
            "calls:service:tienda-web->api:GET /api/salud",
        ], calls);

        // Por un hook y dos envoltorios: inferida, con la cadena entera como evidencia.
        var relation = Relation(result, "calls:screen:web:/pedidos/{}->api:GET /api/pedidos/{}");
        Assert.Equal("inferred", relation["basis"]!.GetValue<string>());
        Assert.Equal("medium", relation["confidence"]!.GetValue<string>());
        var evidence = result.Discovery["evidence"]!.AsArray().Select(e => e!.AsObject())
            .Where(e => relation["evidence"]!.AsArray().Select(x => x!.GetValue<string>()).Contains(e["id"]!.GetValue<string>()))
            .Select(e => e["path"]!.GetValue<string>()).Distinct().Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(["web/src/api/client.ts", "web/src/api/hooks.ts", "web/src/pages/PedidoPage.tsx"], evidence);

        // La base configurable y los envoltorios no dejan limitaciones: todo se resolvió.
        Assert.DoesNotContain("dynamic-http-url", result.LimitationCodes());
        Assert.DoesNotContain("http-wrapper-unresolved", result.LimitationCodes());
    }

    [Fact]
    public void La_navegacion_con_funciones_de_rutas_y_desde_un_componente_dibujado_llega_a_la_pantalla()
    {
        using var project = Shop();
        var result = project.Analyze();

        var navigation = result.RelationKeys().Where(k => k.StartsWith("navigates:", StringComparison.Ordinal)).ToArray();
        Assert.Equal(
        [
            "navigates:screen:web:/->screen:web:/pedidos",
            "navigates:screen:web:/pedidos->screen:web:/pedidos/{}",
            "navigates:screen:web:/pedidos/{}->screen:web:/pedidos",
        ], navigation);

        // FilaPedido la dibuja la lista: inferida baja, con el componente en la evidencia.
        var relation = Relation(result, "navigates:screen:web:/pedidos->screen:web:/pedidos/{}");
        Assert.Equal("inferred", relation["basis"]!.GetValue<string>());
        Assert.Equal("low", relation["confidence"]!.GetValue<string>());
    }

    [Fact]
    public void Un_fetch_de_algo_que_arma_el_propio_codigo_no_es_una_llamada_a_la_api_ni_deja_el_analisis_parcial()
    {
        using var project = new TempProject()
            .Write("web/package.json", Package)
            .Write("web/src/imagen.ts", """
                export function fuentes(): Promise<string | undefined> {
                  css ??= (async () => {
                    const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
                    const texto = await (await fetch(link.href)).text();
                    const url = /url\(([^)]+)\)/.exec(texto)?.[1];
                    const blob = await (await fetch(url)).blob();
                    return texto;
                  })();
                  return css;
                }
                export async function svg(element: HTMLElement) {
                  const dataUrl = await toSvg(element);
                  return await (await fetch(dataUrl)).blob();
                }
                """);
        var result = project.Analyze();

        Assert.Contains("non-api-fetch", result.LimitationCodes());
        Assert.DoesNotContain("dynamic-http-url", result.LimitationCodes());
        Assert.Empty(result.Keys("api"));
    }

    private static string[] Calls(AnalysisResult result) =>
        [.. result.RelationKeys().Where(k => k.StartsWith("calls:", StringComparison.Ordinal))];

    [Fact]
    public void Envoltorios_de_un_nivel_con_metodo_como_argumento_alias_constantes_y_funciones_de_rutas()
    {
        using var project = new TempProject()
            .Write("web/package.json", Package)
            .Write("web/src/api.ts", """
                import axios from 'axios';
                const API = '/api/v1';
                export const http = axios.create({ baseURL: '/api' });
                export function request(method: string, path: string, body?: unknown) {
                  return fetch(API + path, { method, body: JSON.stringify(body) });
                }
                export const pedidoUrl = (id: string) => `/pedidos/${id}`;
                """)
            .Write("web/src/servicios.ts", """
                import { request as llamar, http, pedidoUrl } from './api';
                export const pedidosApi = {
                  listar: () => llamar('GET', '/pedidos'),
                  borrar: (id: string) => llamar('DELETE', pedidoUrl(id)),
                  async crear(p: Pedido) { return llamar('POST', '/pedidos', p); },
                };
                export function clientes() { return http.get('/clientes'); }
                export function porNombre(nombre: string) { return llamar(metodo(), `/buscar/${nombre}`); }
                """);
        var result = project.Analyze();

        Assert.Equal(
        [
            "calls:service:tienda-web->api:DELETE /api/v1/pedidos/{}",
            "calls:service:tienda-web->api:GET /api/clientes",
            "calls:service:tienda-web->api:GET /api/v1/pedidos",
            "calls:service:tienda-web->api:POST /api/v1/pedidos",
        ], Calls(result));

        // El método de la búsqueda lo calcula una función: no se adivina.
        Assert.Contains("http-wrapper-unresolved", result.LimitationCodes());
        Assert.True(result.Partial);
    }

    [Fact]
    public void Un_argumento_que_no_se_puede_leer_y_mas_de_tres_envoltorios_quedan_como_limitacion_sin_inventar_la_api()
    {
        using var project = new TempProject()
            .Write("web/package.json", Package)
            .Write("web/src/api.ts", """
                const base = window.location.origin;
                function uno(path: string) { return fetch(`${base}${path}`); }
                function dos(path: string) { return uno(path); }
                function tres(path: string) { return dos(path); }
                function cuatro(path: string) { return tres(path); }
                export function lejana() { return cuatro('/api/lejos'); }
                export function cercana() { return tres('/api/cerca'); }
                export function calculada(ruta: string[]) { return uno(ruta.join('/')); }
                """);
        var result = project.Analyze();

        Assert.Equal(["calls:service:tienda-web->api:GET /api/cerca"], Calls(result));
        var limitations = result.Manifest["limitations"]!.AsArray().Select(l => l!["message"]!.GetValue<string>()).ToArray();
        Assert.Contains(limitations, m => m.Contains("más de 3 envoltorios", StringComparison.Ordinal));
        Assert.Contains(limitations, m => m.Contains("no se puede leer", StringComparison.Ordinal));
    }

    [Fact]
    public void Un_componente_que_dibujan_muchas_pantallas_es_compartido_y_sus_llamadas_quedan_en_la_app()
    {
        var project = new TempProject().Write("web/package.json", Package).Write("web/src/api.ts", """
            export const salud = () => fetch('/api/salud');
            export const listar = () => fetch('/api/pedidos');
            """).Write("web/src/Barra.tsx", """
            import { salud } from './api';
            export function Barra() { salud(); return <nav />; }
            """);
        var routes = new List<string>();
        var imports = new List<string>();
        foreach (var name in new[] { "Uno", "Dos", "Tres", "Cuatro" })
        {
            project.Write($"web/src/{name}.tsx", $$"""
                import { Barra } from './Barra';
                import { listar } from './api';
                export function {{name}}() { {{(name == "Uno" ? "listar();" : "")}} return <main><Barra /></main>; }
                """);
            imports.Add($"import {{ {name} }} from './{name}';");
            routes.Add($"{{ path: '/{name.ToLowerInvariant()}', element: <{name} /> }}");
        }

        project.Write("web/src/routes.tsx", $"import {{ createBrowserRouter }} from 'react-router-dom';\n{string.Join('\n', imports)}\nexport const router = createBrowserRouter([{string.Join(", ", routes)}]);");
        using (project)
        {
            var result = project.Analyze();
            Assert.Equal(
            [
                "calls:screen:web:/uno->api:GET /api/pedidos",
                "calls:service:tienda-web->api:GET /api/salud",
            ], Calls(result));
        }
    }
}
