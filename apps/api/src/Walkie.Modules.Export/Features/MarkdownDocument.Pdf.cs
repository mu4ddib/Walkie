using System.Globalization;
using System.Text.Json;
using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;

namespace Walkie.Modules.Export.Features;

/// <summary>Una imagen para el PDF: sus bytes y su tipo (PNG o JPEG; WebP no se puede incluir).</summary>
internal sealed record PdfImage(byte[] Bytes, string ContentType);

/// <summary>
/// PDF de una feature (spec exportar-e-importar, tarea 4; ADR-0008): portada, la imagen del lienzo (la manda el
/// navegador) y el contenido del Markdown —componentes por tipo con tablas, conexiones, recorridos, tours y lo que
/// falta documentar—, armado con MigraDoc desde el mismo modelo que el contexto para IA.
/// </summary>
internal static partial class MarkdownDocument
{
    private static readonly Color Ink = new(0x1b, 0x1c, 0x33);
    private static readonly Color Muted = new(0x5c, 0x58, 0x52);
    private static readonly Color Spice = new(0xa8, 0x4b, 0x16);
    private static readonly Color Rule = new(0xe0, 0xd5, 0xc2);
    private static readonly Color HeaderFill = new(0xf3, 0xec, 0xdf);

    /// <param name="context">El contexto de la feature (último lienzo guardado).</param>
    /// <param name="canvas">Imagen del lienzo; sin ella, el PDF no tiene esa página.</param>
    /// <param name="screens">Imagen de cada pantalla, por id de nodo.</param>
    public static byte[] RenderPdf(AiContext context, PdfImage? canvas, IReadOnlyDictionary<string, PdfImage> screens)
    {
        PdfFonts.Install();
        var doc = new Document();
        doc.Info.Title = context.Feature.Name;
        doc.Info.Subject = $"Documentación de {context.Feature.Name} ({context.App.Name})";
        doc.Info.Author = "Walkie";
        DefineStyles(doc);

        var cover = doc.AddSection();
        Page(cover, Orientation.Portrait);
        WriteCover(cover, context);

        if (canvas is not null && Supported(canvas))
        {
            var page = doc.AddSection();
            Page(page, Orientation.Landscape);
            page.AddParagraph("Lienzo", "Heading1");
            var image = page.AddImage(Base64(canvas));
            image.LockAspectRatio = true;
            // Con ancho y alto a la vez MigraDoc estira la imagen: se fija solo el lado que limita, según su proporción.
            var width = page.PageSetup.PageWidth - page.PageSetup.LeftMargin - page.PageSetup.RightMargin;
            var height = page.PageSetup.PageHeight - page.PageSetup.TopMargin - page.PageSetup.BottomMargin - Unit.FromCentimeter(1.5);
            if (PngSize(canvas.Bytes) is { } size && (double)size.Height / size.Width > height.Point / width.Point)
            {
                image.Height = height;
            }
            else
            {
                image.Width = width;
            }
        }

        var body = doc.AddSection();
        Page(body, Orientation.Portrait);
        Footer(body, context);
        WriteBody(body, context, screens);

        var renderer = new PdfDocumentRenderer { Document = doc };
        renderer.RenderDocument();
        using var output = new MemoryStream();
        renderer.PdfDocument.Save(output, false);
        return output.ToArray();
    }

