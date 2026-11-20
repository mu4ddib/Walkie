using System.Text.Json.Nodes;

namespace Walkie.Analyzer.Tests;

/// <summary>
/// Casos B a E de la spec walkie-live-arquitectura (ADR-0016), con proyectos ficticios escritos para cada caso. Lo
/// esperado se escribe a mano: es la verdad de cada fixture, incluidas las relaciones que no deben existir.
/// </summary>
public sealed class ArchitectureCasesTests
{
    private const string BuildProps = """
        <Project>
          <PropertyGroup>
            <TargetFramework>net10.0</TargetFramework>
          </PropertyGroup>
        </Project>
        """;

    private static string[] Of(AnalysisResult result, string kind) =>
        [.. result.RelationKeys().Where(k => k.StartsWith(kind + ":", StringComparison.Ordinal))];

    private static JsonObject Relation(AnalysisResult result, string key) =>
        result.Discovery["relations"]!.AsArray().Select(r => r!.AsObject()).Single(r => r["key"]!.GetValue<string>() == key);

    // ---------- Caso B: React + .NET ----------

    /// <summary>Login, listado, detalle, creación y edición; servicios del front con axios; endpoints, servicio y EF Core.</summary>
    internal static TempProject CaseB(TempProject project) => project
        .Write("Directory.Build.props", BuildProps)
        .Write("api/Tienda.Api/Tienda.Api.csproj", """
            <Project Sdk="Microsoft.NET.Sdk.Web">
              <ItemGroup>
                <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" />
              </ItemGroup>
            </Project>
            """)
        .Write("api/Tienda.Api/Program.cs", """
            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddDbContext<TiendaDbContext>(o => o.UseNpgsql("Host=db"));
            builder.Services.AddDbContext<AuditoriaDbContext>(o => o.UseNpgsql("Host=db"));
            builder.Services.AddScoped<PedidosService>();
            builder.Services.AddScoped<IAuditoria, Auditoria>(); // registrada, pero ningún endpoint la usa
            var app = builder.Build();
            app.MapPost("/api/sesion", (Credenciales credenciales) => Results.Ok());
            var pedidos = app.MapGroup("/api/pedidos");
            pedidos.MapGet("/", PedidosEndpoints.Listar);
            pedidos.MapGet("/{pedidoId:guid}", PedidosEndpoints.Obtener);
            pedidos.MapPost("/", PedidosEndpoints.Crear);
            pedidos.MapPut("/{pedidoId:guid}", PedidosEndpoints.Editar);
            app.Run();
            """)
        .Write("api/Tienda.Api/PedidosEndpoints.cs", """
            public static class PedidosEndpoints
            {
                public static Task<List<Pedido>> Listar(PedidosService servicio) => servicio.ListarAsync();
                public static Task<Pedido?> Obtener(Guid pedidoId, PedidosService servicio) => servicio.ObtenerAsync(pedidoId);
                public static async Task<IResult> Crear(Pedido pedido, PedidosService servicio) { await servicio.CrearAsync(pedido); return Results.Created(); }
                public static async Task<IResult> Editar(Guid pedidoId, Pedido pedido, PedidosService servicio) { await servicio.EditarAsync(pedidoId, pedido); return Results.NoContent(); }
            }
            """)
        .Write("api/Tienda.Api/PedidosService.cs", """
            public sealed class PedidosService(TiendaDbContext db)
            {
                public Task<List<Pedido>> ListarAsync() => db.Pedidos.AsNoTracking().ToListAsync();
                public Task<Pedido?> ObtenerAsync(Guid id) => db.Pedidos.SingleOrDefaultAsync(p => p.Id == id);
                public async Task CrearAsync(Pedido pedido) { db.Pedidos.Add(pedido); await db.SaveChangesAsync(); }
                public async Task EditarAsync(Guid id, Pedido cambios)
                {
                    var pedido = await db.Pedidos.SingleAsync(p => p.Id == id);
                    pedido.Estado = cambios.Estado;
                    await db.SaveChangesAsync();
                }
            }
            """)
        .Write("api/Tienda.Api/Datos.cs", """
            public sealed class TiendaDbContext(DbContextOptions<TiendaDbContext> options) : DbContext(options)
            {
                public DbSet<Pedido> Pedidos { get; set; } = null!;
            }
            public sealed class AuditoriaDbContext(DbContextOptions<AuditoriaDbContext> options) : DbContext(options)
            {
                public DbSet<Registro> Registros { get; set; } = null!;
            }
            public interface IAuditoria { Task AnotarAsync(string texto); }
            public sealed class Auditoria(AuditoriaDbContext db) : IAuditoria
            {
                public async Task AnotarAsync(string texto) { db.Registros.Add(new Registro(texto)); await db.SaveChangesAsync(); }
            }
            """)
        .Write("web/package.json", """{ "name": "tienda-web", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0", "axios": "1.7.0" } }""")
        .Write("web/src/http.ts", """
            import axios from 'axios';
            export const http = axios.create({ baseURL: '/api' });
            """)
        .Write("web/src/servicios/pedidos.ts", """
            import { http } from '../http';
            export const pedidosService = {
              listar: () => http.get<Pedido[]>('/pedidos'),
              obtener: (id: string) => http.get<Pedido>(`/pedidos/${id}`),
              crear: (pedido: Pedido) => http.post<Pedido>('/pedidos', pedido),
              editar: (id: string, pedido: Pedido) => http.put(`/pedidos/${id}`, pedido),
            };
            """)
        .Write("web/src/servicios/sesion.ts", """
            export function iniciarSesion(credenciales: Credenciales) {
              return fetch('/api/sesion', { method: 'POST', body: JSON.stringify(credenciales) });
            }
            """)
        .Write("web/src/rutas.ts", """
            export const PEDIDOS = '/pedidos';
            export const pedidoPath = (id: string) => `/pedidos/${id}`;
            export const editarPath = (id: string) => `/pedidos/${id}/editar`;
            """)
        .Write("web/src/main.tsx", """
            import { createBrowserRouter } from 'react-router-dom';
            import { LoginPage } from './paginas/LoginPage';
            import { PedidosPage } from './paginas/PedidosPage';
            import { NuevoPedidoPage } from './paginas/NuevoPedidoPage';
            import { PedidoPage } from './paginas/PedidoPage';
            import { EditarPedidoPage } from './paginas/EditarPedidoPage';
            export const router = createBrowserRouter([
              { path: '/login', element: <LoginPage /> },
              { path: '/pedidos', element: <PedidosPage /> },
              { path: '/pedidos/nuevo', element: <NuevoPedidoPage /> },
              { path: '/pedidos/:id', element: <PedidoPage /> },
              { path: '/pedidos/:id/editar', element: <EditarPedidoPage /> },
            ]);
            """)
        .Write("web/src/paginas/LoginPage.tsx", """
            import { useNavigate } from 'react-router-dom';
            import { iniciarSesion } from '../servicios/sesion';
            import { PEDIDOS } from '../rutas';
            export function LoginPage() {
              const navigate = useNavigate();
              return <form onSubmit={() => iniciarSesion({}).then(() => navigate(PEDIDOS))} />;
            }
            """)
        .Write("web/src/paginas/PedidosPage.tsx", """
            import { Link } from 'react-router-dom';
            import { pedidosService } from '../servicios/pedidos';
            import { pedidoPath } from '../rutas';
            export function PedidosPage() {
              const [pedidos, setPedidos] = useState<Pedido[]>([]);
              useEffect(() => { pedidosService.listar().then((r) => setPedidos(r.data)); }, []);
              return <main><Link to="/pedidos/nuevo">Nuevo</Link>{pedidos.map((p) => <Link key={p.id} to={pedidoPath(p.id)}>{p.numero}</Link>)}</main>;
            }
            """)
        .Write("web/src/paginas/NuevoPedidoPage.tsx", """
            import { useNavigate } from 'react-router-dom';
            import { pedidosService } from '../servicios/pedidos';
            import { pedidoPath } from '../rutas';
            export function NuevoPedidoPage() {
              const navigate = useNavigate();
              return <form onSubmit={() => pedidosService.crear({}).then((r) => navigate(pedidoPath(r.data.id)))} />;
            }
            """)
        .Write("web/src/paginas/PedidoPage.tsx", """
            import { Link, useParams } from 'react-router-dom';
            import { pedidosService } from '../servicios/pedidos';
            import { editarPath, PEDIDOS } from '../rutas';
            export function PedidoPage() {
              const { id = '' } = useParams();
              useEffect(() => { pedidosService.obtener(id); }, [id]);
              return <main><Link to={editarPath(id)}>Editar</Link><Link to={PEDIDOS}>Volver</Link></main>;
            }
            """)
        .Write("web/src/paginas/EditarPedidoPage.tsx", """
            import { useNavigate, useParams } from 'react-router-dom';
            import { pedidosService } from '../servicios/pedidos';
            import { pedidoPath } from '../rutas';
            export function EditarPedidoPage() {
              const { id = '' } = useParams();
              const navigate = useNavigate();
              useEffect(() => { pedidosService.obtener(id); }, [id]);
              return <form onSubmit={() => pedidosService.editar(id, {}).then(() => navigate(pedidoPath(id)))} />;
            }
            """);

