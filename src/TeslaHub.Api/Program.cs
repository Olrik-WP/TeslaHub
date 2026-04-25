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

// Singleton meter that counts outgoing Fleet API requests for the
// monthly cost estimator surfaced in Settings. Registered before the
// HttpClient factories so the DelegatingHandler can resolve it.
builder.Services.AddSingleton<FleetApiUsageMeter>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<FleetApiUsageMeter>());
builder.Services.AddTransient<FleetApiUsageHandler>();

builder.Services.AddHttpClient("tesla", c => c.DefaultRequestHeaders.UserAgent.ParseAdd("TeslaHub/1.0"))
    .AddHttpMessageHandler<FleetApiUsageHandler>();

// The "tesla-proxy" HttpClient is used to talk to the local
// vehicle-command-proxy container, which presents a self-signed TLS
// certificate. We skip cert validation only on this client (and only
// for the proxy hostname configured via TESLA_COMMAND_PROXY_URL) —
// direct calls to Tesla's public Fleet API still use strict TLS.
builder.Services.AddHttpClient("tesla-proxy", c => c.DefaultRequestHeaders.UserAgent.ParseAdd("TeslaHub/1.0"))
    .AddHttpMessageHandler<FleetApiUsageHandler>()
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
builder.Services.AddScoped<TeslaCommandService>();
builder.Services.AddScoped<TeslaShareService>();
builder.Services.AddHostedService<TeslaTokenRefreshBackgroundService>();
builder.Services.AddHostedService<TeslaTelemetryConsumer>();

// Public chargers map layer (proxies Open Charge Map). Cached server-side so
// every browser pan does not hit OCM directly.
builder.Services.AddHttpClient("ocm", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd("TeslaHub/1.0 (+https://github.com/Olrik-WP/TeslaHub)");
    c.Timeout = TimeSpan.FromSeconds(20);
});
builder.Services.AddSingleton<ChargersService>();

// TESLAHUB_JWT_SECRET is mandatory: it signs every session JWT AND is used
// to derive the AES-GCM key that encrypts the Tesla OAuth tokens and the
// partner private key at rest. Falling back to a random value would silently
// invalidate every encrypted blob in the database on each restart.
var jwtSecret = builder.Configuration["TESLAHUB_JWT_SECRET"];
if (string.IsNullOrWhiteSpace(jwtSecret) || jwtSecret.Length < 32)
{
    throw new InvalidOperationException(
        "TESLAHUB_JWT_SECRET is required and must be at least 32 characters long. " +
        "Generate one with: openssl rand -hex 32");
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

// CORS allow-list. In a standard deployment the Web SPA is served by the
// same Caddy that reverse-proxies /api/*, so requests are same-origin and
// no CORS headers are needed. Only set TESLAHUB_ALLOWED_ORIGINS if you
// serve the frontend from a different origin (e.g. a separate domain).
// Wildcard origins are deliberately not supported when credentials are in
// play — that combination is unsafe and was the previous behaviour.
var corsOrigins = (builder.Configuration["TESLAHUB_ALLOWED_ORIGINS"] ?? string.Empty)
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (corsOrigins.Length > 0)
        {
            policy.WithOrigins(corsOrigins)
                  .AllowAnyMethod()
                  .AllowAnyHeader()
                  .AllowCredentials();
        }
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();

    // Only enforce TESLAHUB_ADMIN_PASSWORD on first run (when the users table
    // is empty). On subsequent restarts the env var is irrelevant — the user
    // can change their password from the UI — so we don't want to break
    // existing installations if the variable is later removed.
    if (!await db.Users.AnyAsync())
    {
        var adminUser = builder.Configuration["TESLAHUB_ADMIN_USER"] ?? "admin";
        var adminPass = builder.Configuration["TESLAHUB_ADMIN_PASSWORD"];

        if (string.IsNullOrWhiteSpace(adminPass) || adminPass.Length < 6)
        {
            throw new InvalidOperationException(
                "TESLAHUB_ADMIN_PASSWORD is required (min 6 characters) to create the initial admin account. " +
                "Set it in your .env, start the stack, then change the password from the Settings page.");
        }

        var authService = scope.ServiceProvider.GetRequiredService<AuthService>();
        await authService.EnsureAdminUserAsync(adminUser, adminPass);
    }
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
app.MapTeslaShareEndpoints();
app.MapTeslaControlEndpoints();
app.MapSecurityAlertsEndpoints();
app.MapChargersEndpoints();
app.MapFleetApiUsageEndpoints();

app.MapGet("/api/health", () => Results.Ok(new { Status = "OK", Timestamp = DateTime.UtcNow }))
    .AllowAnonymous();

app.Run();