    private static void DefineStyles(Document doc)
    {
        var normal = doc.Styles[StyleNames.Normal]!;
        normal.Font.Name = PdfFonts.Sans;
        normal.Font.Size = 10;
        normal.Font.Color = Ink;
        normal.ParagraphFormat.SpaceAfter = Unit.FromPoint(4);

        var h1 = doc.Styles[StyleNames.Heading1]!;
        h1.Font.Size = 18;
        h1.Font.Bold = true;
        h1.Font.Color = Spice;
        h1.ParagraphFormat.SpaceBefore = Unit.FromPoint(6);
        h1.ParagraphFormat.SpaceAfter = Unit.FromPoint(10);
        h1.ParagraphFormat.KeepWithNext = true;

        var h2 = doc.Styles[StyleNames.Heading2]!;
        h2.Font.Size = 13;
        h2.Font.Bold = true;
        h2.ParagraphFormat.SpaceBefore = Unit.FromPoint(12);
        h2.ParagraphFormat.SpaceAfter = Unit.FromPoint(4);
        h2.ParagraphFormat.KeepWithNext = true;

        var h3 = doc.Styles[StyleNames.Heading3]!;
        h3.Font.Size = 11;
        h3.Font.Bold = true;
        h3.ParagraphFormat.SpaceBefore = Unit.FromPoint(8);
        h3.ParagraphFormat.KeepWithNext = true;

        var muted = doc.Styles.AddStyle("Muted", StyleNames.Normal);
        muted.Font.Color = Muted;
        muted.Font.Size = 9;

        var code = doc.Styles.AddStyle("Code", StyleNames.Normal);
        code.Font.Name = PdfFonts.Mono;
        code.Font.Size = 8.5;
        code.ParagraphFormat.Shading.Color = HeaderFill;
        code.ParagraphFormat.LeftIndent = Unit.FromPoint(4);

        var cell = doc.Styles.AddStyle("Cell", StyleNames.Normal);
        cell.Font.Size = 8.5;
        cell.ParagraphFormat.SpaceAfter = Unit.FromPoint(0);
    }

    /// <summary>A4 con su orientación. Ancho y alto explícitos: con solo <c>Orientation</c>, MigraDoc deja la hoja vertical.</summary>
    private static void Page(Section section, Orientation orientation)
    {
        section.PageSetup = section.Document!.DefaultPageSetup.Clone();
        var (shortSide, longSide) = (Unit.FromMillimeter(210), Unit.FromMillimeter(297));
        section.PageSetup.Orientation = Orientation.Portrait;
        section.PageSetup.PageWidth = orientation == Orientation.Landscape ? longSide : shortSide;
        section.PageSetup.PageHeight = orientation == Orientation.Landscape ? shortSide : longSide;
        section.PageSetup.TopMargin = Unit.FromCentimeter(2);
        section.PageSetup.BottomMargin = Unit.FromCentimeter(2);
        section.PageSetup.LeftMargin = Unit.FromCentimeter(2);
        section.PageSetup.RightMargin = Unit.FromCentimeter(2);
    }

    private static void Footer(Section section, AiContext context)
    {
        var footer = section.Footers.Primary.AddParagraph();
        footer.Style = "Muted";
        footer.AddText($"{context.Feature.Name} · {context.App.Name} · página ");
        footer.AddPageField();
        footer.AddText(" de ");
        footer.AddNumPagesField();
    }

    private static void WriteCover(Section section, AiContext c)
    {
        var brand = section.AddParagraph("Walkie", "Muted");
        brand.Format.SpaceAfter = Unit.FromCentimeter(6);
        var title = section.AddParagraph(c.Feature.Name);
        title.Format.Font.Size = 28;
        title.Format.Font.Bold = true;
        title.Format.SpaceAfter = Unit.FromPoint(8);
        section.AddParagraph($"App: {c.App.Name}");
        section.AddParagraph(string.Create(CultureInfo.InvariantCulture,
            $"Versión del lienzo: {c.CanvasVersion} · Exportado el {c.ExportedAt.UtcDateTime:yyyy-MM-dd HH:mm} (UTC)"), "Muted");
        var purpose = section.AddParagraph(c.Feature.Description ?? "Sin descripción.");
        purpose.Format.SpaceBefore = Unit.FromCentimeter(1);
        var counts = section.AddParagraph(string.Create(CultureInfo.InvariantCulture,
            $"{c.Components.Count} componentes · {c.Connections.Count} conexiones · {c.Flows.Count(f => f.Kind == "flow")} recorridos · {c.Flows.Count(f => f.Kind == "guide")} tours · {c.Gaps.Count} pendientes de documentar"), "Muted");
        counts.Format.SpaceBefore = Unit.FromPoint(12);
    }

