using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Schemas;
using Walkie.Shared.Time;

namespace Walkie.Modules.Discovery.Features;

internal abstract record ApplyOutcome
{
    public sealed record Done(DiscoveryApplyResult Result) : ApplyOutcome;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : ApplyOutcome;

    public sealed record Conflict(Dictionary<string, string[]> Errors) : ApplyOutcome;

    public sealed record NotFound : ApplyOutcome;

    /// <summary>No se pudo terminar ni deshacer: la aplicación quedó <c>pending</c> y un reintento la retoma (500).</summary>
    public sealed record Unfinished(string Message) : ApplyOutcome;
}

/// <summary>
/// Operaciones de revisión sobre un análisis (<c>POST /api/snapshots/{id}/apply</c>, <c>walkie-discovery-apply</c>;
/// spec walkie-live, tareas 4 y 6; ADR-0012). Solo escriben vínculos de Discovery y, con <c>create</c>, elementos nuevos
/// del catálogo por <see cref="IAppWriter"/>: nunca cambian un elemento existente, un lienzo, un módulo ni una feature.
/// <para>
/// <b>Un plan, dos usos.</b> <see cref="PlanAsync"/> valida todo sin escribir (schema, último análisis, hallazgos,
/// <c>bindingVersion</c>, destinos, ids, reglas oficiales del catálogo, firmas repetidas) y arma el resultado. Con
/// <c>dryRun</c> se responde ese resultado; sin él, se ejecuta ese mismo plan.
/// </para>
/// <para>
/// <b>Sin creaciones</b> (reject, link, reset): una transacción con los vínculos y la entrada <c>completed</c> de la
/// bitácora, como en la tarea 4.
/// </para>
/// <para>
/// <b>Con creaciones</b> (bitácora de ADR-0012): no hay transacción entre Discovery y Apps, así que
/// <list type="number">
/// <item>se toma un candado de sesión sobre el <c>applyId</c> (<see cref="ApplyLock"/>);</item>
/// <item>en una transacción se registra la aplicación <c>pending</c> con su plan, sus pasos (ids del cliente) y la
/// reserva de cada hallazgo (<see cref="Binding.PendingApplyId"/>; la versión del vínculo sube, así dos aplicaciones
/// sobre el mismo hallazgo no pueden reservarlo a la vez);</item>
/// <item>se crea cada elemento con <see cref="IAppWriter.CreateCatalogItemAsync(Guid, Guid, CreateCatalogItemRequest, string, CancellationToken)"/>
/// (idempotente por id) y se marca su paso;</item>
/// <item>en una transacción se escriben los vínculos y la aplicación queda <c>completed</c>.</item>
/// </list>
/// Si algo falla, se compensa: se borra lo que creó esta aplicación solo si nadie lo tocó (versión 1, sin lienzos que
/// lo usen); lo demás se deja y se avisa (<c>compensation-kept</c>). Si el proceso se cae, la aplicación queda
/// <c>pending</c> con sus reservas: un reintento con el mismo <c>applyId</c>, o la siguiente aplicación que toque esos
/// hallazgos, la termina sin duplicar (los ids ya están fijados).
/// </para>
/// </summary>
internal sealed partial class ApplyHandlers(
    DiscoveryDbContext db,
    ReviewHandlers review,
    IAppWriter apps,
    ICatalogDirectory catalog,
    IFeatureDirectory features,
    ICanvasWriter canvases,
    ICanvasReader canvasReader,
    IApplyCheckpoints checkpoints,
    TimeProvider clock,
    ILogger<ApplyHandlers> logger)
{
    private const string CatalogItem = "catalogItem";
    private const string FeatureTarget = "feature";
    private const string ModuleTarget = "module";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ApplyOutcome> ApplyAsync(Guid snapshotId, JsonElement body, bool dryRun, string userId, CancellationToken ct)
    {
        var snapshot = await db.Snapshots.AsNoTracking().FirstOrDefaultAsync(s => s.Id == snapshotId, ct).ConfigureAwait(false);
        if (snapshot is null)
        {
            return new ApplyOutcome.NotFound();
        }

        var schemaErrors = WalkieSchemas.Errors(WalkieSchemas.DiscoveryApply, body);
        if (schemaErrors.Count > 0)
        {
            return new ApplyOutcome.Invalid(schemaErrors);
        }

        var applyId = body.GetProperty("applyId").GetGuid();
        var operations = body.GetProperty("operations").EnumerateArray().Select(Operation.Read).ToList();

        if (dryRun)
        {
            var preview = await PlanAsync(snapshot, applyId, operations, track: false, ct).ConfigureAwait(false);
            return preview.Failure ?? new ApplyOutcome.Done(preview.Plan!.Stored.Planned);
        }

        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(DiscoveryFingerprint.Canonical(body, null))));
        await using var applyLock = await ApplyLock.TryAcquireAsync(db, applyId, ct).ConfigureAwait(false);
        if (applyLock is null)
        {
            return Conflict("applyId", "Esta aplicación se está ejecutando ahora: espera y vuelve a intentarlo con el mismo applyId.");
        }

        var record = await db.Applies.AsNoTracking().FirstOrDefaultAsync(a => a.ApplyId == applyId, ct).ConfigureAwait(false);
        if (record is not null)
        {
            if (record.SnapshotId != snapshotId || record.RequestHash != requestHash)
            {
                return Conflict("applyId", "Este applyId ya se usó con otra solicitud: genera uno nuevo para cada aplicación.");
            }

            // Tenemos su candado: si sigue pending, la ejecución anterior se cortó. Se retoma con los mismos ids.
            return record.Status == ApplyRecord.Pending
                ? await RunAsync(applyId).ConfigureAwait(false)
                : new ApplyOutcome.Done(JsonSerializer.Deserialize<DiscoveryApplyResult>(record.Result!, Json)!);
        }

        var planned = await PlanAsync(snapshot, applyId, operations, track: true, ct).ConfigureAwait(false);
        if (planned.Failure is { } failure)
        {
            return failure;
        }

        return planned.Plan!.Stored.Creates.Count == 0
            ? await DecideAsync(snapshot, applyId, requestHash, planned.Plan, userId, ct).ConfigureAwait(false)
            : await StartAsync(snapshot, applyId, requestHash, planned.Plan, userId).ConfigureAwait(false);
    }

    // ---------- Plan (vista previa y aplicación) ----------

    private async Task<(Plan? Plan, ApplyOutcome? Failure)> PlanAsync(
        Snapshot snapshot, Guid applyId, List<Operation> operations, bool track, CancellationToken ct)
    {
        var latest = await db.Snapshots.AsNoTracking()
            .Where(s => s.AppId == snapshot.AppId && s.SourceId == snapshot.SourceId)
            .OrderByDescending(s => s.ImportedAt).ThenByDescending(s => s.Id)
            .Select(s => s.Id).FirstAsync(ct).ConfigureAwait(false);
        if (latest != snapshot.Id)
        {
            return (null, Conflict("snapshotId", $"Hay un análisis más nuevo de esta fuente ({latest}): decide sobre ese."));
        }

        var requested = operations.Select(o => o.EntityKey).Distinct(StringComparer.Ordinal).ToList();

        // Lo que hace falta para crear: el hallazgo completo (y, de un módulo o una feature, sus miembros).
        var createKeys = operations.Where(o => o.Op == "create").Select(c => c.EntityKey).ToList();
        var createData = createKeys.Count == 0
            ? []
            : await db.Entities.AsNoTracking()
                .Where(e => e.SnapshotId == snapshot.Id && createKeys.Contains(e.Key))
                .ToDictionaryAsync(e => e.Key, e => e.Data, StringComparer.Ordinal, ct).ConfigureAwait(false);
        var members = new List<string>();
        foreach (var (key, data) in createData)
        {
            using var document = JsonDocument.Parse(data);
            if (document.RootElement.GetProperty("kind").GetString() is "feature" or "module"
                && document.RootElement.TryGetProperty("members", out var list))
            {
                members.AddRange(list.EnumerateArray().Select(m => m.GetString()!));
            }
        }

        // Las pantallas de una feature se reservan y se deciden con ella; sus APIs se leen para saber si están decididas.
        var keys = requested.Concat(members).Distinct(StringComparer.Ordinal).ToList();

        // Hallazgos reservados por otra aplicación con creaciones que no terminó.
        var claims = await db.Bindings.AsNoTracking()
            .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && keys.Contains(b.EntityKey) && b.PendingApplyId != null)
            .Select(b => b.PendingApplyId!.Value).Distinct().ToListAsync(ct).ConfigureAwait(false);
        if (claims.Count > 0)
        {
            var recovered = false;
            if (track)
            {
                foreach (var other in claims)
                {
                    recovered |= await TryRecoverAsync(other).ConfigureAwait(false);
                }
            }

            return (null, Conflict("operations", recovered
                ? "Había una aplicación interrumpida sobre estos hallazgos y se terminó: vuelve a pedir la revisión y decide otra vez."
                : "Hay otra aplicación en curso sobre estos hallazgos: espera a que termine y vuelve a pedir la revisión."));
        }

        var entities = await db.Entities.AsNoTracking()
            .Where(e => e.SnapshotId == snapshot.Id && keys.Contains(e.Key))
            .Select(e => new EntityRow(e.Key, e.Kind, e.Fingerprint))
            .ToDictionaryAsync(e => e.Key, StringComparer.Ordinal, ct).ConfigureAwait(false);
        var bindingQuery = db.Bindings.Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && keys.Contains(b.EntityKey));
        var bindings = await (track ? bindingQuery : bindingQuery.AsNoTracking())
            .ToDictionaryAsync(b => b.EntityKey, StringComparer.Ordinal, ct).ConfigureAwait(false);

        var creates = operations.Where(o => o.Op == "create").ToList();
        var needsTargets = creates.Count > 0 || operations.Any(o => o.Target is not null);
        var existing = needsTargets ? await review.ExistingTargetsAsync(snapshot.AppId, ct).ConfigureAwait(false) : [];
        var targets = existing.ToDictionary(t => (t.TargetKind, t.Id));
        var index = new MatchIndex(existing);

        var linkTargets = operations.Where(o => o.Target is not null).Select(o => o.Target!.Id).Distinct().ToList();
        var takenBy = linkTargets.Count == 0
            ? []
            : await db.Bindings.AsNoTracking()
                .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && b.Decision != null
                    && b.TargetId != null && linkTargets.Contains(b.TargetId.Value))
                .Select(b => new { b.TargetKind, b.TargetId, b.EntityKey })
                .ToListAsync(ct).ConfigureAwait(false);

        // Que los ids estén libres (en el catálogo, en las features y módulos, y en otras aplicaciones).
        var createIds = creates.Where(c => c.Id is not null).Select(c => c.Id!.Value).Distinct().ToList();
        var takenIds = (await catalog.ItemsByIdAsync(createIds, ct).ConfigureAwait(false)).Select(i => i.Id).ToHashSet();
        foreach (var id in createIds)
        {
            if (await features.AppOfFeatureAsync(id, ct).ConfigureAwait(false) is not null)
            {
                takenIds.Add(id);
            }
        }

        var drafting = creates.Any(c => entities.TryGetValue(c.EntityKey, out var e) && e.Kind is "feature" or "module")
            ? await DraftContextAsync(snapshot, operations, bindings, createData, members, existing, ct).ConfigureAwait(false)
            : null;
        var plannedNames = new List<(string Type, string Name)>();
        var plannedIds = createIds.Count == 0
            ? []
            : (await db.ApplySteps.AsNoTracking().Where(s => createIds.Contains(s.TargetId))
                .Select(s => s.TargetId).ToListAsync(ct).ConfigureAwait(false)).ToHashSet();

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var conflicts = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var ids = new HashSet<Guid>();
        var stored = new List<StoredOp>();
        var steps = new List<CreateStep>();
        var created = new List<DiscoveryAppliedTarget>();
        var warnings = new List<DiscoveryApplyWarning>();
        var unchanged = new List<DiscoveryTarget>();
        for (var i = 0; i < operations.Count; i++)
        {
            var op = operations[i];
            var path = string.Create(CultureInfo.InvariantCulture, $"/operations/{i}");
            if (!seen.Add(op.EntityKey))
            {
                errors[$"{path}/entityKey"] = ["Hay otra operación sobre el mismo hallazgo en esta solicitud."];
                continue;
            }

            var entity = entities.GetValueOrDefault(op.EntityKey);
            if (entity is null && op.Op != "reset")
            {
                errors[$"{path}/entityKey"] = ["No está en este análisis."];
                continue;
            }

            var binding = bindings.GetValueOrDefault(op.EntityKey);
            var version = binding?.Active == true ? binding.Version : 0;
            if (op.BindingVersion is { } expected && expected != version)
            {
                conflicts[$"{path}/bindingVersion"] = [string.Create(CultureInfo.InvariantCulture,
                    $"Se esperaba la versión {expected} y el vínculo está en la {version}: vuelve a pedir la revisión.")];
                continue;
            }

            switch (op.Op)
            {
                case "reset" when binding?.Active != true:
                    errors[$"{path}/entityKey"] = ["No hay una decisión que restablecer."];
                    break;
                case "reset":
                    stored.Add(new StoredOp(op.Op, op.EntityKey, null, null, op.Note));
                    if (binding!.TargetId is { } kept)
                    {
                        unchanged.Add(new DiscoveryTarget(binding.TargetKind!, kept, binding.TargetTitle));
                        warnings.Add(new DiscoveryApplyWarning("target-kept",
                            "El elemento al que estaba vinculado sigue en Walkie sin cambios: restablecer solo quita la decisión.", op.EntityKey));
                    }

                    break;
                case "reject":
                    stored.Add(new StoredOp(op.Op, op.EntityKey, entity!.Fingerprint, null, op.Note));
                    break;
                case "link":
                    var expectedKind = MatchIndex.TargetKindFor(entity!.Kind);
                    var expectedType = MatchIndex.TargetType(entity.Kind);
                    if (expectedKind is null)
                    {
                        errors[$"{path}/entityKey"] = ["Una pantalla no se vincula sola: entra con su feature."];
                    }
                    else if (op.Target!.Kind != expectedKind)
                    {
                        errors[$"{path}/target/kind"] = [$"Un hallazgo {entity.Kind} se vincula a un {expectedKind}, no a un {op.Target.Kind}."];
                    }
                    else if (!targets.TryGetValue((op.Target.Kind, op.Target.Id), out var target))
                    {
                        errors[$"{path}/target/id"] = ["No existe en esta app."];
                    }
                    else if (target.Type != expectedType)
                    {
                        errors[$"{path}/target/id"] = [$"Es un {target.Type} del catálogo; el hallazgo es un {entity.Kind}."];
                    }
                    else if (takenBy.FirstOrDefault(b => b.TargetKind == target.TargetKind && b.TargetId == target.Id && b.EntityKey != op.EntityKey) is { } other)
                    {
                        conflicts[$"{path}/target/id"] = [$"Ya está vinculado a otro hallazgo de esta fuente ({other.EntityKey}): restablece ese primero."];
                    }
                    else
                    {
                        stored.Add(new StoredOp(op.Op, op.EntityKey, entity.Fingerprint, target.Reference, op.Note));
                        unchanged.Add(target.Reference);
                    }

                    break;
                case "create" when entity!.Kind is "feature" or "module":
                    if (CreateContainer(op, i, path, entity.Kind, binding) is { } container)
                    {
                        steps.Add(container.Step);
                        var target = new DiscoveryTarget(container.Step.Kind, container.Step.Id, container.Step.Name);
                        stored.Add(new StoredOp(op.Op, op.EntityKey, entity.Fingerprint, target, op.Note));
                        foreach (var screen in container.Draft.Screens)
                        {
                            if (requested.Contains(screen))
                            {
                                errors[$"{path}/entityKey"] = [$"La pantalla {screen} entra con esta feature: no la decidas aparte en la misma solicitud."];
                                continue;
                            }

                            // Cada pantalla queda decidida con su feature: creada en ella.
                            stored.Add(new StoredOp("create", screen, entities[screen].Fingerprint, target, null));
                        }

                        created.Add(new DiscoveryAppliedTarget(op.EntityKey, target,
                            Includes: [.. container.Draft.Nodes.Select(n => n.Key)],
                            Canvas: container.Draft.Contract(container.Step.Graph)));
                        warnings.AddRange(container.Warnings);
                    }

                    break;
                case "create":
                    if (Create(op, i, path, entity!.Kind, binding) is { } step)
                    {
                        steps.Add(step);
                        var target = new DiscoveryTarget(CatalogItem, step.Id, step.Item!.Title.Trim());
                        stored.Add(new StoredOp(op.Op, op.EntityKey, entity.Fingerprint, target, op.Note));
                        created.Add(new DiscoveryAppliedTarget(op.EntityKey, target, apps.PreviewCatalogItem(snapshot.AppId, step.Id, step.Item)));
                    }

                    break;
            }
        }

        if (errors.Count > 0)
        {
            return (null, new ApplyOutcome.Invalid(errors));
        }

        if (conflicts.Count > 0)
        {
            return (null, new ApplyOutcome.Conflict(conflicts));
        }

        foreach (var step in steps.Where(s => s.Item is not null))
        {
            using var document = JsonDocument.Parse(createData[step.EntityKey]);
            warnings.AddRange(CatalogDraft.Warnings(step.EntityKey, document.RootElement,
                await DetectorsAsync(snapshot.Id, document.RootElement, ct).ConfigureAwait(false)));
            foreach (var same in index.WithTitle(step.Item!.Type, step.Item.Title))
            {
                warnings.Add(new DiscoveryApplyWarning("same-title", Truncate(
                    $"Ya hay «{same.Title}» en el catálogo con el mismo nombre: revisa que no sea el mismo antes de crear otro. Si lo es, vincúlalo.", 500),
                    step.EntityKey));
                unchanged.Add(same.Reference);
            }
        }

        var planned = new DiscoveryApplyResult(
            applyId,
            DryRun: true,
            "planned",
            created,
            [.. stored.Where(o => o.Op == "link").Select(o => new DiscoveryAppliedTarget(o.EntityKey, o.Target!))],
            [.. stored.Where(o => o.Op == "reject").Select(o => o.EntityKey)],
            [.. stored.Where(o => o.Op == "reset").Select(o => o.EntityKey)],
            [.. unchanged.DistinctBy(t => (t.Kind, t.Id))],
            warnings);
        return (new Plan(new StoredPlan(stored, steps, planned), bindings), null);

        // Las reglas de crear: tipo, id, decisión previa, contrato válido según el catálogo y que no duplique una firma.
        CreateStep? Create(Operation op, int opIndex, string path, string kind, Binding? binding)
        {
            if (!CatalogDraft.Kinds.Contains(kind))
            {
                errors[$"{path}/op"] = ["Una pantalla no se crea sola: entra con su feature."];
                return null;
            }

            if (!FreeId(op, path, binding))
            {
                return null;
            }

            var id = op.Id!.Value;

            using var document = JsonDocument.Parse(createData[op.EntityKey]);
            var item = CatalogDraft.From(document.RootElement);
            var itemErrors = apps.ValidateCatalogItem(item);
            if (itemErrors.Count > 0)
            {
                foreach (var (field, messages) in itemErrors)
                {
                    errors[$"{path}/item/{field}"] = messages;
                }

                return null;
            }

            if (index.WithSignature(kind, op.EntityKey) is [var duplicate, ..])
            {
                conflicts[$"{path}/entityKey"] = [Truncate(
                    $"Ya existe «{duplicate.Title}» en el catálogo con la misma firma ({op.EntityKey}): vincúlalo en vez de crear otro.", 500)];
                return null;
            }

            return new CreateStep(opIndex, op.EntityKey, CatalogItem, id, item, item.Title.Trim(), null, null);
        }

        // El id es v7, es único en la solicitud y libre, y el hallazgo no tiene una decisión activa.
        bool FreeId(Operation op, string path, Binding? binding)
        {
            var id = op.Id!.Value;
            if (id.Version != 7)
            {
                errors[$"{path}/id"] = ["Tiene que ser un UUID v7 generado por el cliente para esta decisión."];
                return false;
            }

            if (!ids.Add(id))
            {
                errors[$"{path}/id"] = ["Otra operación de esta solicitud usa el mismo id."];
                return false;
            }

            if (takenIds.Contains(id) || plannedIds.Contains(id))
            {
                conflicts[$"{path}/id"] = ["Ese id ya es de otro elemento o de otra aplicación: genera uno nuevo para esta decisión."];
                return false;
            }

            if (binding?.Active == true)
            {
                conflicts[$"{path}/entityKey"] = [$"Ya tiene una decisión ({binding.Decision}): restablécela antes de crear un elemento para él."];
                return false;
            }

            return true;
        }

        // Un módulo o una feature: su lienzo inicial (borrador y, con los ids y posiciones, el grafo validado), su nombre y avisos.
        (CreateStep Step, Draft Draft, List<DiscoveryApplyWarning> Warnings)? CreateContainer(Operation op, int opIndex, string path, string kind, Binding? binding)
        {
            if (!FreeId(op, path, binding))
            {
                return null;
            }

            using var document = JsonDocument.Parse(createData[op.EntityKey]);
            var finding = document.RootElement;
            var draft = kind == "feature" ? CanvasDraft.Feature(finding, drafting!) : CanvasDraft.Module(finding, drafting!);
            if (draft.Errors.Count > 0)
            {
                errors[$"{path}/entityKey"] = [.. draft.Errors];
                return null;
            }

            var title = finding.GetProperty("title").GetString()!.Trim();
            var app = finding.TryGetProperty("app", out var scope) ? scope.GetString() : null;
            var type = kind == "feature" ? FeatureTarget : ModuleTarget;
            bool Taken(string name) =>
                index.WithTitle(type, name).Count > 0 || plannedNames.Any(n => n.Type == type && MatchIndex.NormalizeTitle(n.Name) == MatchIndex.NormalizeTitle(name));
            // El nombre: el que eligió la persona, o el del hallazgo; si ya hay uno igual, con su app técnica para distinguirlo.
            var name = op.Name?.Trim() is { Length: > 0 } chosen ? chosen
                : Taken(title) && app is { } a && a != "." ? $"{title} ({a})"
                : title;
            name = Truncate(name, 120);
            plannedNames.Add((type, name));
            var description = finding.TryGetProperty("description", out var text) ? Truncate(text.GetString()!, 500) : null;

            var warnings = new List<DiscoveryApplyWarning>
            {
                new("inferred", kind == "feature"
                    ? "Walkie dedujo esta feature de las rutas: un grupo de pantallas no es por sí solo un objetivo funcional. Revisa el nombre y lo que agrupa."
                    : "Walkie dedujo este módulo de un proyecto con endpoints: no todo proyecto es un módulo reutilizable. Revisa qué ofrece.", op.EntityKey),
            };
            warnings.AddRange(draft.Omitted.Where(o => o.Code == "ambiguous-api").Select(o => new DiscoveryApplyWarning("ambiguous-api", o.Message, op.EntityKey)));
            if (draft.Omitted.Any(o => o.Code != "ambiguous-api"))
            {
                warnings.Add(new DiscoveryApplyWarning("omitted", Truncate(
                    $"{draft.Omitted.Count(o => o.Code != "ambiguous-api")} parte(s) del hallazgo no entran al lienzo: la vista previa dice cuáles y por qué.", 500), op.EntityKey));
            }

            if (Taken(name) && index.WithTitle(type, name).Count > 0)
            {
                warnings.Add(new DiscoveryApplyWarning("same-title", Truncate(
                    $"Ya hay {(kind == "feature" ? "una feature" : "un módulo")} «{name}» en la app: revisa que no sea {(kind == "feature" ? "la misma" : "el mismo")}. Si lo es, vincúlalo.", 500), op.EntityKey));
            }

            JsonElement? graph = null;
            if (op.Canvas is { } canvas)
            {
                var (built, graphErrors) = CanvasDraft.Graph(draft, CanvasInput.Read(canvas), $"{path}/canvas");
                foreach (var (field, messages) in graphErrors)
                {
                    errors[field] = messages;
                }

                if (built is null)
                {
                    return null;
                }

                graph = JsonSerializer.SerializeToElement(built);
                foreach (var (field, messages) in canvases.Validate(graph.Value))
                {
                    errors[$"{path}/canvas/graph{field}"] = messages;
                }
            }
            else if (track)
            {
                errors[$"{path}/canvas"] = ["Falta el lienzo inicial: pide la vista previa y manda los ids y las posiciones de sus cajas."];
                return null;
            }

            return (new CreateStep(opIndex, op.EntityKey, type, op.Id!.Value, null, name, description, graph), draft, warnings);
        }
    }

    /// <summary>
    /// Lo que el borrador del lienzo necesita leer: miembros y relaciones del análisis, decisiones activas de la fuente,
    /// lo que esta solicitud crea en el catálogo, el catálogo vivo, las APIs que publican varios servicios y las interfaces
    /// de los módulos que ya existen cuya caja es un <c>ref</c>.
    /// </summary>
    private async Task<DraftContext> DraftContextAsync(
        Snapshot snapshot, List<Operation> operations, Dictionary<string, Binding> bindings,
        Dictionary<string, string> createData, List<string> members, IReadOnlyList<ExistingTarget> existing, CancellationToken ct)
    {
        var memberSet = members.ToHashSet(StringComparer.Ordinal);
        var memberData = await db.Entities.AsNoTracking()
            .Where(e => e.SnapshotId == snapshot.Id && memberSet.Contains(e.Key))
            .ToDictionaryAsync(e => e.Key, e => JsonDocument.Parse(e.Data).RootElement.Clone(), StringComparer.Ordinal, ct).ConfigureAwait(false);
        var relations = await db.Relations.AsNoTracking()
            .Where(r => r.SnapshotId == snapshot.Id && (r.Kind == "navigates" || r.Kind == "calls") && memberSet.Contains(r.FromKey))
            .Select(r => new DraftRelation(r.Key, r.Kind, r.FromKey, r.ToKey))
            .ToListAsync(ct).ConfigureAwait(false);
        var apis = members.Concat(relations.Select(r => r.To)).Where(k => k.StartsWith("api:", StringComparison.Ordinal)).Distinct(StringComparer.Ordinal).ToList();
        var exposes = await db.Relations.AsNoTracking()
            .Where(r => r.SnapshotId == snapshot.Id && r.Kind == "exposes" && apis.Contains(r.ToKey))
            .Select(r => new { r.FromKey, r.ToKey })
            .ToListAsync(ct).ConfigureAwait(false);
        var ambiguous = exposes.GroupBy(r => r.ToKey, StringComparer.Ordinal)
            .Select(g => (g.Key, Services: (IReadOnlyList<string>)[.. g.Select(r => r.FromKey).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)]))
            .Where(g => g.Services.Count > 1)
            .ToDictionary(g => g.Key, g => g.Services, StringComparer.Ordinal);

        // Decisiones de las APIs que se llaman pero no son miembros (también pueden estar en el catálogo).
        var extra = apis.Where(k => !bindings.ContainsKey(k)).ToList();
        var decisions = bindings.Values.Concat(extra.Count == 0 ? [] : await db.Bindings.AsNoTracking()
                .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && extra.Contains(b.EntityKey))
                .ToListAsync(ct).ConfigureAwait(false))
            .Where(b => b.Active)
            .ToDictionary(b => b.EntityKey, b => new DraftDecision(b.Decision!, b.TargetKind, b.TargetId), StringComparer.Ordinal);

        var planned = new Dictionary<string, (Guid Id, string Title)>(StringComparer.Ordinal);
        foreach (var op in operations.Where(o => o.Op == "create" && o.Id is not null && createData.ContainsKey(o.EntityKey)))
        {
            using var document = JsonDocument.Parse(createData[op.EntityKey]);
            if (CatalogDraft.Kinds.Contains(document.RootElement.GetProperty("kind").GetString()!))
            {
                planned[op.EntityKey] = (op.Id!.Value, CatalogDraft.From(document.RootElement).Title.Trim());
            }
        }

        var catalogTitles = existing.Where(t => t.TargetKind == CatalogItem).ToDictionary(t => t.Id, t => t.Title);
        var interfaces = new Dictionary<Guid, List<ModuleInterface>>();
        foreach (var module in existing.Where(t => t.TargetKind == ModuleTarget))
        {
            var graph = await canvasReader.GraphOfFeatureAsync(module.Id, ct).ConfigureAwait(false);
            if (!graph.TryGetProperty("interfaces", out var list) || !graph.TryGetProperty("nodes", out var nodes))
            {
                continue;
            }

            foreach (var item in list.EnumerateObject().Select(p => p.Value))
            {
                if (item.GetProperty("kind").GetString() == "provides"
                    && nodes.TryGetProperty(item.GetProperty("nodeId").GetString()!, out var node)
                    && node.GetProperty("type").GetString() == "ref"
                    && Guid.TryParse(node.GetProperty("catalogId").GetString(), out var catalogId))
                {
                    if (!interfaces.TryGetValue(catalogId, out var found))
                    {
                        interfaces[catalogId] = found = [];
                    }

                    found.Add(new ModuleInterface(module.Id, module.Title, item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!));
                }
            }
        }

        return new DraftContext(
            memberData, relations, decisions, planned, catalogTitles, ambiguous,
            interfaces.ToDictionary(p => p.Key, p => (IReadOnlyList<ModuleInterface>)p.Value));
    }

    /// <summary>Los detectores de la evidencia de un hallazgo (para avisar de una base que solo es un modelo de EF).</summary>
    private async Task<IReadOnlyCollection<string>> DetectorsAsync(Guid snapshotId, JsonElement entity, CancellationToken ct)
    {
        if (entity.GetProperty("kind").GetString() != "database")
        {
            return [];
        }

        var evidence = entity.GetProperty("evidence").EnumerateArray().Select(e => e.GetString()!).ToList();
        return await db.Evidence.AsNoTracking()
            .Where(e => e.SnapshotId == snapshotId && evidence.Contains(e.Id))
            .Select(e => e.Detector).Distinct().ToListAsync(ct).ConfigureAwait(false);
    }

    // ---------- Sin creaciones: una transacción (tarea 4) ----------

    private async Task<ApplyOutcome> DecideAsync(Snapshot snapshot, Guid applyId, string requestHash, Plan plan, string userId, CancellationToken ct)
    {
        var now = clock.GetUtcNowForDb();
        foreach (var op in plan.Stored.Operations)
        {
            Decide(BindingFor(plan.Bindings, snapshot, op.EntityKey, userId, now), op, applyId, snapshot.Id, userId, now);
        }

        var result = plan.Stored.Planned with { DryRun = false, Status = ApplyRecord.Completed };
        db.Applies.Add(new ApplyRecord
        {
            ApplyId = applyId,
            AppId = snapshot.AppId,
            SourceId = snapshot.SourceId,
            SnapshotId = snapshot.Id,
            RequestHash = requestHash,
            Status = ApplyRecord.Completed,
            Result = JsonSerializer.Serialize(result, Json),
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        });

        try
        {
            // Un solo SaveChanges: vínculos y bitácora en una transacción.
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            return new ApplyOutcome.Done(result);
        }
        catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsUniqueViolation(ex))
        {
            // Otra solicitud cambió o creó el mismo vínculo antes.
            db.ChangeTracker.Clear();
            return Concurrent();
        }
    }

    // ---------- Con creaciones: bitácora ----------

    /// <summary>Registra la aplicación pending con su plan, sus pasos y las reservas, y la ejecuta.</summary>
    private async Task<ApplyOutcome> StartAsync(Snapshot snapshot, Guid applyId, string requestHash, Plan plan, string userId)
    {
        var now = clock.GetUtcNowForDb();
        db.Applies.Add(new ApplyRecord
        {
            ApplyId = applyId,
            AppId = snapshot.AppId,
            SourceId = snapshot.SourceId,
            SnapshotId = snapshot.Id,
            RequestHash = requestHash,
            Status = ApplyRecord.Pending,
            Plan = JsonSerializer.Serialize(plan.Stored, Json),
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        });
        foreach (var step in plan.Stored.Creates)
        {
            db.ApplySteps.Add(new ApplyStep
            {
                ApplyId = applyId,
                Index = step.Index,
                EntityKey = step.EntityKey,
                TargetKind = step.Kind,
                TargetId = step.Id,
                Item = step.Item is not null
                    ? JsonSerializer.Serialize(step.Item, Json)
                    : JsonSerializer.Serialize(new { name = step.Name, description = step.Description }, Json),
                Status = ApplyStep.Planned,
            });
        }

        // Reservar cada hallazgo de la solicitud: la versión sube, así otra aplicación que lo leyó antes choca.
        foreach (var op in plan.Stored.Operations)
        {
            var binding = BindingFor(plan.Bindings, snapshot, op.EntityKey, userId, now);
            binding.PendingApplyId = applyId;
            binding.Version++;
        }

        try
        {
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsUniqueViolation(ex))
        {
            // Otra aplicación reservó los mismos hallazgos o planificó el mismo id un instante antes: no se escribió nada.
            db.ChangeTracker.Clear();
            return Concurrent();
        }

        await checkpoints.ReachedAsync("pending", applyId).ConfigureAwait(false);
        db.ChangeTracker.Clear();
        return await RunAsync(applyId).ConfigureAwait(false);
    }

    /// <summary>
    /// Ejecuta (o retoma) una aplicación pending: crea los pasos que faltan y, al final, en una transacción, los vínculos
    /// y <c>completed</c>. Quien llama tiene el candado de ese <c>applyId</c>. No usa el token de la solicitud: si el
    /// cliente se va, la aplicación termina igual (o se compensa) en vez de quedar a medias.
    /// </summary>
    private async Task<ApplyOutcome> RunAsync(Guid applyId)
    {
        try
        {
            var record = await db.Applies.FirstAsync(a => a.ApplyId == applyId).ConfigureAwait(false);
            var plan = JsonSerializer.Deserialize<StoredPlan>(record.Plan!, Json)!;
            var steps = (await db.ApplySteps.Where(s => s.ApplyId == applyId).ToListAsync().ConfigureAwait(false))
                .OrderBy(s => Phase(s.TargetKind)).ThenBy(s => s.Index).ToList();
            // Por fases: el catálogo, después los módulos y al final las features (el lienzo de cada uno puede apuntar a lo
            // anterior). Cada paso que se termina se marca, así un reintento sigue donde quedó.
            foreach (var step in steps)
            {
                if (step.TargetKind == CatalogItem && step.Status == ApplyStep.Planned)
                {
                    await CreateCatalogStepAsync(record, plan, step).ConfigureAwait(false);
                }
                else if (step.TargetKind != CatalogItem && step.Status is ApplyStep.Planned or ApplyStep.Created)
                {
                    await CreateContainerStepAsync(record, plan, step).ConfigureAwait(false);
                }
            }

            await checkpoints.ReachedAsync("finalize", applyId).ConfigureAwait(false);
            var keys = plan.Operations.Select(o => o.EntityKey).ToList();
            var bindings = await db.Bindings
                .Where(b => b.AppId == record.AppId && b.SourceId == record.SourceId && keys.Contains(b.EntityKey))
                .ToDictionaryAsync(b => b.EntityKey, StringComparer.Ordinal).ConfigureAwait(false);
            var now = clock.GetUtcNowForDb();
            foreach (var op in plan.Operations)
            {
                if (!bindings.TryGetValue(op.EntityKey, out var binding) || binding.PendingApplyId != applyId)
                {
                    throw new InvalidOperationException($"La reserva de {op.EntityKey} ya no es de esta aplicación.");
                }

                Decide(binding, op, applyId, record.SnapshotId, record.CreatedBy, now);
            }

            var result = plan.Planned with { DryRun = false, Status = ApplyRecord.Completed };
            record.Status = ApplyRecord.Completed;
            record.Result = JsonSerializer.Serialize(result, Json);
            record.UpdatedAt = now;
            // Vínculos y completed en una transacción: no hay un estado con vínculos escritos y la aplicación pending.
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            return new ApplyOutcome.Done(result);
        }
        catch (ApplyAbandonedException)
        {
            throw; // una caída simulada: ni se compensa ni se sigue
        }
#pragma warning disable CA1031 // cualquier fallo al escribir se compensa; la excepción queda en el log
        catch (Exception ex)
#pragma warning restore CA1031
        {
            LogApplyFailed(logger, ex, applyId);
            db.ChangeTracker.Clear();
            return await CompensateAsync(applyId).ConfigureAwait(false);
        }
    }

    /// <summary>Orden de ejecución por tipo: catálogo, módulos, features (al compensar, al revés).</summary>
    private static int Phase(string targetKind) => targetKind switch { CatalogItem => 0, ModuleTarget => 1, _ => 2 };

    private async Task CreateCatalogStepAsync(ApplyRecord record, StoredPlan plan, ApplyStep step)
    {
        var item = plan.Creates.Single(c => c.Index == step.Index).Item!;
        var outcome = await apps.CreateCatalogItemAsync(record.AppId, step.TargetId, item, record.CreatedBy, CancellationToken.None)
            .ConfigureAwait(false);
        if (outcome == CatalogItemCreation.IdTaken)
        {
            // El id es de otro elemento: nada de esta aplicación que deshacer en ese paso.
            step.Status = ApplyStep.Compensated;
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            throw new InvalidOperationException($"El id {step.TargetId} ya es de otro elemento del catálogo.");
        }

        step.Status = ApplyStep.Created;
        record.UpdatedAt = clock.GetUtcNowForDb();
        await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        await checkpoints.ReachedAsync(string.Create(CultureInfo.InvariantCulture, $"created:{step.Index}"), step.ApplyId).ConfigureAwait(false);
    }

    /// <summary>
    /// Un módulo o una feature en dos pasos que se marcan por separado: la fila (<c>created</c>) y su primer lienzo con
    /// sus interfaces, que se guardan juntos en el mismo guardado del lienzo (<c>saved</c>). Los dos son idempotentes: un
    /// reintento no duplica la fila ni pisa un lienzo que ya existe (aunque una persona ya lo haya editado).
    /// </summary>
    private async Task CreateContainerStepAsync(ApplyRecord record, StoredPlan plan, ApplyStep step)
    {
        var create = plan.Creates.Single(c => c.Index == step.Index);
        if (step.Status == ApplyStep.Planned)
        {
            var outcome = await apps.CreateFeatureAsync(record.AppId, step.TargetId, step.TargetKind, create.Name, create.Description, record.CreatedBy, CancellationToken.None)
                .ConfigureAwait(false);
            if (outcome == FeatureCreation.IdTaken)
            {
                step.Status = ApplyStep.Compensated;
                await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
                throw new InvalidOperationException($"El id {step.TargetId} ya es de otra feature o módulo.");
            }

            step.Status = ApplyStep.Created;
            record.UpdatedAt = clock.GetUtcNowForDb();
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            await checkpoints.ReachedAsync(string.Create(CultureInfo.InvariantCulture, $"created:{step.Index}"), step.ApplyId).ConfigureAwait(false);
        }

        var (canvas, errors) = await canvases.CreateInitialAsync(step.TargetId, create.Graph!.Value, record.CreatedBy, CancellationToken.None).ConfigureAwait(false);
        if (canvas == InitialCanvas.Invalid)
        {
            throw new InvalidOperationException("El lienzo inicial no se pudo guardar: " + string.Join("; ", errors.Select(e => $"{e.Key}: {string.Join(" ", e.Value)}")));
        }

        step.Status = ApplyStep.Saved;
        record.UpdatedAt = clock.GetUtcNowForDb();
        await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        await checkpoints.ReachedAsync(string.Create(CultureInfo.InvariantCulture, $"canvas:{step.Index}"), step.ApplyId).ConfigureAwait(false);
    }

    /// <summary>
    /// Deshace una aplicación que falló: borra lo que creó solo si nadie lo tocó, libera las reservas y la deja
    /// <c>compensated</c>. Lo que no se puede borrar sin perder un cambio se deja (paso <c>kept</c>) y se avisa.
    /// </summary>
    private async Task<ApplyOutcome> CompensateAsync(Guid applyId)
    {
        try
        {
            var record = await db.Applies.FirstAsync(a => a.ApplyId == applyId).ConfigureAwait(false);
            var plan = JsonSerializer.Deserialize<StoredPlan>(record.Plan!, Json)!;
            var steps = (await db.ApplySteps.Where(s => s.ApplyId == applyId).ToListAsync().ConfigureAwait(false))
                .OrderByDescending(s => Phase(s.TargetKind)).ThenByDescending(s => s.Index).ToList();
            var warnings = new List<DiscoveryApplyWarning>
            {
                new("compensated", "No se pudo terminar la aplicación: se deshizo lo que había creado y no quedó ninguna decisión guardada."),
            };
            var kept = new List<DiscoveryTarget>();
            // Un paso planned también se intenta: pudo crearse justo antes de que fallara marcarlo.
            foreach (var step in steps.Where(s => s.Status is ApplyStep.Created or ApplyStep.Planned or ApplyStep.Saved))
            {
                var create = plan.Creates.Single(c => c.Index == step.Index);
                var why = step.TargetKind == CatalogItem
                    ? await apps.DeleteUntouchedCatalogItemAsync(record.AppId, step.TargetId, CancellationToken.None).ConfigureAwait(false) switch
                    {
                        CatalogItemRemoval.Deleted or CatalogItemRemoval.NotFound => null,
                        CatalogItemRemoval.Edited => "alguien ya lo editó",
                        _ => "un lienzo ya lo usa",
                    }
                    : await RemoveContainerAsync(record.AppId, step.TargetId, create).ConfigureAwait(false);
                if (why is null)
                {
                    step.Status = ApplyStep.Compensated;
                }
                else
                {
                    step.Status = ApplyStep.Kept;
                    kept.Add(new DiscoveryTarget(step.TargetKind, step.TargetId, create.Name));
                    var where = step.TargetKind == CatalogItem ? "en el catálogo" : "en la app";
                    warnings.Add(new DiscoveryApplyWarning("compensation-kept", Truncate(
                        $"«{create.Name}» se creó y no se borró: {why}. Quedó {where} sin vínculo; vincúlalo desde la revisión si corresponde.", 500), step.EntityKey));
                }

                await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            }

            foreach (var binding in await db.Bindings.Where(b => b.PendingApplyId == applyId).ToListAsync().ConfigureAwait(false))
            {
                binding.PendingApplyId = null;
                binding.Version++;
            }

            var result = plan.Planned with
            {
                DryRun = false,
                Status = ApplyRecord.Compensated,
                Created = [],
                Linked = [],
                Rejected = [],
                Reset = [],
                Unchanged = kept,
                Warnings = warnings,
            };
            record.Status = ApplyRecord.Compensated;
            record.Result = JsonSerializer.Serialize(result, Json);
            record.UpdatedAt = clock.GetUtcNowForDb();
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            return new ApplyOutcome.Done(result);
        }
        catch (ApplyAbandonedException)
        {
            throw;
        }
#pragma warning disable CA1031 // si tampoco se puede deshacer, queda pending: un reintento la retoma
        catch (Exception ex)
#pragma warning restore CA1031
        {
            LogCompensationFailed(logger, ex, applyId);
            db.ChangeTracker.Clear();
            return new ApplyOutcome.Unfinished(
                "No se pudo terminar ni deshacer la aplicación: quedó pendiente. Reintenta con el mismo applyId para terminarla.");
        }
    }

    /// <summary>
    /// Deshace un módulo o una feature de esta aplicación sin perder nada de una persona: primero su lienzo (solo si
    /// sigue en la versión 1 y ningún otro lienzo lo usa) y después la fila (solo si conserva su nombre y descripción).
    /// Null si se deshizo o nunca se creó; si no, por qué se dejó.
    /// </summary>
    private async Task<string?> RemoveContainerAsync(Guid appId, Guid id, CreateStep create)
    {
        var canvas = await canvases.DeleteUntouchedAsync(id, CancellationToken.None).ConfigureAwait(false);
        if (canvas != CanvasRemoval.Deleted)
        {
            return canvas == CanvasRemoval.Edited ? "alguien ya editó su lienzo" : "otro lienzo ya lo usa";
        }

        return await apps.DeleteUntouchedFeatureAsync(appId, id, create.Name, create.Description, CancellationToken.None).ConfigureAwait(false) == FeatureRemoval.Edited
            ? "alguien ya le cambió el nombre o la descripción"
            : null;
    }

    /// <summary>
    /// Termina una aplicación pending de otra solicitud si su ejecución ya no existe (su candado está libre). True si la
    /// terminó (o liberó reservas huérfanas); false si sigue en curso.
    /// </summary>
    private async Task<bool> TryRecoverAsync(Guid otherApplyId)
    {
        await using var otherLock = await ApplyLock.TryAcquireAsync(db, otherApplyId, CancellationToken.None).ConfigureAwait(false);
        if (otherLock is null)
        {
            return false;
        }

        db.ChangeTracker.Clear();
        var status = await db.Applies.AsNoTracking().Where(a => a.ApplyId == otherApplyId).Select(a => a.Status)
            .FirstOrDefaultAsync().ConfigureAwait(false);
        if (status == ApplyRecord.Pending)
        {
            LogRecovering(logger, otherApplyId);
            await RunAsync(otherApplyId).ConfigureAwait(false);
        }
        else
        {
            // No debería pasar (las reservas se limpian en la misma transacción que el estado), pero no deben bloquear.
            foreach (var binding in await db.Bindings.Where(b => b.PendingApplyId == otherApplyId).ToListAsync().ConfigureAwait(false))
            {
                binding.PendingApplyId = null;
                binding.Version++;
            }

            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        }

        db.ChangeTracker.Clear();
        return true;
    }

    // ---------- Ayudas ----------

    private Binding BindingFor(Dictionary<string, Binding> bindings, Snapshot snapshot, string key, string userId, DateTimeOffset now)
    {
        if (bindings.TryGetValue(key, out var binding))
        {
            return binding;
        }

        binding = new Binding { AppId = snapshot.AppId, SourceId = snapshot.SourceId, EntityKey = key, DecidedBy = userId, DecidedAt = now, Version = 0 };
        db.Bindings.Add(binding);
        bindings[key] = binding;
        return binding;
    }

    private static void Decide(Binding binding, StoredOp op, Guid applyId, Guid snapshotId, string userId, DateTimeOffset now)
    {
        binding.Decision = op.Op switch { "reject" => "rejected", "link" => "linked", "create" => "created", _ => null };
        binding.TargetKind = op.Target?.Kind;
        binding.TargetId = op.Target?.Id;
        binding.TargetTitle = op.Target?.Title is { } title ? Truncate(title, 120) : null;
        binding.EntityFingerprint = op.Op == "reset" ? null : op.Fingerprint;
        binding.SnapshotId = op.Op == "reset" ? null : snapshotId;
        binding.DecidedKey = null;
        binding.ApplyId = applyId;
        binding.Note = op.Note;
        binding.DecidedBy = userId;
        binding.DecidedAt = now;
        binding.PendingApplyId = null;
        binding.Version++;
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static ApplyOutcome.Conflict Conflict(string path, string message) =>
        new(new Dictionary<string, string[]> { [path] = [message] });

    private static ApplyOutcome.Conflict Concurrent() =>
        Conflict("operations", "Otra operación cambió estos vínculos al mismo tiempo: vuelve a pedir la revisión y decide otra vez.");

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];

    [LoggerMessage(Level = LogLevel.Error, Message = "La aplicación {ApplyId} falló a mitad de camino: se compensa.")]
    private static partial void LogApplyFailed(ILogger logger, Exception exception, Guid applyId);

    [LoggerMessage(Level = LogLevel.Error, Message = "No se pudo compensar la aplicación {ApplyId}: queda pending para un reintento.")]
    private static partial void LogCompensationFailed(ILogger logger, Exception exception, Guid applyId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Se retoma la aplicación interrumpida {ApplyId}.")]
    private static partial void LogRecovering(ILogger logger, Guid applyId);

    /// <summary>El plan validado (en memoria): lo que se guarda y los vínculos leídos para escribirlos con su versión.</summary>
    private sealed record Plan(StoredPlan Stored, Dictionary<string, Binding> Bindings);

    /// <summary>
    /// Lo que se guarda en la bitácora: las operaciones ya validadas, los pasos que escriben fuera de Discovery y el
    /// resultado de la vista previa. La aplicación real es este mismo plan.
    /// </summary>
    private sealed record StoredPlan(IReadOnlyList<StoredOp> Operations, IReadOnlyList<CreateStep> Creates, DiscoveryApplyResult Planned);

    /// <summary>Una decisión validada: con su destino (vinculado o creado) y el fingerprint del hallazgo.</summary>
    private sealed record StoredOp(string Op, string EntityKey, string? Fingerprint, DiscoveryTarget? Target, string? Note);

    /// <summary>
    /// Un paso que escribe fuera de Discovery: un elemento del catálogo (<see cref="Item"/>) o un módulo o una feature
    /// (<see cref="Name"/>, <see cref="Description"/> y su primer lienzo, <see cref="Graph"/>, ya validado).
    /// </summary>
    private sealed record CreateStep(
        int Index, string EntityKey, string Kind, Guid Id, CreateCatalogItemRequest? Item, string Name, string? Description, JsonElement? Graph);

    private sealed record EntityRow(string Key, string Kind, string Fingerprint);

    private sealed record Operation(
        string Op, string EntityKey, DiscoveryTarget? Target, Guid? Id, int? BindingVersion, string? Note, string? Name = null, JsonElement? Canvas = null)
    {
        public static Operation Read(JsonElement op) => new(
            op.GetProperty("op").GetString()!,
            op.GetProperty("entityKey").GetString()!,
            op.TryGetProperty("target", out var target)
                ? new DiscoveryTarget(target.GetProperty("kind").GetString()!, target.GetProperty("id").GetGuid())
                : null,
            op.TryGetProperty("id", out var id) ? id.GetGuid() : null,
            op.TryGetProperty("bindingVersion", out var version) ? version.GetInt32() : null,
            op.TryGetProperty("note", out var note) ? note.GetString() : null,
            op.TryGetProperty("name", out var name) ? name.GetString() : null,
            op.TryGetProperty("canvas", out var canvas) ? canvas.Clone() : null);
    }
}
