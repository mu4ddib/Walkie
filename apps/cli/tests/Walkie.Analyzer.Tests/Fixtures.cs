namespace Walkie.Analyzer.Tests;

/// <summary>Proyectos ficticios de las pruebas (una tienda inventada).</summary>
internal static class Fixtures
{
    /// <summary>Un servicio ASP.NET Core con Minimal APIs, una biblioteca con controller y DbContext, y un proyecto de pruebas.</summary>
    public static TempProject Dotnet(this TempProject project) => project
        .Write("Directory.Build.props", """
            <Project>
              <PropertyGroup>
                <TargetFramework>net10.0</TargetFramework>
              </PropertyGroup>
            </Project>
            """)
        .Write("src/Tienda.Api/Tienda.Api.csproj", """
            <Project Sdk="Microsoft.NET.Sdk.Web">
              <ItemGroup>
                <ProjectReference Include="..\Tienda.Pedidos\Tienda.Pedidos.csproj" />
              </ItemGroup>
            </Project>
            """)
        .Write("src/Tienda.Api/Program.cs", """
            var builder = WebApplication.CreateBuilder(args);
            var app = builder.Build();

            app.MapGet("/salud", () => "ok");
            var api = app.MapGroup("/api").RequireAuthorization();
            var pedidos = api.MapGroup("pedidos").WithTags("Pedidos");
            pedidos.MapGet("/{pedidoId:guid}", (Guid pedidoId) => Results.Ok());
            pedidos.MapPost("/", () => Results.Created());
            app.MapGet($"/dinamica/{Rutas.Version}", () => "?");
            app.Run();
            """)
        .Write("src/Tienda.Pedidos/Tienda.Pedidos.csproj", """
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <PackageReference Include="Microsoft.EntityFrameworkCore" Version="10.0.13" />
                <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" />
              </ItemGroup>
            </Project>
            """)
        .Write("src/Tienda.Pedidos/PedidosEndpoints.cs", """
            namespace Tienda.Pedidos;

            public static class PedidosEndpoints
            {
                public static void MapPedidos(this IEndpointRouteBuilder routes)
                {
                    routes.MapDelete("/api/pedidos/{id}", (Guid id) => Results.NoContent());
                }
            }
            """)
        .Write("src/Tienda.Pedidos/ClientesController.cs", """
            namespace Tienda.Pedidos;

            [ApiController]
            [Route("api/[controller]")]
            public sealed class ClientesController : ControllerBase
            {
                [HttpGet("{id}")]
                public IActionResult Get(int id) => Ok();

                [HttpPost]
                public IActionResult Create() => Ok();
            }
            """)
        .Write("src/Tienda.Pedidos/PedidosDbContext.cs", """
            namespace Tienda.Pedidos;

            public sealed class PedidosDbContext(DbContextOptions<PedidosDbContext> options) : DbContext(options)
            {
                public DbSet<Pedido> Pedidos => Set<Pedido>();

                public DbSet<Cliente> Clientes => Set<Cliente>();

                protected override void OnModelCreating(ModelBuilder model) => model.HasDefaultSchema("ventas");
            }
            """)
        .Write("src/Tienda.Pedidos/Registro.cs", """
            namespace Tienda.Pedidos;

            public static class Registro
            {
                public static IServiceCollection AddPedidos(this IServiceCollection services, string conexion) =>
                    services.AddDbContext<PedidosDbContext>(o => o.UseNpgsql(conexion));
            }
            """)
        .Write("tests/Tienda.Api.Tests/Tienda.Api.Tests.csproj", """
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
              </ItemGroup>
            </Project>
            """)
        .Write("tests/Tienda.Api.Tests/FalsaApi.cs", """
            public static class FalsaApi
            {
                public static void Map(WebApplication app) => app.MapGet("/solo-en-pruebas", () => "x");
            }
            """);

    /// <summary>OpenAPI 3 en YAML (con el mismo endpoint que el código) y Swagger 2 en JSON con basePath.</summary>
    public static TempProject OpenApi(this TempProject project) => project
        .Write("docs/openapi.yaml", """
            openapi: 3.0.3
            info:
              title: Tienda
              version: "1"
            paths:
              /api/pedidos/{pedidoId}:
                get:
                  summary: Consultar pedido
                  description: Devuelve un pedido por su id.
                  parameters:
                    - name: pedidoId
                      in: path
                      required: true
                      schema:
                        type: string
                    - $ref: '#/components/parameters/Traza'
                  responses:
                    "200":
                      description: El pedido
                    "404":
                      description: No existe
                    default:
                      description: Error
                head:
                  responses:
                    "200":
                      description: Existe
            """)
        .Write("legacy/swagger.json", """
            {
              "swagger": "2.0",
              "basePath": "/v1",
              "paths": {
                "/clientes": {
                  "get": { "operationId": "listarClientes", "responses": { "200": { "description": "Lista" } } }
                }
              }
            }
            """);

    /// <summary>docker-compose con base, caché, cola, almacenamiento, identidad y un servicio propio.</summary>
    public static TempProject Compose(this TempProject project) => project
        .Write("docker-compose.yml", """
            services:
              db:
                image: postgres:17
                environment:
                  POSTGRES_DB: tienda
                  POSTGRES_PASSWORD: supersecreto-ficticio
              cache:
                image: redis:7-alpine
              broker:
                image: docker.io/library/rabbitmq:3-management
                environment:
                  - RABBITMQ_DEFAULT_PASS=otro-secreto-ficticio
              archivos:
                image: rustfs/rustfs:1.0.4
              sqlserver:
                image: mcr.microsoft.com/mssql/server:2022-latest
              api:
                build: ./src/Tienda.Api
                depends_on:
                  db:
                    condition: service_healthy
                  cache:
                    condition: service_started
                  pagos:
                    condition: service_started
              worker:
                image: ghcr.io/tienda/worker:1.2
                depends_on: [broker, archivos]
            """);
}
