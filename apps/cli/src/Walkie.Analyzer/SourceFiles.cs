using System.Text.RegularExpressions;

namespace Walkie.Analyzer;

/// <summary>Un archivo del alcance: ruta relativa con <c>/</c> y tamaño.</summary>
public sealed record SourceFile(string Path, long Length)
{
    public string Name => System.IO.Path.GetFileName(Path);

    public string Extension => System.IO.Path.GetExtension(Path);
}

/// <summary>
/// Recorre el proyecto sin seguir enlaces simbólicos ni salir de la raíz, y deja fuera lo generado, las dependencias
/// y todo archivo sensible (credenciales, certificados, configuración de entorno): ningún detector puede leerlos.
/// </summary>
public static partial class SourceFiles
{
    /// <summary>Carpetas que nunca se recorren: control de versiones, dependencias, salida de compilación, cachés.</summary>
    public static IReadOnlySet<string> ExcludedDirectories { get; } = new HashSet<string>(
        [".git", ".hg", ".svn", ".walkie", "node_modules", "bin", "obj", "dist", "build", "out", "target", ".next", ".nuxt",
         ".angular", ".svelte-kit", "coverage", ".vs", ".idea", ".vscode", "vendor", "__pycache__", ".venv",
         "venv", ".gradle", ".terraform", "test-results", "playwright-report", "TestResults", ".cache", ".pnpm-store"],
        StringComparer.OrdinalIgnoreCase);

    /// <summary>Globs del alcance que se escriben en el manifest (lo que <see cref="ExcludedDirectories"/> deja fuera).</summary>
    public static IReadOnlyList<string> ExcludeGlobs { get; } =
        ExcludedDirectories.Order(StringComparer.Ordinal).Select(d => $"**/{d}/**").Append("**/*.walkiepack").ToList();

    /// <summary>
    /// Archivos sensibles: se excluyen siempre, se cuentan y no se leen. Nombres de configuración de entorno, claves,
    /// certificados, almacenes de credenciales, secretos de usuario y la configuración de .NET (<c>appsettings*.json</c>, que suele traer cadenas de conexión).
    /// </summary>
    [GeneratedRegex(
        @"(^\.env(\..*)?$)|(\.(pfx|p12|pem|key|crt|cer|der|jks|keystore|kdbx|ppk|asc|gpg)$)|(^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$)|(^secrets?\.(json|ya?ml)$)|(^appsettings(\..+)?\.json$)|(^\.npmrc$)|(^\.pypirc$)|(^\.netrc$)|(^credentials(\.json)?$)|(^.*\.publishsettings$)|(^.*\.tfvars$)|(^.*\.tfstate(\.backup)?$)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    public static partial Regex SensitiveName();

    /// <summary>Resultado del recorrido.</summary>
    public sealed record Listing(IReadOnlyList<SourceFile> Files, int SensitiveExcluded, bool LimitReached, int Visited);

    public static Listing List(string root, int maxFiles)
    {
        var files = new List<SourceFile>();
        var sensitive = 0;
        var visited = 0;
        var limitReached = false;
        var pending = new Stack<string>();
        pending.Push(root);
        var options = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            RecurseSubdirectories = false,
            AttributesToSkip = FileAttributes.ReparsePoint, // no sigue enlaces simbólicos: no sale de la raíz
            ReturnSpecialDirectories = false,
        };

        while (pending.Count > 0 && !limitReached)
        {
            var dir = pending.Pop();
            foreach (var sub in Directory.EnumerateDirectories(dir, "*", options).Order(StringComparer.Ordinal).Reverse())
            {
                if (!ExcludedDirectories.Contains(Path.GetFileName(sub)))
                {
                    pending.Push(sub);
                }
            }

            foreach (var file in Directory.EnumerateFiles(dir, "*", options).Order(StringComparer.Ordinal))
            {
                var name = Path.GetFileName(file);
                if (name.EndsWith(".walkiepack", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (SensitiveName().IsMatch(name))
                {
                    sensitive++;
                    continue;
                }

                if (files.Count >= maxFiles)
                {
                    limitReached = true;
                    break;
                }

                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (relative.Length > 1024 || relative.StartsWith("../", StringComparison.Ordinal))
                {
                    continue;
                }

                visited++;
                files.Add(new SourceFile(relative, new FileInfo(file).Length));
            }
        }

        files.Sort((a, b) => string.CompareOrdinal(a.Path, b.Path));
        return new Listing(files, sensitive, limitReached, visited);
    }
}
