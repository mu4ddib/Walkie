using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Discovery.Features;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Rendimiento de la arquitectura descubierta por fase (spec walkie-live-documentacion, revisión final, punto 5): con
/// los estados la vista general pasó de 193 a 470 ms con 20.000 hallazgos. Esta prueba mide cada fase por separado
/// (consultas de la arquitectura, cada parte de la clasificación, proyección y serialización) y cuenta las consultas
/// SQL que hace Npgsql: tienen que ser las mismas con cualquier tamaño (sin N+1). Nada se guarda: no hay una segunda
/// arquitectura persistida. Con <c>WALKIE_BENCH=1</c> mide además 20.000 hallazgos.
/// </summary>
public sealed partial class DiscoveryArchitectureTests
{
    [Fact]
    public async Task La_vista_general_hace_las_mismas_consultas_con_cualquier_tamano_y_se_mide_por_fase()
    {
        using var client = factory.CreateAuthenticatedClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var appId = await CreateAppAsync(client, "Arquitectura por fases");
        var queries = new List<int>();
        foreach (var resources in Bench ? new[] { 40, 400, 2_900 } : [40, 400])
        {
            var pack = Synthetic(resources);
            var snapshotId = await UploadSnapshotAsync(client, appId, pack);
            var entities = Open(pack).Discovery["entities"]!.AsArray().Count;
            using var scope = factory.Services.CreateScope();
            var handlers = scope.ServiceProvider.GetRequiredService<ArchitectureHandlers>();
            await handlers.OverviewAsync(snapshotId, null, CancellationToken.None); // en caliente

            var runs = new List<Dictionary<string, double>>();
            var commands = 0;
            for (var i = 0; i < 5; i++)
            {
                var timer = new PhaseTimer();
                commands = 0;
                using (var listener = CountNpgsqlCommands(() => Interlocked.Increment(ref commands)))
                {
                    var overview = await handlers.OverviewAsync(snapshotId, timer, CancellationToken.None);
                    _ = JsonSerializer.Serialize(overview, JsonSerializerOptions.Web);
                    timer.Lap("serialización");
                }

                runs.Add(timer.Phases);
            }

            // Por HTTP (autorización, serialización del endpoint y transporte) y el análisis del JSON en el cliente, aparte.
            var http = new List<double>();
            var parse = new List<double>();
            var schema = new List<double>();
            var bytes = 0;
            for (var i = 0; i < 5; i++)
            {
                var watch = Stopwatch.StartNew();
                var response = await client.GetAsync(new Uri($"/api/snapshots/{snapshotId}/architecture", UriKind.Relative));
                var body = await response.Content.ReadAsByteArrayAsync();
                http.Add(watch.Elapsed.TotalMilliseconds);
                watch.Restart();
                using var document = JsonDocument.Parse(body);
                parse.Add(watch.Elapsed.TotalMilliseconds);
                watch.Restart();
                Assert.Empty(Walkie.Shared.Schemas.WalkieSchemas.Errors(Walkie.Shared.Schemas.WalkieSchemas.DiscoveryArchitecture, document.RootElement));
                schema.Add(watch.Elapsed.TotalMilliseconds);
                bytes = body.Length;
            }

            queries.Add(commands);
            output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                $"  {entities} hallazgos por HTTP: {http.Order().ElementAt(2):0} ms (mediana), respuesta {bytes / 1024} KB, análisis del JSON {parse.Order().ElementAt(2):0.0} ms; validar la respuesta contra el schema (lo hace la prueba, no la API) {schema.Order().ElementAt(2):0} ms"));
            var median = runs[0].Keys.ToDictionary(k => k, k => runs.Select(r => r.GetValueOrDefault(k)).Order().ElementAt(2));
            output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                $"  {entities} hallazgos, {commands} consultas SQL, total {median.Values.Sum():0} ms: {string.Join(" · ", median.Where(p => p.Value >= 0.05).Select(p => $"{p.Key} {p.Value:0.0}"))}"));
        }

        // Sin N+1: las mismas consultas con 40 recursos que con miles.
        Assert.All(queries, q => Assert.Equal(queries[0], q));
    }

    /// <summary>Cuenta los comandos que ejecuta Npgsql (su <c>ActivitySource</c>) mientras está vivo.</summary>
    private static ActivityListener CountNpgsqlCommands(Action counted)
    {
        var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "Npgsql",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStarted = _ => counted(),
        };
        ActivitySource.AddActivityListener(listener);
        return listener;
    }
}
