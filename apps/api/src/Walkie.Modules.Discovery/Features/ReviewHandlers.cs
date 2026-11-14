using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

internal abstract record ReviewResult
{
    public sealed record Done(DiscoveryReviewResponse Review) : ReviewResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : ReviewResult;

    public sealed record NotFound : ReviewResult;
}

/// <summary>
/// Revisión calculada de un análisis (spec walkie-live, tarea 4; ADR-0012 y ADR-0014). No se guarda: sale del análisis,
/// los vínculos de su fuente, el análisis anterior y el catálogo, los módulos y las features actuales de la app.
/// <para>
/// Precedencia de estados, de mayor a menor (un hallazgo tiene uno solo):
/// <list type="number">
/// <item>tiene vínculo y su fingerprint cambió desde que se decidió → <c>changed</c>;</item>
/// <item>tiene vínculo → su decisión (<c>linked</c>, <c>created</c> o <c>rejected</c>);</item>
/// <item>un solo elemento coincide por firma → <c>matched</c> (signature); varios → <c>new</c> con <c>candidates</c>;</item>
/// <item>un solo elemento coincide por título → <c>matched</c> (title); varios → <c>new</c> con <c>candidates</c>;</item>
/// <item>nada → <c>new</c>.</item>
/// </list>
/// Aparte, <c>missing</c>: un hallazgo del análisis anterior con vínculo que ya no está, solo si
/// <see cref="MissingRules"/> dice que el análisis actual podía verlo.
/// </para>
/// Consultas: una proyección sin <c>jsonb</c> de todas las entidades (para clasificar y contar), el <c>jsonb</c> solo
/// de las de la página, los vínculos de la fuente y la evidencia del análisis anterior solo de los posibles
/// desaparecidos. Todo en una transacción de lectura repetible: los conteos y la página salen de los mismos datos.
/// </summary>
internal sealed class ReviewHandlers(DiscoveryDbContext db, ICatalogDirectory catalog, IFeatureDirectory features)
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 500;

    private static readonly string[] Kinds = ["api", "service", "database", "resource", "screen", "module", "feature"];
    private static readonly string[] Statuses = ["new", "matched", "linked", "created", "rejected", "changed", "missing"];

    public async Task<ReviewResult> ReviewAsync(Guid snapshotId, string? kind, string? status, int? page, int? pageSize, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (kind is not null && !Kinds.Contains(kind))
        {
            errors["kind"] = [$"Tipo desconocido. Usa uno de: {string.Join(", ", Kinds)}."];
        }

        if (status is not null && !Statuses.Contains(status))
        {
            errors["status"] = [$"Estado desconocido. Usa uno de: {string.Join(", ", Statuses)}."];
        }

        if (page is < 0)
        {
            errors["page"] = ["La página empieza en 0."];
        }

        if (pageSize is < 1 or > MaxPageSize)
        {
            errors["pageSize"] = [$"Entre 1 y {MaxPageSize}."];
        }

        if (errors.Count > 0)
        {
            return new ReviewResult.Invalid(errors);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct).ConfigureAwait(false);
        var snapshot = await db.Snapshots.AsNoTracking().FirstOrDefaultAsync(s => s.Id == snapshotId, ct).ConfigureAwait(false);
        if (snapshot is null)
        {
            return new ReviewResult.NotFound();
        }

        var entities = await db.Entities.AsNoTracking()
            .Where(e => e.SnapshotId == snapshotId)
            .Select(e => new Row(e.Key, e.Kind, e.Title, e.Basis, e.Confidence, e.Fingerprint))
            .ToListAsync(ct).ConfigureAwait(false);
        var bindings = await db.Bindings.AsNoTracking()
            .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && b.Decision != null)
            .ToDictionaryAsync(b => b.EntityKey, StringComparer.Ordinal, ct).ConfigureAwait(false);

        var index = new MatchIndex(await ExistingTargetsAsync(snapshot.AppId, ct).ConfigureAwait(false));
        // A qué hallazgo está vinculado cada destino: uno ya tomado no se propone para otro (diccionario, no búsqueda lineal).
        var bound = new Dictionary<(string Kind, Guid Id), string>();
        foreach (var b in bindings.Values.Where(b => b.TargetId is not null).OrderBy(b => b.EntityKey, StringComparer.Ordinal))
        {
            bound.TryAdd((b.TargetKind!, b.TargetId!.Value), b.EntityKey);
        }

        var current = new HashSet<string>(entities.Select(e => e.Key), StringComparer.Ordinal);
        var classified = entities.Select(e => Classify(e, bindings.GetValueOrDefault(e.Key), index, bound)).ToList();
        classified.AddRange(await MissingAsync(snapshot, bindings, current, ct).ConfigureAwait(false));

        var counts = new DiscoveryReviewCounts(
            Count(classified, "new"), Count(classified, "matched"), Count(classified, "linked"), Count(classified, "created"),
            Count(classified, "rejected"), Count(classified, "changed"), Count(classified, "missing"));

        var filtered = classified
            .Where(c => (kind is null || c.Row.Kind == kind) && (status is null || c.Status == status))
            .OrderBy(c => Array.IndexOf(Kinds, c.Row.Kind)).ThenBy(c => c.Row.Key, StringComparer.Ordinal)
            .ToList();
        var size = pageSize ?? DefaultPageSize;
        var index0 = page ?? 0;
        var pageItems = filtered.Skip(index0 * size).Take(size).ToList();

        var evidenceCounts = await EvidenceCountsAsync(snapshot, pageItems, ct).ConfigureAwait(false);
        var items = pageItems
            .Select(c => new DiscoveryReviewItem(
                c.Row.Key, c.Row.Kind, c.Row.Title, c.Row.Basis, c.Row.Confidence, c.Status, c.Row.Fingerprint,
                c.Binding is null ? null : BindingResponse(c.Binding),
                c.Match, c.Candidates, evidenceCounts.GetValueOrDefault(c.Row.Key), c.Proposal))
            .ToList();

        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return new ReviewResult.Done(new DiscoveryReviewResponse(
            snapshot.Id, snapshot.SourceId, snapshot.PreviousSnapshotId, counts, new DiscoveryReviewPage(index0, size, filtered.Count), items));
    }

    /// <summary>Catálogo, módulos y features de la app como candidatos (solo de esta app: la consulta va por <c>appId</c>).</summary>
    internal async Task<IReadOnlyList<ExistingTarget>> ExistingTargetsAsync(Guid appId, CancellationToken ct)
    {
        var items = await catalog.AllItemsOfAppAsync(appId, ct).ConfigureAwait(false);
        var modules = await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false);
        var featureList = await features.FeaturesOfAppAsync(appId, ct).ConfigureAwait(false);
        return
        [
            .. items.Select(i => new ExistingTarget("catalogItem", i.Type, i.Id, i.Title, MatchIndex.Signature(i.Type, i.Http, i.Database, i.Resource))),
            .. modules.Select(m => new ExistingTarget("module", "module", m.Id, m.Name, null)),
            .. featureList.Select(f => new ExistingTarget("feature", "feature", f.Id, f.Name, null)),
        ];
    }

    private static Classified Classify(Row row, Binding? binding, MatchIndex index, Dictionary<(string Kind, Guid Id), string> bound)
    {
        if (binding is not null)
        {
            var changed = binding.EntityFingerprint != row.Fingerprint;
            return new Classified(row, changed ? "changed" : binding.Decision!, binding, null, null, new DiscoveryProposal("none"));
        }

        var (match, candidates) = index.Find(row.Kind, row.Key, row.Title,
            t => !bound.TryGetValue((t.TargetKind, t.Id), out var owner) || owner == row.Key);
        if (match is not null)
        {
            return new Classified(row, "matched", null, match, null, new DiscoveryProposal("link", match.Target));
        }

        var proposal = candidates is not null || MatchIndex.TargetKindFor(row.Kind) is null
            ? new DiscoveryProposal("none") // varios candidatos: decide la persona; una pantalla entra con su feature
            : new DiscoveryProposal("create");
        return new Classified(row, "new", null, null, candidates, proposal);
    }

    /// <summary>
    /// Hallazgos con vínculo que estaban en el análisis anterior y no en este. Solo los que el análisis actual podía
    /// ver (<see cref="MissingRules"/>); los demás no se muestran, porque su ausencia no prueba nada.
    /// </summary>
    private async Task<List<Classified>> MissingAsync(Snapshot snapshot, Dictionary<string, Binding> bindings, HashSet<string> current, CancellationToken ct)
    {
        if (snapshot.PreviousSnapshotId is not { } previousId)
        {
            return [];
        }

        var absent = bindings.Keys.Where(k => !current.Contains(k)).ToList();
        if (absent.Count == 0)
        {
            return [];
        }

        var previous = await db.Entities.AsNoTracking()
            .Where(e => e.SnapshotId == previousId && absent.Contains(e.Key))
            .Select(e => new { Row = new Row(e.Key, e.Kind, e.Title, e.Basis, e.Confidence, e.Fingerprint), e.Data })
            .ToListAsync(ct).ConfigureAwait(false);
        if (previous.Count == 0)
        {
            return [];
        }

        var evidenceIds = previous.ToDictionary(p => p.Row.Key, p => EvidenceIds(p.Data), StringComparer.Ordinal);
        var allIds = evidenceIds.Values.SelectMany(i => i).Distinct(StringComparer.Ordinal).ToList();
        var evidence = await db.Evidence.AsNoTracking()
            .Where(e => e.SnapshotId == previousId && allIds.Contains(e.Id))
            .Select(e => new { e.Id, e.Detector, e.Path })
            .ToDictionaryAsync(e => e.Id, StringComparer.Ordinal, ct).ConfigureAwait(false);

        using var manifest = JsonDocument.Parse(snapshot.Manifest);
        var found = new List<Classified>();
        foreach (var item in previous)
        {
            var cited = evidenceIds[item.Row.Key].Where(evidence.ContainsKey).Select(id => (evidence[id].Detector, evidence[id].Path)).ToList();
            if (MissingRules.CanConclude(manifest.RootElement, cited))
            {
                found.Add(new Classified(item.Row, "missing", bindings[item.Row.Key], null, null, new DiscoveryProposal("none"))
                {
                    FromPrevious = true,
                });
            }
        }

        return found;
    }

    /// <summary>Cuántas evidencias cita cada hallazgo de la página (del análisis actual, o del anterior si ya no aparece).</summary>
    private async Task<Dictionary<string, int>> EvidenceCountsAsync(Snapshot snapshot, List<Classified> page, CancellationToken ct)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (snapshotId, keys) in new[]
        {
            (snapshot.Id, page.Where(p => !p.FromPrevious).Select(p => p.Row.Key).ToList()),
            (snapshot.PreviousSnapshotId ?? Guid.Empty, page.Where(p => p.FromPrevious).Select(p => p.Row.Key).ToList()),
        })
        {
            if (keys.Count == 0)
            {
                continue;
            }

            var data = await db.Entities.AsNoTracking()
                .Where(e => e.SnapshotId == snapshotId && keys.Contains(e.Key))
                .Select(e => new { e.Key, e.Data })
                .ToListAsync(ct).ConfigureAwait(false);
            foreach (var row in data)
            {
                counts[row.Key] = EvidenceIds(row.Data).Count;
            }
        }

        return counts;
    }

    internal static DiscoveryBindingResponse BindingResponse(Binding binding) => new(
        binding.SourceId,
        binding.EntityKey,
        binding.Decision!,
        binding.TargetId is { } id ? new DiscoveryTarget(binding.TargetKind!, id, binding.TargetTitle) : null,
        binding.EntityFingerprint!,
        binding.SnapshotId!.Value,
        binding.ApplyId,
        binding.Note,
        binding.DecidedBy,
        binding.DecidedAt,
        binding.Version);

    private static List<string> EvidenceIds(string data)
    {
        using var document = JsonDocument.Parse(data);
        return [.. document.RootElement.GetProperty("evidence").EnumerateArray().Select(e => e.GetString()!)];
    }

    private static int Count(List<Classified> items, string status) => items.Count(i => i.Status == status);

    private sealed record Row(string Key, string Kind, string Title, string Basis, string Confidence, string Fingerprint);

    private sealed record Classified(
        Row Row, string Status, Binding? Binding, DiscoveryMatch? Match, IReadOnlyList<DiscoveryMatch>? Candidates, DiscoveryProposal Proposal)
    {
        public bool FromPrevious { get; init; }
    }
}
