namespace Walkie.Cli;

/// <summary>
/// Punto de entrada de <c>walkie</c>. Es una clase con espacio de nombres (no instrucciones de nivel superior) a
/// propósito: las pruebas de la API referencian la CLI para generar paquetes reales, y una clase <c>Program</c>
/// global chocaría con la del host de la API (<c>WebApplicationFactory&lt;Program&gt;</c>).
/// </summary>
internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            return CliApp.Run(args, Console.Out, Console.Error);
        }
#pragma warning disable CA1031 // último recurso: un error inesperado se informa con un código de salida, no con una traza
        catch (Exception ex)
#pragma warning restore CA1031
        {
            Console.Error.WriteLine($"Error inesperado ({ex.GetType().Name}): {ex.Message}");
            return CliApp.Unexpected;
        }
    }
}
