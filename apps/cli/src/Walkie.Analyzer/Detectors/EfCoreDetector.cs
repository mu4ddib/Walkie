using System.Text.Json.Nodes;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Walkie.Shared.Discovery;

namespace Walkie.Analyzer.Detectors;

/// <summary>
/// Entity Framework Core con Roslyn solo sintáctico: cada clase que hereda de un <c>*DbContext</c> es una base
/// lógica con sus <c>DbSet&lt;T&gt;</c> como tablas y su <c>HasDefaultSchema("…")</c> como schema. El motor sale de
/// <c>UseNpgsql</c>, <c>UseSqlServer</c>… en el mismo proyecto. La base física y su nombre vienen de la configuración
/// en tiempo de ejecución, así que no se adivinan: una base de docker-compose y un DbContext pueden ser la misma, y
/// eso lo decide una persona en la revisión.
/// </summary>
public sealed class EfCoreDetector : IDetector
{
    private static readonly Dictionary<string, (string Engine, string Model)> Providers = new(StringComparer.Ordinal)
    {
        ["UseNpgsql"] = ("PostgreSQL", "relational"),
        ["UseSqlServer"] = ("SQL Server", "relational"),
        ["UseAzureSql"] = ("SQL Server", "relational"),
        ["UseSqlite"] = ("SQLite", "relational"),
        ["UseMySql"] = ("MySQL", "relational"),
        ["UseMySQL"] = ("MySQL", "relational"),
        ["UseOracle"] = ("Oracle", "relational"),
        ["UseCosmos"] = ("Cosmos DB", "document"),
        ["UseMongoDB"] = ("MongoDB", "document"),
        ["UseInMemoryDatabase"] = ("InMemory", "relational"),
    };

    public string Id => "efcore";

    public IReadOnlyList<string> Entities { get; } = ["database", "module"];

    public IReadOnlyList<string> Relations { get; } = ["depends-on"];

    public void Run(AnalysisContext context)
    {
        var contexts = new List<(SourceFile File, DotnetProject? Owner, ClassDeclarationSyntax Type)>();
        var engines = new Dictionary<string, (string Engine, string Model, SourceFile File, InvocationExpressionSyntax Call)>(StringComparer.Ordinal);

        foreach (var file in context.Files.Where(f => f.Extension.Equals(".cs", StringComparison.OrdinalIgnoreCase)))
        {
            var owner = context.ProjectOf(file.Path);
            if (owner?.Role is DotnetProjectRole.Test or DotnetProjectRole.Tool
                || context.Read(file, Id) is not { } text || !text.Contains("DbContext", StringComparison.Ordinal)
                || context.CSharp(file, Id)?.GetRoot() is not { } root)
            {
                continue;
            }

            foreach (var type in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                if (type.BaseList?.Types.Any(t => Roslyn.SimpleName(t.Type) is { } b && b.EndsWith("DbContext", StringComparison.Ordinal)) == true)
                {
                    contexts.Add((file, owner, type));
                }
            }

            foreach (var call in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                if (Roslyn.InvokedName(call) is { } name && Providers.TryGetValue(name, out var provider))
                {
                    engines.TryAdd(owner?.Path ?? "", (provider.Engine, provider.Model, file, call));
                }
            }
        }

        foreach (var (file, owner, type) in contexts)
        {
            Database(context, file, owner, type, engines.TryGetValue(owner?.Path ?? "", out var engine) ? engine : null);
        }

        if (contexts.Count > 0)
        {
            context.Findings.Limitation("efcore-logical-database",
                "Cada DbContext se propone como una base lógica (sus DbSet como tablas, con el nombre de la propiedad): la base física, su nombre y los nombres reales de las tablas vienen de la configuración y del modelo en tiempo de ejecución.",
                Id, incomplete: false);
        }
    }