    [Fact]
    public void Caso_B_cada_pantalla_llama_a_sus_apis_por_su_servicio_y_cada_api_lee_o_escribe_su_base()
    {
        using var project = CaseB(new TempProject());
        var result = project.Analyze();

        Assert.Equal(
        [
            "calls:screen:web:/login->api:POST /api/sesion",
            "calls:screen:web:/pedidos->api:GET /api/pedidos",
            "calls:screen:web:/pedidos/nuevo->api:POST /api/pedidos",
            "calls:screen:web:/pedidos/{}->api:GET /api/pedidos/{}",
            "calls:screen:web:/pedidos/{}/editar->api:GET /api/pedidos/{}",
            "calls:screen:web:/pedidos/{}/editar->api:PUT /api/pedidos/{}",
        ], Of(result, "calls"));

        // Las APIs del front son las mismas que publica el backend (misma clave), no copias inferidas.
        Assert.Equal("observed", result.EntityOf("api:GET /api/pedidos")!["basis"]!.GetValue<string>());

        Assert.Equal(
        [
            "reads:api:GET /api/pedidos->database:postgresql/TiendaDbContext",
            "reads:api:GET /api/pedidos/{}->database:postgresql/TiendaDbContext",
            "reads:api:PUT /api/pedidos/{}->database:postgresql/TiendaDbContext",
        ], Of(result, "reads"));
        Assert.Equal(
        [
            "writes:api:POST /api/pedidos->database:postgresql/TiendaDbContext",
            "writes:api:PUT /api/pedidos/{}->database:postgresql/TiendaDbContext",
        ], Of(result, "writes"));

        // Registrar IAuditoria en DI no prueba que un endpoint la use: nada lee ni escribe su base.
        Assert.DoesNotContain(result.RelationKeys(), k => k.Contains("AuditoriaDbContext", StringComparison.Ordinal) && !k.StartsWith("depends-on", StringComparison.Ordinal));
        var write = Relation(result, "writes:api:POST /api/pedidos->database:postgresql/TiendaDbContext");
        Assert.Equal("inferred", write["basis"]!.GetValue<string>());
        Assert.True(write["evidence"]!.AsArray().Count >= 3, "La cadena endpoint → servicio → DbSet va como evidencia.");

        Assert.Equal(
        [
            "navigates:screen:web:/login->screen:web:/pedidos",
            "navigates:screen:web:/pedidos->screen:web:/pedidos/nuevo",
            "navigates:screen:web:/pedidos->screen:web:/pedidos/{}",
            "navigates:screen:web:/pedidos/nuevo->screen:web:/pedidos/{}",
            "navigates:screen:web:/pedidos/{}->screen:web:/pedidos",
            "navigates:screen:web:/pedidos/{}->screen:web:/pedidos/{}/editar",
            "navigates:screen:web:/pedidos/{}/editar->screen:web:/pedidos/{}",
        ], Of(result, "navigates"));
    }

