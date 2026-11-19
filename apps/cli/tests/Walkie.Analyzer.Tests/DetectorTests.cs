namespace Walkie.Analyzer.Tests;

/// <summary>
/// Detectores sobre proyectos ficticios (spec walkie-live, tareas 2 y 7): qué se descubre, con qué base y confianza,
/// y qué queda como limitación. Todo paquete que devuelve <see cref="ProjectAnalyzer.Analyze"/> ya pasó
/// <c>DiscoveryPackValidator</c>; aquí se comprueba además el contenido.
/// </summary>
public sealed class DetectorTests
{
    [Fact]
    public void Un_proyecto_dotnet_da_su_servicio_sus_apis_su_modulo_y_su_base()
    {
        using var project = new TempProject().Dotnet();

        var result = project.Analyze();

        Assert.Equal(["service:Tienda.Api"], result.Keys("service"));
        Assert.Equal(
            ["api:DELETE /api/pedidos/{}", "api:GET /api/Clientes/{}", "api:GET /api/pedidos/{}", "api:GET /salud",
             "api:POST /api/Clientes", "api:POST /api/pedidos"],
            result.Keys("api"));
        Assert.Equal(["module:Tienda.Pedidos"], result.Keys("module"));
        Assert.Equal(["database:postgresql/PedidosDbContext"], result.Keys("database"));
        Assert.Contains("dotnet", result.TechnologyIds());
        Assert.Contains("aspnetcore", result.TechnologyIds());
        Assert.Contains("efcore", result.TechnologyIds());
        Assert.Contains("postgresql", result.TechnologyIds());
        Assert.Equal("10.0", result.Manifest["technologies"]!.AsArray().First(t => t!["id"]!.GetValue<string>() == "dotnet")!["version"]!.GetValue<string>());
    }

    [Fact]
    public void Los_prefijos_de_MapGroup_se_siguen_y_lo_que_no_se_puede_resolver_baja_la_confianza_o_es_limitacion()
    {
        using var project = new TempProject().Dotnet();

        var result = project.Analyze();

        var grouped = result.EntityOf("api:GET /api/pedidos/{}")!;
        Assert.Equal("high", grouped["confidence"]!.GetValue<string>());
        Assert.Equal("/api/pedidos/{pedidoId}", grouped["http"]!["path"]!.GetValue<string>());
        Assert.Equal("pedidoId", grouped["http"]!["params"]![0]!["name"]!.GetValue<string>());

        // El receptor llega como parámetro: el endpoint existe, su prefijo no se sabe sin ejecutar.
        Assert.Equal("medium", result.EntityOf("api:DELETE /api/pedidos/{}")!["confidence"]!.GetValue<string>());

        // $"/dinamica/{…}" no es literal: no se inventa una ruta.
        Assert.DoesNotContain(result.Keys("api"), k => k.Contains("dinamica", StringComparison.Ordinal));
        Assert.Contains("dynamic-route", result.LimitationCodes());
        Assert.True(result.Partial);
    }

    [Fact]
    public void Un_controller_con_rutas_por_atributo_reemplaza_controller_y_combina_las_rutas()
    {
        using var project = new TempProject().Dotnet();

        var api = project.Analyze().EntityOf("api:GET /api/Clientes/{}")!;

        Assert.Equal("/api/Clientes/{id}", api["http"]!["path"]!.GetValue<string>());
        Assert.Equal("observed", api["basis"]!.GetValue<string>());
    }

    [Fact]
    public void Una_biblioteca_con_endpoints_es_un_modulo_inferido_con_sus_apis_como_interfaces()
    {
        using var project = new TempProject().Dotnet();

        var result = project.Analyze();
        var module = result.EntityOf("module:Tienda.Pedidos")!;

        Assert.Equal("inferred", module["basis"]!.GetValue<string>());
        Assert.Equal(["service:Tienda.Api"], module["derivedFrom"]!.AsArray().Select(k => k!.GetValue<string>()));
        Assert.Contains("database:postgresql/PedidosDbContext", module["members"]!.AsArray().Select(k => k!.GetValue<string>()));
        Assert.Equal(3, module["interfaces"]!.AsArray().Count); // DELETE pedidos, GET y POST clientes
        Assert.Contains("depends-on:service:Tienda.Api->module:Tienda.Pedidos", result.RelationKeys());
        Assert.Contains("depends-on:module:Tienda.Pedidos->database:postgresql/PedidosDbContext", result.RelationKeys());
        Assert.Contains("exposes:service:Tienda.Api->api:GET /salud", result.RelationKeys());
        Assert.Contains("exposes:module:Tienda.Pedidos->api:POST /api/Clientes", result.RelationKeys());
    }

    [Fact]
    public void El_DbContext_es_una_base_logica_con_su_schema_tablas_y_motor()
    {
        using var project = new TempProject().Dotnet();

        var result = project.Analyze();
        var database = result.EntityOf("database:postgresql/PedidosDbContext")!["database"]!;

        Assert.Equal("PostgreSQL", database["engine"]!.GetValue<string>());
        Assert.Equal(["ventas"], database["schemas"]!.AsArray().Select(s => s!.GetValue<string>()));
        Assert.Equal(["Clientes", "Pedidos"], database["tables"]!.AsArray().Select(t => t!["name"]!.GetValue<string>()));
        Assert.Contains("efcore-logical-database", result.LimitationCodes());
    }