    private void Database(AnalysisContext context, SourceFile file, DotnetProject? owner, ClassDeclarationSyntax type,
        (string Engine, string Model, SourceFile File, InvocationExpressionSyntax Call)? engine)
    {
        var name = type.Identifier.Text;
        var evidence = context.Findings.Evidence(Id, file.Path, Confidence.Medium, name, Roslyn.LinesOf(type),
            $"Clase que hereda de {type.BaseList!.Types.Select(t => Roslyn.SimpleName(t.Type)).First(b => b!.EndsWith("DbContext", StringComparison.Ordinal))}");
        context.Findings.Technology("efcore", "Entity Framework Core", null, evidence);

        var schema = type.DescendantNodes().OfType<InvocationExpressionSyntax>()
            .Where(i => Roslyn.InvokedName(i) == "HasDefaultSchema" && i.ArgumentList.Arguments.Count > 0)
            .Select(i => Roslyn.StringLiteral(i.ArgumentList.Arguments[0].Expression))
            .FirstOrDefault(s => s is not null);
        var tables = type.Members.OfType<PropertyDeclarationSyntax>()
            .Where(p => p.Type is GenericNameSyntax { Identifier.Text: "DbSet" })
            .Select(p => p.Identifier.Text)
            .Order(StringComparer.Ordinal)
            .Take(200)
            .ToList();

        var database = new JsonObject();
        if (engine is { } e)
        {
            database["engine"] = e.Engine;
            database["model"] = e.Model;
            var providerEvidence = context.Findings.Evidence(Id, e.File.Path, Confidence.High, Roslyn.SymbolOf(e.Call), Roslyn.LinesOf(e.Call),
                $"{Roslyn.InvokedName(e.Call)}: proveedor de EF Core");
            var technology = e.Engine switch
            {
                "PostgreSQL" => ("postgresql", "PostgreSQL"),
                "SQL Server" => ("sqlserver", "SQL Server"),
                "SQLite" => ("sqlite", "SQLite"),
                "MySQL" => ("mysql", "MySQL"),
                "Oracle" => ("oracle", "Oracle"),
                "Cosmos DB" => ("cosmosdb", "Cosmos DB"),
                "MongoDB" => ("mongodb", "MongoDB"),
                _ => ((string, string)?)null,
            };
            if (technology is { } t)
            {
                context.Findings.Technology(t.Item1, t.Item2, null, providerEvidence);
            }
        }
        else
        {
            context.Findings.Limitation("unknown-database-engine",
                $"{name}: no se encontró el proveedor (UseNpgsql, UseSqlServer…) en su proyecto.", Id, file.Path);
        }

        if (schema is not null)
        {
            database["schemas"] = new JsonArray(schema);
        }

        if (tables.Count > 0)
        {
            database["tables"] = new JsonArray([.. tables.Select(t =>
            {
                var table = new JsonObject { ["name"] = t };
                if (schema is not null)
                {
                    table["schema"] = schema;
                }

                table["kind"] = "table";
                return (JsonNode)table;
            })]);
        }

        var key = DiscoveryKeys.Database(engine?.Engine ?? "efcore", name);
        if (context.Findings.Entity(key, "database", name, Basis.Observed, Confidence.Medium, evidence) is not { } entity)
        {
            return;
        }

        entity.Technology ??= "efcore";
        entity.Database ??= database;
        context.DbContexts.TryAdd(name, key);

        switch (owner?.Role)
        {
            case DotnetProjectRole.Service when context.Findings.Entities.ContainsKey(owner.ServiceKey):
                context.Findings.Relation("depends-on", owner.ServiceKey, key, Basis.Observed, Confidence.Medium, evidence);
                break;
            case DotnetProjectRole.Library:
                if (context.Findings.Entity(owner.ModuleKey, "module", owner.Name, Basis.Inferred, Confidence.Medium, owner.EvidenceId) is { } module)
                {
                    module.AddMember(key);
                    context.Findings.Relation("depends-on", owner.ModuleKey, key, Basis.Observed, Confidence.Medium, evidence);
                }

                break;
        }
    }
}