    [Fact]
    public void Caso_B_propone_la_gestion_de_pedidos_con_su_evidencia_y_deja_el_login_solo()
    {
        using var project = CaseB(new TempProject());
        var result = project.Analyze();

        var features = result.Keys("feature");
        Assert.Equal(["feature:web:Pedidos"], features);
        var pedidos = result.EntityOf("feature:web:Pedidos")!;
        Assert.Equal("medium", pedidos["confidence"]!.GetValue<string>());
        Assert.Equal(
        [
            "api:GET /api/pedidos", "api:GET /api/pedidos/{}", "api:POST /api/pedidos", "api:PUT /api/pedidos/{}",
            "screen:web:/pedidos", "screen:web:/pedidos/nuevo", "screen:web:/pedidos/{}", "screen:web:/pedidos/{}/editar",
        ], pedidos["members"]!.AsArray().Select(m => m!.GetValue<string>()));
        var description = pedidos["description"]!.GetValue<string>();
        Assert.Contains("navegaciones entre ellas", description, StringComparison.Ordinal);
        Assert.Contains("las publica Tienda.Api", description, StringComparison.Ordinal);
        Assert.Contains("el nombre y el alcance los decides tú", description, StringComparison.Ordinal);
        Assert.Empty(TempProject.Validate(result.Manifest, result.Discovery));
    }

