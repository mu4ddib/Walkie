using System.Text.Json;
using Walkie.Modules.Canvas.Contracts;

namespace Walkie.Modules.Canvas.Features;

internal sealed class ModuleDirectory(ModuleHandlers handlers) : IModuleDirectory
{
    public Task<IReadOnlyList<ModuleGraph>> ReachableAsync(Guid appId, JsonElement graph, CancellationToken cancellationToken) =>
        handlers.ReachableAsync(appId, graph, cancellationToken);
}