    [Fact]
    public void Los_proyectos_de_pruebas_no_aportan_componentes()
    {
        using var project = new TempProject().Dotnet();

        var result = project.Analyze();

        Assert.DoesNotContain(result.Keys(), k => k.Contains("solo-en-pruebas", StringComparison.Ordinal) || k.Contains("Tests", StringComparison.Ordinal));
    }

    [Fact]
    public void OpenAPI_aporta_el_contrato_y_se_combina_con_el_endpoint_del_codigo()
    {
        using var project = new TempProject().Dotnet().OpenApi();

        var result = project.Analyze();
        var api = result.EntityOf("api:GET /api/pedidos/{}")!;

        Assert.Equal("Consultar pedido", api["title"]!.GetValue<string>());
        Assert.Equal("Devuelve un pedido por su id.", api["description"]!.GetValue<string>());
        Assert.Equal([200, 404], api["http"]!["responses"]!.AsArray().Select(r => r!["status"]!.GetValue<int>()));
        Assert.Equal(2, api["evidence"]!.AsArray().Count); // el documento y el MapGet
        Assert.Contains("api:GET /v1/clientes", result.Keys("api")); // Swagger 2 con basePath
        Assert.Equal("listarClientes", result.EntityOf("api:GET /v1/clientes")!["title"]!.GetValue<string>());
        Assert.DoesNotContain(result.Keys("api"), k => k.StartsWith("api:HEAD", StringComparison.Ordinal));
        Assert.Contains("openapi-refs-not-resolved", result.LimitationCodes());
        Assert.Contains("openapi", result.TechnologyIds());
    }

    [Fact]
    public void Compose_clasifica_cada_servicio_por_su_imagen_y_sus_dependencias_son_relaciones_observadas()
    {
        using var project = new TempProject().Compose();

        var result = project.Analyze();

        Assert.Equal(["database:postgresql/tienda", "database:sql server/sqlserver"], result.Keys("database"));
        Assert.Equal(["resource:cache/cache", "resource:queue/broker", "resource:storage/archivos"], result.Keys("resource"));
        Assert.Equal(["service:api", "service:worker"], result.Keys("service"));
        Assert.Contains("depends-on:service:api->database:postgresql/tienda", result.RelationKeys());
        Assert.Contains("depends-on:service:worker->resource:storage/archivos", result.RelationKeys());
        Assert.Equal("high", result.EntityOf("service:api")!["confidence"]!.GetValue<string>()); // build propio
        Assert.Equal("medium", result.EntityOf("service:worker")!["confidence"]!.GetValue<string>()); // imagen desconocida
        Assert.Contains("unknown-reference", result.LimitationCodes()); // depende de «pagos», que no está
    }

    [Fact]
    public void Compose_nunca_copia_variables_de_entorno_al_paquete()
    {
        using var project = new TempProject().Compose();

        var text = project.Analyze().Text();

        Assert.DoesNotContain("supersecreto-ficticio", text, StringComparison.Ordinal);
        Assert.DoesNotContain("otro-secreto-ficticio", text, StringComparison.Ordinal);
        Assert.DoesNotContain("POSTGRES_PASSWORD", text, StringComparison.Ordinal);
    }

    [Fact]
    public void El_valor_por_defecto_literal_de_una_variable_de_compose_da_el_nombre_de_la_base_con_confianza_media()
    {
        using var project = new TempProject().Write("compose.yaml", """
            services:
              postgres:
                image: postgres:17
                environment:
                  POSTGRES_DB: ${POSTGRES_DB:-tienda}
            """);

        var database = project.Analyze().EntityOf("database:postgresql/tienda")!;

        Assert.Equal("medium", database["confidence"]!.GetValue<string>());
    }

    [Fact]
    public void Un_package_json_da_tecnologias_y_la_app_como_servicio_y_una_Route_sin_enrutador_no_es_pantalla()
    {
        using var project = new TempProject()
            .Write("web/package.json", """
                { "name": "tienda-web", "engines": { "node": ">=22" },
                  "dependencies": { "react": "^19.3.1", "@angular/core": "~20.1.0" },
                  "devDependencies": { "typescript": "5.9.3", "vite": "workspace:*" } }
                """)
            .Write("web/src/App.tsx", "export const App = () => <Route path=\"/pedidos\" />;");

        var result = project.Analyze();

        Assert.Equal(["angular", "nodejs", "react", "typescript", "vite"], result.TechnologyIds());
        // La app es un servicio. <Route> sin importar react-router (ni elemento) no es una ruta: no se adivina.
        Assert.Equal(["service:tienda-web"], result.Keys());
        Assert.DoesNotContain("frontend-semantics-not-analyzed", result.LimitationCodes()); // React y Angular sí se analizan
    }

    [Fact]
    public void Un_repositorio_sin_tecnologias_reconocidas_da_un_paquete_valido_y_vacio()
    {
        using var project = new TempProject().Write("README.md", "# Notas").Write("docs/ideas.txt", "nada");

        var result = project.Analyze();

        Assert.Empty(result.Keys());
        Assert.Empty(result.TechnologyIds());
        Assert.False(result.Partial);
        Assert.All(result.Detectors, d => Assert.Equal("ran", d.Status));
    }
}
