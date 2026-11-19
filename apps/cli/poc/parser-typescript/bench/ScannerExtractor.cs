namespace Walkie.Analyzer
{
    internal static class Text
    {
        public static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
    }
}

public sealed class ScannerExtractor : IExtractor
{
    public FileResult Extract(string file, string text)
    {
        var facts = Walkie.Analyzer.Frontend.ScriptFacts.Read(text, !file.EndsWith(".ts"));
        return new FileResult(file,
            facts.Routes.Where(r => r.Path is not null).Select(r => r.Path!).ToList(),
            facts.Http.Where(h => h.Path is not null && !h.External).Select(h => new Call(h.Method, h.Path!)).ToList(),
            facts.Routes.Where(r => r.Dynamic is not null).Select(r => "route:" + r.Dynamic).Concat(facts.Http.Where(h => h.Unresolved is not null).Select(h => "http:" + h.Unresolved)).ToList(),
            facts.HasErrors);
    }
}
