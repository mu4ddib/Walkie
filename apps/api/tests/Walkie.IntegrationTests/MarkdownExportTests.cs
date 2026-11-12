using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Export.Features;

namespace Walkie.IntegrationTests;

/// <summary>
/// Generador del documento Markdown (spec export-markdown, criterios 3 a 8 y 10). Función pura: sin base ni HTTP.
/// Datos ficticios.
/// </summary>
public sealed class MarkdownExportTests
{
    private static readonly Guid Asset = Guid.Parse("0198f0c0-1111-7000-8000-000000000001");
    private static readonly Guid Item = Guid.Parse("0198f0c0-2222-7000-8000-000000000002");
    private static readonly Guid Transferir = Guid.Parse("0198f0c0-3333-7000-8000-000000000003");
    /// <summary>Recursos en el orden de sus subtipos: almacenamiento, función, cola y personalizado.</summary>
    private static readonly string[] ResourceHeadings = ["### Comprobantes", "### Firmar", "### Pagos pendientes", "### Orquestador"];
    private static readonly DateTimeOffset ExportedAt = new(2026, 11, 8, 15, 4, 0, TimeSpan.Zero);

    [Fact]
    public void Un_lienzo_completo_da_el_documento_esperado()
    {
        var markdown = MarkdownDocument.Render(Input(Graph()));

        Assert.Equal(
            """
            # Iniciar sesión

            App: **Banca de prueba** · Versión del lienzo: 3 · Exportado el 2026-11-08 15:04 (UTC) desde Walkie.

            ## Contenido

            - [Diagrama](#diagrama)
            - [Actores](#actores)
            - [Pantallas](#pantallas)
            - [Reglas](#reglas)
            - [APIs](#apis)
            - [Portales](#portales)
            - [Conexiones](#conexiones)
            - [Tours](#tours)

            ## Diagrama

            ```mermaid
            flowchart LR
              n1(("Actor: Cliente"))
              n2["Pantalla: Login"]
              n3{{"Regla: Documento válido"}}
              n4["API: Consultar cliente"]
              n5[/"Portal: Transferir"/]
              n1 -->|"usa"| n2
              n2 -->|"llama: Buscar [200]"| n4
              n2 -->|"navega"| n5
            ```

            ## Actores

            ### Cliente

            ## Pantallas

            ### Login

            ![Login](img/login-0198f0c0.png)

            Pide el documento.

            | Input | Tipo | Obligatorio | Opciones | Reglas |
            | --- | --- | --- | --- | --- |
            | `documento` | string | Sí |  | Documento válido |
            | `tipo` | enum | No | CC, CE |  |

            ## Reglas

            ### Documento válido

            ```
            solo dígitos
            de 6 a 10
            ```

            Valida: `documento` (Login).

            ## APIs

            ### Consultar cliente (del catálogo)

            Busca al cliente por documento.

            `GET /clientes/{id}`

            ## Portales

            ### Transferir

            Lleva a **Transferir**.

            ## Conexiones

            - Cliente → Login (usa)
            - Login → Consultar cliente (llama: Buscar \[200\])
            - Login → Transferir (navega)

            ## Tours

            ### Primer ingreso

            1. **Login**: Aquí empieza todo.
            2. **Consultar cliente**

            """.ReplaceLineEndings("\n"),
            markdown);
    }

    [Fact]
    public void El_mismo_grafo_con_otro_orden_de_claves_da_el_mismo_documento()
    {
        var graph = Graph();
        var reversed = new JsonObject();
        foreach (var (key, value) in graph.AsEnumerable().Reverse())
        {
            reversed[key] = value is JsonObject map
                ? new JsonObject(map.Reverse().Select(p => KeyValuePair.Create(p.Key, p.Value?.DeepClone())))
                : value?.DeepClone();
        }

        Assert.Equal(MarkdownDocument.Render(Input(graph)), MarkdownDocument.Render(Input(reversed)));
    }

    [Fact]
    public void Solo_cambia_la_fecha_de_exportacion()
    {
        var first = MarkdownDocument.Render(Input(Graph()));
        var later = MarkdownDocument.Render(Input(Graph()) with { ExportedAt = ExportedAt.AddDays(3) });

        Assert.NotEqual(first, later);
        Assert.Equal(first.Replace("2026-11-08", "2026-11-11", StringComparison.Ordinal), later);
    }

