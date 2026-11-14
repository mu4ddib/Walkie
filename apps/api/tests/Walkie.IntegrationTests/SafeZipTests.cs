using System.Text;
using Walkie.Shared.Packages;
using static Walkie.IntegrationTests.DiscoveryPacks;

namespace Walkie.IntegrationTests;

/// <summary>
/// Lectura segura de paquetes (<see cref="SafeZip"/>, extraída de la importación del <c>.walkie</c>): las opciones por
/// defecto conservan el comportamiento de siempre y las estrictas (las del <c>.walkiepack</c>) rechazan cada ataque.
/// Sin base ni HTTP.
/// </summary>
public sealed class SafeZipTests
{
    private static readonly SafeZipOptions Strict = new()
    {
        FormatName = ".walkiepack",
        MaxEntries = 16,
        RejectDuplicateNames = true,
        RejectUnsafeNames = true,
        AllowedEntries = new HashSet<string>(["manifest.json", "discovery.json"], StringComparer.Ordinal),
    };

    [Fact]
    public void Por_defecto_conserva_el_comportamiento_del_walkie_la_primera_entrada_repetida_gana()
    {
        var file = Zip(("manifest.json", "{\"a\":1}"u8.ToArray()), ("manifest.json", "{\"a\":2}"u8.ToArray()), ("img/../x.png", [1]));
        var errors = new Dictionary<string, string[]>();

        using var zip = SafeZip.Open(file, new SafeZipOptions(), errors);

        Assert.NotNull(zip);
        Assert.Empty(errors);
        Assert.Equal(1, zip!.ReadJson("manifest.json", errors)!.Value.GetProperty("a").GetInt32());
    }

    [Theory]
    [InlineData("../manifest.json")]
    [InlineData("/manifest.json")]
    [InlineData("C:/manifest.json")]
    [InlineData("a\\manifest.json")]
    [InlineData("./manifest.json")]
    [InlineData("dir//manifest.json")]
    [InlineData("dir/")]
    [InlineData("man\u0001ifest.json")]
    public void Estricto_rechaza_nombres_que_no_son_rutas_relativas_limpias(string name)
    {
        var errors = new Dictionary<string, string[]>();

        using var zip = SafeZip.Open(Zip((name, "{}"u8.ToArray())), Strict, errors);

        Assert.Null(zip);
        Assert.Contains("Nombre de entrada inválido", string.Join(" ", errors.Values.SelectMany(v => v)), StringComparison.Ordinal);
    }

    [Fact]
    public void Estricto_rechaza_entradas_repetidas_o_inesperadas()
    {
        var duplicates = new Dictionary<string, string[]>();
        var unexpected = new Dictionary<string, string[]>();

        Assert.Null(SafeZip.Open(Zip(("manifest.json", "{}"u8.ToArray()), ("manifest.json", "{}"u8.ToArray())), Strict, duplicates));
        Assert.Null(SafeZip.Open(Zip(("manifest.json", "{}"u8.ToArray()), ("leeme.txt", "hola"u8.ToArray())), Strict, unexpected));

        Assert.Contains("Entrada repetida", duplicates["file/manifest.json"][0], StringComparison.Ordinal);
        Assert.Contains("Entrada inesperada", unexpected["file/leeme.txt"][0], StringComparison.Ordinal);
    }

    [Fact]
    public void El_total_descomprimido_tiene_tope_aunque_cada_entrada_quepa()
    {
        var chunk = Encoding.UTF8.GetBytes(new string(' ', 800));
        var file = Zip(("manifest.json", chunk), ("discovery.json", chunk));
        var errors = new Dictionary<string, string[]>();
        using var zip = SafeZip.Open(file, Strict with { MaxUncompressedBytes = 2000 }, errors)!;

        Assert.NotNull(zip.ReadBytes(zip.Entries["manifest.json"], 1000));
        Assert.NotNull(zip.ReadBytes(zip.Entries["discovery.json"], 1000));
        Assert.Null(zip.ReadBytes(zip.Entries["discovery.json"], 1000)); // 800 + 800 caben en 2000; la tercera (2400) no
    }

    [Fact]
    public void Un_documento_mas_profundo_que_el_maximo_no_es_JSON_valido()
    {
        var deep = Encoding.UTF8.GetBytes(new string('[', 100) + new string(']', 100));
        var errors = new Dictionary<string, string[]>();
        using var zip = SafeZip.Open(Zip(("discovery.json", deep)), Strict, errors)!;

        Assert.Null(zip.ReadJson("discovery.json", errors));
        Assert.Equal(["No es JSON válido."], errors["discovery.json"]);
    }
}