    private static void WriteBody(Section section, AiContext c, IReadOnlyDictionary<string, PdfImage> screens)
    {
        if (c.Components.Count == 0)
        {
            section.AddParagraph("El lienzo está vacío.");
            return;
        }

        foreach (var (type, heading, _) in Sections.Where(s => c.Components.Any(n => n.Type == s.Type)))
        {
            section.AddParagraph(heading, "Heading1");
            foreach (var component in c.Components.Where(n => n.Type == type))
            {
                WritePdfComponent(section, component, screens);
            }
        }

        if (c.Connections.Count > 0)
        {
            section.AddParagraph("Conexiones", "Heading1");
            var table = Table(section, ("Conexión", 11), ("Notas", 6));
            foreach (var e in c.Connections)
            {
                Row(table, e.Text, string.Join(" — ", new[] { e.Outcome is { } o ? $"Después: {o}" : null, e.Notes }.Where(x => x is not null)));
            }
        }

        foreach (var (kind, heading) in new[] { ("flow", "Recorridos"), ("guide", "Tours") })
        {
            var flows = c.Flows.Where(f => f.Kind == kind).ToList();
            if (flows.Count == 0)
            {
                continue;
            }

            section.AddParagraph(heading, "Heading1");
            foreach (var flow in flows)
            {
                section.AddParagraph(flow.Name, "Heading2");
                foreach (var step in flow.Steps)
                {
                    var p = section.AddParagraph();
                    p.Format.LeftIndent = Unit.FromCentimeter(0.6);
                    p.Format.FirstLineIndent = Unit.FromCentimeter(-0.6);
                    p.AddFormattedText(string.Create(CultureInfo.InvariantCulture, $"{step.N}. "), TextFormat.Bold);
                    p.AddText(step.Text);
                    if (step.Note is { } note)
                    {
                        p.AddFormattedText($" — {note}", TextFormat.Italic);
                    }
                }
            }
        }

        // Módulos compartidos (spec modulos-compartidos): qué expone y qué contiene cada uno.
        if (c.Modules is { Count: > 0 } modules)
        {
            section.AddParagraph("Módulos", "Heading1");
            foreach (var module in modules)
            {
                section.AddParagraph(module.Name, "Heading2");
                if (module.Description is { } description)
                {
                    section.AddParagraph(description);
                }

                if (module.Interfaces.Count > 0)
                {
                    var table = Table(section, ("Interfaz", 5), ("Tipo", 2.5), ("Contrato y caja", 9.5));
                    foreach (var i in module.Interfaces)
                    {
                        var http = string.Join(' ', new[] { i.Method, i.Path }.Where(x => !string.IsNullOrEmpty(x)));
                        var detail = string.Join(" · ", new[] { http.Length > 0 ? http : null, i.Component, i.InternalFlow is { } f ? $"recorrido interno: {f}" : null }
                            .Where(x => x is not null));
                        Row(table, i.Name, InterfaceKindText(i.Kind), detail);
                    }
                }

                section.AddParagraph("Contiene: " + (module.Components.Count == 0
                    ? "nada todavía."
                    : string.Join(", ", module.Components.Select(x => $"{x.Title} ({x.Is})")) + "."));
                foreach (var connection in module.Connections)
                {
                    section.AddParagraph($"• {connection}");
                }
            }
        }

        if (c.Gaps.Count > 0)
        {
            section.AddParagraph("Pendientes de documentar", "Heading1");
            foreach (var gap in c.Gaps)
            {
                section.AddParagraph($"• {gap.Message}");
            }
        }
    }