    [Fact]
    public void Los_simbolos_de_Markdown_se_escapan_y_no_rompen_tablas_ni_titulos()
    {
        var graph = Graph();
        graph["nodes"]!["s1"]!["title"] = "# Login *nuevo* | <b>";
        graph["nodes"]!["s1"]!["description"] = "- no es lista\n1. tampoco\n_cursiva_";
        graph["nodes"]!["s1"]!["inputs"]![1]!["options"] = new JsonArray("A|B", "C");

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains(@"### \# Login \*nuevo\* \| \<b\>", markdown, StringComparison.Ordinal);
        Assert.Contains("\\- no es lista  \n1\\. tampoco  \n\\_cursiva\\_", markdown, StringComparison.Ordinal);
        Assert.Contains(@"| `tipo` | enum | No | A\|B, C |  |", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Comillas_corchetes_y_saltos_de_linea_no_rompen_el_diagrama()
    {
        var graph = Graph();
        graph["nodes"]!["s1"]!["title"] = "Login \"seguro\" [v2] #1\n<nuevo>";

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains("n2[\"Pantalla: Login #quot;seguro#quot; [v2] #35;1 #lt;nuevo#gt;\"]", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Una_expresion_con_comillas_invertidas_usa_una_cerca_mas_larga()
    {
        var graph = Graph();
        graph["nodes"]!["r1"]!["expression"] = "usa ``` dentro";

        Assert.Contains("````\nusa ``` dentro\n````", MarkdownDocument.Render(Input(graph)), StringComparison.Ordinal);
    }

    [Fact]
    public void Un_portal_sin_destino_o_a_una_feature_que_no_existe_lo_dice()
    {
        var graph = Graph();
        graph["nodes"]!["p2"] = new JsonObject { ["id"] = "p2", ["type"] = "portal", ["title"] = "Pagos" };
        graph["nodes"]!["p3"] = new JsonObject
        {
            ["id"] = "p3", ["type"] = "portal", ["title"] = "Viejo", ["targetFeatureId"] = Guid.CreateVersion7().ToString(),
        };

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains("### Pagos\n\nSin destino.", markdown, StringComparison.Ordinal);
        Assert.Contains("### Viejo\n\nLleva a **Viejo** (destino no encontrado).", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Un_ref_cuyo_elemento_no_existe_va_en_su_propia_seccion()
    {
        var graph = Graph();
        graph["nodes"]!["c1"]!["catalogId"] = Guid.CreateVersion7().ToString();

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains("- [Referencias sin elemento](#referencias-sin-elemento)", markdown, StringComparison.Ordinal);
        Assert.Contains("### Título viejo\n\nEl elemento del catálogo ya no existe.", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("## APIs", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Un_lienzo_vacio_lo_dice()
    {
        var empty = new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = new JsonObject(), ["edges"] = new JsonObject(), ["layout"] = new JsonObject(),
        };

        var markdown = MarkdownDocument.Render(Input(empty));

        Assert.EndsWith("desde Walkie.\n\nEste lienzo está vacío.\n", markdown, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Iniciar sesión", "iniciar-sesion")]
    [InlineData("  Transferir: ¡ahora!  ", "transferir-ahora")]
    [InlineData("Año 2026 / Pagos_PSE", "ano-2026-pagos-pse")]
    [InlineData("¿?", "feature")]
    public void Los_nombres_de_archivo_son_slugs_sin_acentos(string name, string slug)
    {
        Assert.Equal(slug, Slugs.From(name));
    }

    [Fact]
    public void El_detalle_tecnico_y_los_grupos_salen_en_el_documento()
    {
        var markdown = MarkdownDocument.Render(Input(TechnicalGraph()));

        Assert.Equal(
            """
            # Iniciar sesión

            App: **Banca de prueba** · Versión del lienzo: 2 · Exportado el 2026-11-08 15:04 (UTC) desde Walkie.

            ## Contenido

            - [Diagrama](#diagrama)
            - [Actores](#actores)
            - [APIs](#apis)
            - [Bases de datos](#bases-de-datos)
            - [Grupos](#grupos)
            - [Conexiones](#conexiones)

            ## Diagrama

            ```mermaid
            flowchart LR
              n1(("Actor: Cliente"))
              n2["API: Crear transferencia"]
              n3[("Base de datos: Core")]
              subgraph g1["Backend: Core bancario"]
                n2
                n3
              end
              n2 -->|"escribe"| n3
            ```

            ## Actores

            ### Cliente

            **Responsabilidades:**  
            Inicia la transferencia.

            ## APIs

            ### Crear transferencia

            `POST /transferencias`

            **Autenticación:** Bearer (token). Token del canal

            **Parámetros**

            | Parámetro | Dónde | Tipo | Obligatorio | Descripción | Ejemplo |
            | --- | --- | --- | --- | --- | --- |
            | `X-Canal` | header | string | Sí |  | `a\|b` |

            **Request** · `application/json`

            | Campo | Tipo | Obligatorio | Descripción | Ejemplo |
            | --- | --- | --- | --- | --- |
            | `monto` | number | Sí | En pesos \| sin decimales |  |

            ```
            { "monto": 1000 }
            ```

            **201** — Creada

            | Campo | Tipo | Obligatorio | Descripción | Ejemplo |
            | --- | --- | --- | --- | --- |
            | `id` | uuid | No |  |  |

            **422** (error) — Saldo insuficiente

            ## Bases de datos

            ### Core

            Motor: PostgreSQL · Base: `core` · Schemas: `pagos`

            **Tabla** `pagos.transferencias`

            | Campo | Tipo | Clave | Nulo | Descripción |
            | --- | --- | --- | --- | --- |
            | `id` | uuid | PK | No |  |
            | `cuenta_id` | uuid | FK | Sí |  |

            - `cuenta_id` → `cuentas.id`

            ## Grupos

            ### Core bancario (Backend)

            - Crear transferencia (API)
            - Core (Base de datos)

            ## Conexiones

            - Crear transferencia → Core (escribe)
              - Datos: escribe `transferencias`
              - Notas: En una transacción.
              - Ejemplo:

                ```
                INSERT INTO transferencias …
                ```

            """.ReplaceLineEndings("\n"),
            markdown);
    }

    [Fact]
    public void La_ruta_de_una_imagen_usa_el_titulo_el_id_y_la_extension()
    {
        Assert.Equal("img/datos-del-cliente-0198f0c0.webp", Slugs.ImagePath("Datos del cliente", Asset, "image/webp"));
        Assert.Equal("img/pantalla-0198f0c0.jpg", Slugs.ImagePath("¿?", Asset, "image/jpeg"));
    }

    [Fact]
    public void Ramas_respuestas_y_notas_adhesivas_salen_con_su_etiqueta_codigo_y_texto()
    {
        var graph = Graph();
        graph["nodes"]!["d1"] = new JsonObject
        {
            ["id"] = "d1", ["type"] = "rule", ["title"] = "¿Tiene cuenta?", ["mode"] = "decision",
            ["branches"] = new JsonArray(new JsonObject { ["id"] = "si", ["label"] = "Sí" }),
        };
        graph["nodes"]!["x1"] = new JsonObject
        {
            ["id"] = "x1", ["type"] = "api", ["title"] = "API Usuarios",
            ["http"] = new JsonObject { ["method"] = "POST", ["path"] = "/creacionUsuario" },
        };
        graph["edges"]!["e4"] = new JsonObject { ["id"] = "e4", ["from"] = "d1", ["to"] = "s1", ["kind"] = "uses", ["branch"] = "si" };
        graph["edges"]!["e5"] = new JsonObject
        {
            ["id"] = "e5", ["from"] = "s1", ["to"] = "x1", ["kind"] = "request",
            ["request"] = new JsonObject
            {
                ["params"] = new JsonArray(new JsonObject { ["name"] = "X-Canal", ["in"] = "header", ["value"] = "app" }),
            },
        };
        graph["edges"]!["e6"] = new JsonObject
        {
            ["id"] = "e6", ["from"] = "x1", ["to"] = "s1", ["kind"] = "response", ["replyTo"] = "e5", ["status"] = 201,
            ["outcome"] = "Se muestra la confirmación",
        };
        graph["stickyNotes"] = new JsonObject
        {
            ["k1"] = new JsonObject { ["id"] = "k1", ["text"] = "Pendiente: validar con seguridad" },
            ["k2"] = new JsonObject { ["id"] = "k2", ["text"] = "" },
        };

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains("¿Tiene cuenta? → Login (Sí)", markdown, StringComparison.Ordinal);
        Assert.Contains("Login → API Usuarios (llama: POST /creacionUsuario)", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Parámetro (header): `X-Canal` = `app`", markdown, StringComparison.Ordinal);
        Assert.Contains("API Usuarios → Login (responde 201)", markdown, StringComparison.Ordinal);
        Assert.Contains("  - Después: Se muestra la confirmación", markdown, StringComparison.Ordinal);
        Assert.Contains("- [Notas del lienzo](#notas-del-lienzo)", markdown, StringComparison.Ordinal);
        Assert.Contains("## Notas del lienzo\n\n- Pendiente: validar con seguridad\n\n## Tours", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Un_recorrido_sale_con_cada_conexion_en_su_sentido_y_los_grupos_anidados_con_su_padre()
    {
        var graph = Graph();
        graph["nodes"]!["x1"] = new JsonObject { ["id"] = "x1", ["type"] = "api", ["title"] = "API Usuarios" };
        graph["edges"]!["q1"] = new JsonObject { ["id"] = "q1", ["from"] = "s1", ["to"] = "x1", ["kind"] = "request" };
        graph["edges"]!["q2"] = new JsonObject
        {
            ["id"] = "q2", ["from"] = "x1", ["to"] = "s1", ["kind"] = "response", ["replyTo"] = "q1", ["label"] = "creado",
        };
        graph["tours"] = new JsonObject
        {
            ["f1"] = new JsonObject
            {
                ["id"] = "f1",
                ["name"] = "Alta",
                ["steps"] = new JsonArray(
                    new JsonObject { ["edgeId"] = "q1", ["note"] = "Envía el formulario" },
                    new JsonObject { ["edgeId"] = "q2" },
                    new JsonObject { ["removedEdge"] = new JsonObject { ["from"] = "x1", ["to"] = "s1", ["kind"] = "event" } }),
            },
        };
        graph["groups"] = new JsonObject
        {
            ["ga"] = new JsonObject { ["id"] = "ga", ["title"] = "AWS", ["kind"] = "cloud" },
            ["gb"] = new JsonObject { ["id"] = "gb", ["title"] = "Usuarios", ["kind"] = "backend", ["parentId"] = "ga" },
        };
        graph["layout"]!["ga"] = new JsonObject { ["x"] = 0, ["y"] = 0, ["w"] = 800, ["h"] = 600 };
        graph["layout"]!["gb"] = new JsonObject { ["x"] = 40, ["y"] = 80, ["w"] = 400, ["h"] = 300 };

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains("1. **Login → API Usuarios (llama)**: Envía el formulario", markdown, StringComparison.Ordinal);
        Assert.Contains("2. **API Usuarios → Login (responde · creado)**", markdown, StringComparison.Ordinal);
        Assert.Contains("3. **Conexión eliminada: API Usuarios → Login (emite)**", markdown, StringComparison.Ordinal);
        // Los recorridos tienen su propia sección, aparte de los tours.
        Assert.Contains("- [Recorridos](#recorridos)", markdown, StringComparison.Ordinal);
        Assert.Contains("## Recorridos\n\n### Alta", markdown, StringComparison.Ordinal);
        Assert.Contains("### Usuarios (Backend)\n\nDentro de **AWS**.", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public void Los_recursos_salen_agrupados_por_subtipo_con_detalles_y_su_forma_en_el_diagrama()
    {
        var graph = Graph();
        var nodes = graph["nodes"]!.AsObject();
        nodes["r1"] = new JsonObject
        {
            ["id"] = "r1", ["type"] = "resource", ["title"] = "Pagos pendientes",
            ["resource"] = JsonNode.Parse("""
                { "kind": "queue", "provider": "aws", "name": "pagos-pendientes",
                  "details": [{ "key": "retención", "value": "4 días" }] }
                """),
        };
        nodes["r2"] = new JsonObject
        {
            ["id"] = "r2", ["type"] = "resource", ["title"] = "Comprobantes",
            ["resource"] = JsonNode.Parse("""{ "kind": "storage", "provider": "azure" }"""),
        };
        nodes["r3"] = new JsonObject
        {
            ["id"] = "r3", ["type"] = "resource", ["title"] = "Orquestador",
            ["resource"] = JsonNode.Parse("""{ "kind": "custom", "label": "Step Functions" }"""),
        };
        nodes["f1"] = new JsonObject
        {
            ["id"] = "f1", ["type"] = "resource", ["title"] = "Firmar",
            ["resource"] = JsonNode.Parse("""{ "kind": "function" }"""),
        };
        nodes["sv"] = new JsonObject { ["id"] = "sv", ["type"] = "service", ["title"] = "Pagos", ["runtime"] = "container" };
        nodes["db"] = new JsonObject
        {
            ["id"] = "db", ["type"] = "database", ["title"] = "Sesiones",
            ["database"] = JsonNode.Parse("""{ "engine": "Redis", "model": "key-value" }"""),
        };

        var markdown = MarkdownDocument.Render(Input(graph));

        Assert.Contains("- [Recursos](#recursos)", markdown, StringComparison.Ordinal);
        // Agrupados por subtipo (almacenamiento, función, cola… personalizado), no por título.
        var order = ResourceHeadings.Select(h => markdown.IndexOf(h, StringComparison.Ordinal)).ToArray();
        Assert.All(order, i => Assert.True(i > 0));
        Assert.Equal(order.Order(), order);
        Assert.Contains("Tipo: Cola · Proveedor: AWS · Nombre: `pagos-pendientes`", markdown, StringComparison.Ordinal);
        Assert.Contains("| Detalle | Valor |\n| --- | --- |\n| retención | 4 días |", markdown, StringComparison.Ordinal);
        Assert.Contains("Tipo: Step Functions", markdown, StringComparison.Ordinal);
        Assert.Contains("Corre en: contenedor", markdown, StringComparison.Ordinal);
        Assert.Contains("Modelo: clave-valor", markdown, StringComparison.Ordinal);
        // Diagrama: cilindro, bandera y subrutina, con el subtipo como etiqueta.
        Assert.Contains("[(\"Almacenamiento de objetos: Comprobantes\")]", markdown, StringComparison.Ordinal);
        Assert.Contains(">\"Cola: Pagos pendientes\"]", markdown, StringComparison.Ordinal);
        Assert.Contains("[[\"Función: Firmar\"]]", markdown, StringComparison.Ordinal);
        Assert.Contains("(\"Step Functions: Orquestador\")", markdown, StringComparison.Ordinal);
    }

    private static ExportInput Input(JsonObject graph)
    {
        using var doc = JsonDocument.Parse(graph.ToJsonString());
        return new ExportInput(
            "Banca de prueba",
            "Iniciar sesión",
            doc.RootElement.Clone(),
            new Dictionary<Guid, CatalogItemResponse>
            {
                [Item] = new(Item, Guid.Empty, "api", "Consultar cliente", "Busca al cliente por documento.",
                    TestJson.Http("GET", "/clientes/{id}"), 1),
            },
            new Dictionary<Guid, string> { [Transferir] = "Transferir" },
            new Dictionary<Guid, string> { [Asset] = Slugs.ImagePath("Login", Asset, "image/png") },
            ExportedAt);
    }

    /// <summary>
    /// Actor con responsabilidades, API con contrato completo, base con estructura, conexión con datos, notas y
    /// ejemplo, y un grupo de backend con la API y la base (datos ficticios).
    /// </summary>
    private static JsonObject TechnicalGraph() => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = 2,
        ["nodes"] = new JsonObject
        {
            ["a1"] = new JsonObject { ["id"] = "a1", ["type"] = "actor", ["title"] = "Cliente", ["notes"] = "Inicia la transferencia." },
            ["p1"] = new JsonObject
            {
                ["id"] = "p1", ["type"] = "api", ["title"] = "Crear transferencia", ["groupId"] = "g1",
                ["http"] = JsonNode.Parse("""
                    {
                      "method": "POST", "path": "/transferencias",
                      "auth": { "type": "bearer", "description": "Token del canal" },
                      "params": [{ "name": "X-Canal", "in": "header", "type": "string", "required": true, "example": "a|b" }],
                      "request": {
                        "contentType": "application/json",
                        "fields": [{ "name": "monto", "type": "number", "required": true, "description": "En pesos | sin decimales" }],
                        "example": "{ \"monto\": 1000 }"
                      },
                      "responses": [
                        { "status": 201, "description": "Creada", "fields": [{ "name": "id", "type": "uuid" }] },
                        { "status": 422, "description": "Saldo insuficiente" }
                      ]
                    }
                    """),
            },
            ["d1"] = new JsonObject
            {
                ["id"] = "d1", ["type"] = "database", ["title"] = "Core", ["groupId"] = "g1",
                ["database"] = JsonNode.Parse("""
                    {
                      "engine": "PostgreSQL", "name": "core", "schemas": ["pagos"],
                      "tables": [{
                        "name": "transferencias", "schema": "pagos", "kind": "table",
                        "fields": [
                          { "name": "id", "type": "uuid", "key": "primary" },
                          { "name": "cuenta_id", "type": "uuid", "key": "foreign", "nullable": true }
                        ],
                        "relations": [{ "field": "cuenta_id", "references": "cuentas.id" }]
                      }]
                    }
                    """),
            },
        },
        ["edges"] = new JsonObject
        {
            ["e1"] = new JsonObject
            {
                ["id"] = "e1", ["from"] = "p1", ["to"] = "d1", ["kind"] = "writes", ["notes"] = "En una transacción.",
                ["data"] = JsonNode.Parse("""{ "operation": "write", "entities": ["transferencias"] }"""),
                ["example"] = "INSERT INTO transferencias …",
            },
        },
        ["layout"] = new JsonObject(),
        ["groups"] = new JsonObject
        {
            ["g1"] = new JsonObject { ["id"] = "g1", ["title"] = "Core bancario", ["kind"] = "backend", ["collapsed"] = true },
        },
    };

    /// <summary>Actor, pantalla con imagen e inputs, regla, ref a una API del catálogo, portal, conexiones y un tour.</summary>
    private static JsonObject Graph() => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = 3,
        ["nodes"] = new JsonObject
        {
            ["a1"] = new JsonObject { ["id"] = "a1", ["type"] = "actor", ["title"] = "Cliente" },
            ["s1"] = new JsonObject
            {
                ["id"] = "s1", ["type"] = "screen", ["title"] = "Login", ["description"] = "Pide el documento.",
                ["assetId"] = Asset.ToString(),
                ["inputs"] = new JsonArray(
                    new JsonObject { ["name"] = "documento", ["type"] = "string", ["required"] = true, ["ruleIds"] = new JsonArray("r1") },
                    new JsonObject { ["name"] = "tipo", ["type"] = "enum", ["options"] = new JsonArray("CC", "CE") }),
            },
            ["r1"] = new JsonObject
            {
                ["id"] = "r1", ["type"] = "rule", ["title"] = "Documento válido", ["expression"] = "solo dígitos\nde 6 a 10",
            },
            ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "Título viejo", ["catalogId"] = Item.ToString() },
            ["p1"] = new JsonObject
            {
                ["id"] = "p1", ["type"] = "portal", ["title"] = "Transferir", ["targetFeatureId"] = Transferir.ToString(),
            },
        },
        ["edges"] = new JsonObject
        {
            ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "a1", ["to"] = "s1", ["kind"] = "uses" },
            ["e2"] = new JsonObject
            {
                ["id"] = "e2", ["from"] = "s1", ["to"] = "c1", ["kind"] = "request", ["label"] = "Buscar", ["when"] = "200",
            },
            ["e3"] = new JsonObject { ["id"] = "e3", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" },
        },
        ["layout"] = new JsonObject(),
        ["tours"] = new JsonObject
        {
            ["t1"] = new JsonObject
            {
                ["id"] = "t1",
                ["name"] = "Primer ingreso",
                ["steps"] = new JsonArray(
                    new JsonObject { ["nodeId"] = "s1", ["note"] = "Aquí empieza todo." },
                    new JsonObject { ["nodeId"] = "c1" }),
            },
        },
    };
}
