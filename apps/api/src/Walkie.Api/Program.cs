using Walkie.Api.Auth;
using Walkie.Api.Endpoints;
using Walkie.Modules.Apps;
using Walkie.Modules.Canvas;
using Walkie.Modules.Export;
using Walkie.Modules.Files;
using Walkie.Modules.Sharing;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddWalkieAuth(builder.Configuration);

var connectionString = builder.Configuration.GetConnectionString("Walkie")
    ?? throw new InvalidOperationException("Falta ConnectionStrings:Walkie (variable de entorno ConnectionStrings__Walkie).");
builder.Services.AddAppsModule(connectionString);
builder.Services.AddCanvasModule(connectionString);
builder.Services.AddFilesModule(connectionString, builder.Configuration);
builder.Services.AddSharingModule(connectionString);
builder.Services.AddExportModule();

const string WebCorsPolicy = "web";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
    options.AddPolicy(WebCorsPolicy, policy =>
        // Content-Disposition expuesto: la web lee el nombre del archivo del export (spec export-markdown).
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Disposition")));

var app = builder.Build();

app.UseExceptionHandler(new ExceptionHandlerOptions
{
    // Cuerpo ausente o JSON inválido: 400 (no 500) con ProblemDetails.
    StatusCodeSelector = ex => ex is BadHttpRequestException bad ? bad.StatusCode : StatusCodes.Status500InternalServerError,
});
app.UseStatusCodePages();
app.UseCors(WebCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.MapHealthEndpoints();
app.MapMeEndpoints();
app.MapAppsModule();
app.MapCanvasModule();
app.MapFilesModule();
app.MapSharingModule();
app.MapExportModule();

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    await app.Services.MigrateAppsDatabaseAsync();
    await app.Services.MigrateCanvasDatabaseAsync();
    await app.Services.MigrateFilesAsync();
    await app.Services.MigrateSharingDatabaseAsync();
}

await app.RunAsync();

/// <summary>Punto de entrada; público para <c>WebApplicationFactory</c> en las pruebas.</summary>
public partial class Program;
