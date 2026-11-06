using Walkie.Api.Auth;
using Walkie.Api.Endpoints;
using Walkie.Modules.Apps;
using Walkie.Modules.Canvas;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddWalkieAuth(builder.Configuration);

var connectionString = builder.Configuration.GetConnectionString("Walkie")
    ?? throw new InvalidOperationException("Falta ConnectionStrings:Walkie (variable de entorno ConnectionStrings__Walkie).");
builder.Services.AddAppsModule(connectionString);
builder.Services.AddCanvasModule(connectionString);

const string WebCorsPolicy = "web";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
    options.AddPolicy(WebCorsPolicy, policy =>
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseExceptionHandler();
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

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    await app.Services.MigrateAppsDatabaseAsync();
    await app.Services.MigrateCanvasDatabaseAsync();
}

await app.RunAsync();

/// <summary>Punto de entrada; público para <c>WebApplicationFactory</c> en las pruebas.</summary>
public partial class Program;