    // ---------- Caso C: Angular + .NET ----------

    [Fact]
    public void Caso_C_angular_con_rutas_standalone_y_diferidas_servicios_inyectados_y_navegacion()
    {
        using var project = new TempProject()
            .Write("ng/package.json", """{ "name": "tienda-angular", "dependencies": { "@angular/core": "20.0.0", "@angular/router": "20.0.0", "@angular/common": "20.0.0" } }""")
            .Write("ng/src/app/app.routes.ts", """
                import { Routes } from '@angular/router';
                import { InicioComponent } from './inicio.component';
                export const routes: Routes = [
                  { path: '', component: InicioComponent },
                  { path: 'pedidos', loadChildren: () => import('./pedidos/pedidos.routes').then((m) => m.PEDIDOS_ROUTES) },
                ];
                """)
            .Write("ng/src/app/inicio.component.ts", """
                import { Component } from '@angular/core';
                @Component({ selector: 'app-inicio', template: '<a routerLink="/pedidos">Pedidos</a>' })
                export class InicioComponent {}
                """)
            .Write("ng/src/app/pedidos/pedidos.routes.ts", """
                import { Routes } from '@angular/router';
                export const PEDIDOS_ROUTES: Routes = [
                  { path: '', loadComponent: () => import('./lista.component').then((m) => m.ListaComponent) },
                  { path: ':id', loadComponent: () => import('./detalle.component').then((m) => m.DetalleComponent) },
                ];
                """)
            .Write("ng/src/app/pedidos/pedidos.service.ts", """
                import { Injectable, inject } from '@angular/core';
                import { HttpClient } from '@angular/common/http';
                import { environment } from '../../environments/environment';
                @Injectable({ providedIn: 'root' })
                export class PedidosService {
                  private readonly http = inject(HttpClient);
                  private readonly base = `${environment.apiUrl}/pedidos`;
                  listar() { return this.http.get<Pedido[]>(`${environment.apiUrl}/pedidos`); }
                  obtener(id: string) { return this.http.get<Pedido>(`${environment.apiUrl}/pedidos/${id}`); }
                }
                """)
            .Write("ng/src/app/pedidos/lista.component.ts", """
                import { Component, inject } from '@angular/core';
                import { Router } from '@angular/router';
                import { PedidosService } from './pedidos.service';
                @Component({ selector: 'app-lista', template: '<button (click)="abrir(p)">Ver</button>' })
                export class ListaComponent {
                  private readonly pedidos = inject(PedidosService);
                  constructor(private router: Router) {}
                  ngOnInit() { this.pedidos.listar().subscribe(); }
                  abrir(p: Pedido) { this.router.navigate(['/pedidos', p.id]); }
                }
                """)
            .Write("ng/src/app/pedidos/detalle.component.ts", """
                import { Component } from '@angular/core';
                import { PedidosService } from './pedidos.service';
                @Component({ selector: 'app-detalle', template: '<a routerLink="/pedidos">Volver</a>' })
                export class DetalleComponent {
                  constructor(private servicio: PedidosService) {}
                  cargar(id: string) { return this.servicio.obtener(id); }
                }
                """);
        var result = project.Analyze();

        Assert.Equal(["screen:ng:/", "screen:ng:/pedidos", "screen:ng:/pedidos/{}"], result.Keys("screen"));
        // El componente llama a su servicio inyectado (inject o constructor) y el servicio a HttpClient con base configurable.
        Assert.Equal(
        [
            "calls:screen:ng:/pedidos->api:GET /pedidos",
            "calls:screen:ng:/pedidos/{}->api:GET /pedidos/{}",
        ], Of(result, "calls"));
        Assert.Equal("inferred", Relation(result, "calls:screen:ng:/pedidos->api:GET /pedidos")["basis"]!.GetValue<string>());
        Assert.Equal(
        [
            "navigates:screen:ng:/->screen:ng:/pedidos",
            "navigates:screen:ng:/pedidos->screen:ng:/pedidos/{}",
            "navigates:screen:ng:/pedidos/{}->screen:ng:/pedidos",
        ], Of(result, "navigates"));
        // Las dos pantallas de la carga diferida, con navegación y API del mismo servicio entre ellas.
        var feature = result.EntityOf(result.Keys("feature").Single())!;
        Assert.Equal(["api:GET /pedidos", "api:GET /pedidos/{}", "screen:ng:/pedidos", "screen:ng:/pedidos/{}"], feature["members"]!.AsArray().Select(m => m!.GetValue<string>()));
        Assert.Contains("carga diferida común", feature["description"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    // ---------- Caso D: monorepo ----------

    [Fact]
    public void Caso_D_en_un_monorepo_dos_apps_con_las_mismas_rutas_y_un_cliente_comun_nunca_se_mezclan()
    {
        var project = new TempProject()
            .Write("shared/api.ts", """
                export function listarPedidos() { return fetch('/api/pedidos'); }
                export const pedidoPath = (id: string) => `/pedidos/${id}`;
                """);
        foreach (var app in new[] { "admin", "tienda" })
        {
            project.Write($"{app}/package.json", $$"""{ "name": "{{app}}", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""")
                .Write($"{app}/src/rutas.tsx", """
                    import { createBrowserRouter } from 'react-router-dom';
                    import { PedidosPage, PedidoPage } from './paginas';
                    export const router = createBrowserRouter([
                      { path: '/pedidos', element: <PedidosPage /> },
                      { path: '/pedidos/:id', element: <PedidoPage /> },
                    ]);
                    """)
                .Write($"{app}/src/paginas.tsx", $$"""
                    import { Link } from 'react-router-dom';
                    import { listarPedidos, pedidoPath } from '../../shared/api';
                    export function PedidosPage() { listarPedidos(); return <Link to={pedidoPath('1')}>Ver</Link>; }
                    export function PedidoPage() { return <Link to="/pedidos">Volver</Link>; }
                    {{(app == "admin" ? "export function auditar() { return fetch('/api/auditoria'); }" : "")}}
                    """);
        }

        using (project)
        {
            var result = project.Analyze();
            Assert.Equal(
            [
                "calls:screen:admin:/pedidos->api:GET /api/pedidos",
                "calls:screen:tienda:/pedidos->api:GET /api/pedidos",
                "calls:service:admin->api:GET /api/auditoria",
            ], Of(result, "calls"));
            Assert.All(Of(result, "navigates"), k =>
            {
                var scopes = k.Split("screen:").Skip(1).Select(s => s.Split(':')[0]).Distinct().ToArray();
                Assert.Single(scopes); // nunca de una app a la otra
            });
            Assert.Equal(4, Of(result, "navigates").Length);
            // Cada app contiene solo sus pantallas (contención, no ejecución).
            Assert.Equal(
            [
                "contains:service:admin->screen:admin:/pedidos", "contains:service:admin->screen:admin:/pedidos/{}",
                "contains:service:tienda->screen:tienda:/pedidos", "contains:service:tienda->screen:tienda:/pedidos/{}",
            ], Of(result, "contains"));
            Assert.Equal(["feature:admin:Pedidos", "feature:tienda:Pedidos"], result.Keys("feature"));
            Assert.DoesNotContain(result.Discovery["entities"]!.AsArray().Select(e => e!.AsObject()).Where(e => e["kind"]!.GetValue<string>() == "feature"),
                f => f["members"]!.AsArray().Select(m => m!.GetValue<string>()).Where(m => m.StartsWith("screen:", StringComparison.Ordinal)).Select(m => m.Split(':')[1]).Distinct().Count() > 1);
        }
    }

    // ---------- Caso E: análisis incompleto ----------

    [Fact]
    public void Caso_E_una_navegacion_dinamica_y_un_cliente_que_no_se_puede_leer_quedan_como_limitacion_sin_inventar_nada()
    {
        using var project = new TempProject()
            .Write("web/package.json", """{ "name": "tienda-web", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }""")
            .Write("web/src/cliente.ts", """
                const config = await cargarConfiguracion();
                export function pedir(recurso: string) { return fetch(config.servidores[recurso]); }
                export function enviar(ruta: string) { return fetch(`/api/${ruta}`, { method: elegirMetodo() }); }
                """)
            .Write("web/src/rutas.tsx", """
                import { createBrowserRouter } from 'react-router-dom';
                import { InicioPage } from './InicioPage';
                import { PedidosPage } from './PedidosPage';
                export const router = createBrowserRouter([
                  { path: '/', element: <InicioPage /> },
                  { path: '/pedidos', element: <PedidosPage /> },
                ]);
                """)
            .Write("web/src/InicioPage.tsx", """
                import { useNavigate } from 'react-router-dom';
                import { pedir, enviar } from './cliente';
                export function InicioPage({ destino }: { destino: string }) {
                  const navigate = useNavigate();
                  pedir('pedidos');
                  enviar('pedidos');
                  return <button onClick={() => navigate(destino)}>Ir</button>;
                }
                """)
            .Write("web/src/PedidosPage.tsx", """
                import { Link } from 'react-router-dom';
                export function PedidosPage() { return <Link to={rutaCalculada()}>Algo</Link>; }
                """);
        var result = project.Analyze();

        Assert.Empty(Of(result, "calls"));
        Assert.Empty(Of(result, "navigates"));
        Assert.Empty(result.Keys("api"));
        Assert.Contains("dynamic-navigation", result.LimitationCodes());
        Assert.Contains("http-wrapper-unresolved", result.LimitationCodes());
        Assert.True(result.Partial);
        var messages = result.Manifest["limitations"]!.AsArray().Select(l => l!.AsObject())
            .Where(l => l["code"]!.GetValue<string>() is "dynamic-navigation" or "http-wrapper-unresolved")
            .Select(l => (Path: l["path"]?.GetValue<string>(), Message: l["message"]!.GetValue<string>())).ToList();
        Assert.All(messages, m => Assert.NotNull(m.Path)); // con su archivo
        Assert.Contains(messages, m => m.Message.Contains("línea", StringComparison.Ordinal)); // y su línea
    }
}