    private static void WritePdfComponent(Section section, AiComponent c, IReadOnlyDictionary<string, PdfImage> screens)
    {
        section.AddParagraph($"{c.Title} ({c.Is})", "Heading2");
        var facts = new List<string>();
        if (c.Group is { } group)
        {
            facts.Add($"Grupo: {group}");
        }

        if (c.CatalogId is not null)
        {
            facts.Add("Componente compartido del catálogo");
        }

        if (c.Runtime is { } runtime)
        {
            facts.Add($"Corre en: {Runtimes.GetValueOrDefault(runtime, runtime)}");
        }

        if (c.IsPortal)
        {
            facts.Add(c.TargetFeature is { } target ? $"Lleva a: {target}" : "Sin feature destino");
        }

        if (facts.Count > 0)
        {
            section.AddParagraph(string.Join(" · ", facts), "Muted");
        }

        if (c.Description is { } description)
        {
            section.AddParagraph(description);
        }

        if (c.Type == "screen" && screens.TryGetValue(c.Id, out var screen))
        {
            if (Supported(screen))
            {
                var image = section.AddParagraph().AddImage(Base64(screen));
                image.LockAspectRatio = true;
                image.Width = Unit.FromCentimeter(8);
            }
            else
            {
                section.AddParagraph("(La imagen de la pantalla está en WebP: se ve en Walkie y en el Markdown, no en el PDF.)", "Muted");
            }
        }

        if (c.Notes is { } notes)
        {
            var label = section.AddParagraph();
            label.AddFormattedText(c.Type is "actor" or "service" ? "Responsabilidades: " : "Notas: ", TextFormat.Bold);
            label.AddText(notes);
        }

        if (c.Expression is { } expression)
        {
            section.AddParagraph(expression, "Code");
        }

        if (c.Inputs is { } inputs)
        {
            section.AddParagraph("Inputs", "Heading3");
            var table = Table(section, ("Nombre", 3.5), ("Tipo", 2.5), ("Obligatorio", 2.2), ("Opciones", 4), ("Validado por", 4.8));
            foreach (var i in inputs)
            {
                Row(table, i.Name, i.Type, i.Required == true ? "Sí" : "No", string.Join(", ", i.Options ?? []), string.Join(", ", i.Rules ?? []));
            }
        }

        if (c.Http is { ValueKind: JsonValueKind.Object } http)
        {
            WritePdfContract(section, http);
        }

        if (c.Database is { ValueKind: JsonValueKind.Object } database)
        {
            WritePdfDatabase(section, database);
        }

        if (c.Resource is { ValueKind: JsonValueKind.Object } resource)
        {
            var line = new List<string> { $"Tipo: {ResourceLabel(resource)}" };
            if (Text(resource, "provider") is { } provider)
            {
                line.Add($"Proveedor: {Providers.GetValueOrDefault(provider, provider)}");
            }

            if (Text(resource, "name") is { } name)
            {
                line.Add($"Nombre: {name}");
            }

            section.AddParagraph(string.Join(" · ", line));
            var details = Items(resource, "details");
            if (details.Count > 0)
            {
                var table = Table(section, ("Detalle", 6), ("Valor", 11));
                foreach (var d in details)
                {
                    Row(table, Text(d, "key") ?? string.Empty, Text(d, "value") ?? string.Empty);
                }
            }
        }
    }

    private static void WritePdfContract(Section section, JsonElement http)
    {
        var endpoint = string.Join(' ', new[] { Text(http, "method"), Text(http, "path") }.Where(x => x is not null));
        if (endpoint.Length > 0)
        {
            section.AddParagraph(endpoint, "Code");
        }

        if (http.TryGetProperty("auth", out var auth) && Text(auth, "type") is { } authType)
        {
            section.AddParagraph($"Autenticación: {AuthTypes.GetValueOrDefault(authType, authType)}"
                + (Text(auth, "description") is { } d ? $" — {d}" : string.Empty));
        }

        var parameters = Items(http, "params");
        if (parameters.Count > 0)
        {
            section.AddParagraph("Parámetros", "Heading3");
            var table = Table(section, ("Nombre", 4), ("En", 2.5), ("Tipo", 2.5), ("Obligatorio", 2.2), ("Ejemplo", 5.8));
            foreach (var p in parameters)
            {
                var place = Text(p, "in") ?? string.Empty;
                Row(table, Text(p, "name") ?? string.Empty, ParamPlaces.GetValueOrDefault(place, place), Text(p, "type") ?? string.Empty,
                    p.TryGetProperty("required", out var r) && r.ValueKind == JsonValueKind.True ? "Sí" : "No", Text(p, "example") ?? string.Empty);
            }
        }

        if (http.TryGetProperty("request", out var request) && request.ValueKind == JsonValueKind.Object)
        {
            WritePdfFields(section, "Request", request);
        }

        foreach (var response in Items(http, "responses"))
        {
            var status = response.TryGetProperty("status", out var s) && s.TryGetInt32(out var code)
                ? code.ToString(CultureInfo.InvariantCulture)
                : "—";
            WritePdfFields(section, $"Respuesta {status}" + (Text(response, "description") is { } d ? $": {d}" : string.Empty), response);
        }
    }

