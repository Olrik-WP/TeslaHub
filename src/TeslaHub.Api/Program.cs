using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeslaHub.Api.Auth;
using TeslaHub.Api.Data;
using TeslaHub.Api.Endpoints;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

var builder = WebApplication.CreateBuilder(args);

var tmHost = builder.Configuration["TM_DB_HOST"] ?? "localhost";
var tmPort = builder.Configuration["TM_DB_PORT"] ?? "5432";
var tmDb = builder.Configuration["TM_DB_NAME"] ?? "teslamate";
var tmUser = builder.Configuration["TM_DB_USER"] ?? "teslamate_readonly";
var tmPass = builder.Configuration["TM_DB_PASSWORD"] ?? "";
var tmConnectionString = $"Host={tmHost};Port={tmPort};Database={tmDb};Username={tmUser};Password={tmPass};";

var appHost = builder.Configuration["APP_DB_HOST"] ?? "localhost";
var appPort = builder.Configuration["APP_DB_PORT"] ?? "5432";
var appDb = builder.Configuration["APP_DB_NAME"] ?? "teslahub";
var appUser = builder.Configuration["APP_DB_USER"] ?? "teslahub_app";
var appPass = builder.Configuration["APP_DB_PASSWORD"] ?? "";
var appConnectionString = $"Host={appHost};Port={appPort};Database={appDb};Username={appUser};Password={appPass};";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(appConnectionString));

builder.Services.AddSingleton(new TeslaMateConnectionFactory(tmConnectionString));
builder.Services.AddScoped<CostService>();
builder.Services.AddScoped<LocationNameService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddSingleton<CacheService>();
builder.Services.AddSingleton<MqttLiveDataService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<MqttLiveDataService>());
builder.Services.AddHttpClient("tesla", c => c.DefaultRequestHeaders.UserAgent.ParseAdd("TeslaHub/1.0"));

// The "tesla-proxy" HttpClient is used to talk to the local
// vehicle-command-proxy container, which presents a self-signed TLS
// certificate. We skip cert validation only on this client (and only
// for the proxy hostname configured via TESLA_COMMAND_PROXY_URL) —
// direct calls to Tesla's public Fleet API still use strict TLS.
builder.Services.AddHttpClient("tesla-proxy", c => c.DefaultRequestHeaders.UserAgent.ParseAdd("TeslaHub/1.0"))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
    });

// Tesla Fleet API integration (optional Security Alerts feature)
builder.Services.AddSingleton<TeslaTokenEncryptionService>();
builder.Services.AddScoped<TeslaOAuthService>();
builder.Services.AddScoped<TeslaKeyService>();
builder.Services.AddScoped<TeslaFleetApiClient>();
builder.Services.AddScoped<TeslaPairingService>();
builder.Services.AddSingleton<TelegramNotificationService>();
builder.Services.AddScoped<SecurityAlertService>();
builder.Services.AddHostedService<TeslaTokenRefreshBackgroundService>();
builder.Services.AddHostedService<TeslaTelemetryConsumer>();

var jwtSecret = builder.Configuration["TESLAHUB_JWT_SECRET"]
    ?? Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");

if (string.IsNullOrEmpty(builder.Configuration["TESLAHUB_JWT_SECRET"]))
{
    builder.Configuration["TESLAHUB_JWT_SECRET"] = jwtSecret;
}

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (context.Request.Path.StartsWithSegments("/api/vehicle")
                    && context.Request.Path.Value?.EndsWith("/live-stream") == true
                    && context.Request.Query.TryGetValue("access_token", out var token))
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddMemoryCache(options =>
{
    options.SizeLimit = 1024;
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();

    var adminUser = builder.Configuration["TESLAHUB_ADMIN_USER"] ?? "admin";
    var adminPass = builder.Configuration["TESLAHUB_ADMIN_PASSWORD"] ?? "admin";

    var authService = scope.ServiceProvider.GetRequiredService<AuthService>();
    await authService.EnsureAdminUserAsync(adminUser, adminPass);
}

app.UseMiddleware<IpFilterMiddleware>();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapVehicleEndpoints();
app.MapVehicleImageEndpoints();
app.MapDrivesEndpoints();
app.MapChargingEndpoints();
app.MapMapEndpoints();
app.MapCostsEndpoints();
app.MapVampireEndpoints();
app.MapMileageEndpoints();
app.MapUpdatesEndpoints();
app.MapEfficiencyEndpoints();
app.MapBatteryEndpoints();
app.MapStatesEndpoints();
app.MapStatisticsEndpoints();
app.MapDatabaseEndpoints();
app.MapLocationsEndpoints();
app.MapTripEndpoints();
app.MapTeslaOAuthEndpoints();
app.MapTeslaPairingEndpoints();
app.MapSecurityAlertsEndpoints();

app.MapGet("/api/health", () => Results.Ok(new { Status = "OK", Timestamp = DateTime.UtcNow }))
    .AllowAnonymous();

app.Run();
