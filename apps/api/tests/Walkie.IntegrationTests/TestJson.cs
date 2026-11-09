using System.Text.Json;

namespace Walkie.IntegrationTests;

/// <summary>JSON para las pruebas (contratos del catálogo, que la API recibe y devuelve tal cual).</summary>
internal static class TestJson
{
    public static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    /// <summary>Contrato mínimo: método y ruta.</summary>
    public static JsonElement Http(string method, string path) =>
        Parse(JsonSerializer.Serialize(new { method, path }));
}
