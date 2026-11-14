using Walkie.Cli;

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