    private static void WritePdfFields(Section section, string title, JsonElement body)
    {
        section.AddParagraph(title, "Heading3");
        var fields = Items(body, "fields");
        if (fields.Count > 0)
        {
            var table = Table(section, ("Campo", 4), ("Tipo", 3), ("Obligatorio", 2.2), ("Descripción", 7.8));
            foreach (var f in fields)
            {
                Row(table, Text(f, "name") ?? string.Empty, Text(f, "type") ?? string.Empty,
                    f.TryGetProperty("required", out var r) && r.ValueKind == JsonValueKind.True ? "Sí" : "No", Text(f, "description") ?? string.Empty);
            }
        }

        if (Text(body, "example") is { } example)
        {
            section.AddParagraph(example, "Code");
        }
    }

    private static void WritePdfDatabase(Section section, JsonElement database)
    {
        var facts = new List<string>();
        if (Text(database, "model") is { } model)
        {
            facts.Add($"Modelo: {DatabaseModels.GetValueOrDefault(model, model)}");
        }

        if (Text(database, "engine") is { } engine)
        {
            facts.Add($"Motor: {engine}");
        }

        if (Text(database, "name") is { } name)
        {
            facts.Add($"Base: {name}");
        }

        if (facts.Count > 0)
        {
            section.AddParagraph(string.Join(" · ", facts));
        }

        foreach (var t in Items(database, "tables"))
        {
            var kind = Text(t, "kind") ?? "table";
            section.AddParagraph($"{TableKinds.GetValueOrDefault(kind, kind)} {Text(t, "name")}", "Heading3");
            var fields = Items(t, "fields");
            if (fields.Count == 0)
            {
                continue;
            }

            var table = Table(section, ("Campo", 4.5), ("Tipo", 3.5), ("Clave", 2.5), ("Nulo", 1.5), ("Descripción", 5));
            foreach (var f in fields)
            {
                var key = Text(f, "key");
                Row(table, Text(f, "name") ?? string.Empty, Text(f, "type") ?? string.Empty,
                    key is null ? string.Empty : Keys.GetValueOrDefault(key, key),
                    f.TryGetProperty("nullable", out var n) && n.ValueKind == JsonValueKind.True ? "Sí" : string.Empty,
                    Text(f, "description") ?? string.Empty);
            }
        }
    }

    /// <summary>Tabla con encabezado sombreado; los anchos van en centímetros (la página útil mide 17).</summary>
    private static Table Table(Section section, params (string Header, double Width)[] columns)
    {
        var table = section.AddTable();
        table.Borders.Color = Rule;
        table.Borders.Width = 0.5;
        table.Format.Font.Size = 8.5;
        table.TopPadding = Unit.FromPoint(2);
        table.BottomPadding = Unit.FromPoint(2);
        foreach (var (_, width) in columns)
        {
            table.AddColumn(Unit.FromCentimeter(width));
        }

        var header = table.AddRow();
        header.HeadingFormat = true;
        header.Shading.Color = HeaderFill;
        for (var i = 0; i < columns.Length; i++)
        {
            header.Cells[i].AddParagraph().AddFormattedText(columns[i].Header, TextFormat.Bold);
        }

        // Aire después de la tabla.
        section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(2);
        return table;
    }

    private static void Row(Table table, params string[] values)
    {
        var row = table.AddRow();
        for (var i = 0; i < values.Length; i++)
        {
            row.Cells[i].AddParagraph(values[i]).Style = "Cell";
        }
    }

    /// <summary>Ancho y alto de un PNG (cabecera IHDR); <c>null</c> si no lo es.</summary>
    internal static (int Width, int Height)? PngSize(byte[] png) =>
        png.Length >= 24 && png[12] == 'I' && png[13] == 'H' && png[14] == 'D' && png[15] == 'R'
            ? (System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16)),
                System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20)))
            : null;

    private static bool Supported(PdfImage image) => image.ContentType is "image/png" or "image/jpeg";

    private static string Base64(PdfImage image) => "base64:" + Convert.ToBase64String(image.Bytes);
}
