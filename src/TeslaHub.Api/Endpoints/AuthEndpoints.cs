using System.Collections.Concurrent;
using TeslaHub.Api.Auth;

namespace TeslaHub.Api.Endpoints;

public static class AuthEndpoints
{
    private static readonly ConcurrentDictionary<string, (int Count, DateTime LockedUntil)> _loginAttempts = new();
    private const string RefreshCookieName = "teslahub_refresh";

    private static TimeSpan GetLockoutDuration(int failCount) => failCount switch
    {
        <= 2 => TimeSpan.Zero,
        3    => TimeSpan.FromSeconds(15),
        4    => TimeSpan.FromMinutes(1),
        5    => TimeSpan.FromMinutes(5),
        _    => TimeSpan.FromMinutes(30),
    };

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", async (LoginRequest request, AuthService auth, HttpContext ctx) =>
        {
            var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            if (_loginAttempts.TryGetValue(ip, out var attempt) && DateTime.UtcNow < attempt.LockedUntil)
            {
                var remaining = (int)Math.Ceiling((attempt.LockedUntil - DateTime.UtcNow).TotalSeconds);
                return Results.Problem($"Too many attempts. Try again in {remaining}s.", statusCode: 429);
            }

            var result = await auth.LoginAsync(request.Username, request.Password);
            if (result == null)
            {
                var newCount = _loginAttempts.AddOrUpdate(ip,
                    _ => (1, DateTime.UtcNow + GetLockoutDuration(1)),
                    (_, existing) =>
                    {
                        var c = existing.Count + 1;
                        return (c, DateTime.UtcNow + GetLockoutDuration(c));
                    }).Count;

                return Results.Unauthorized();
            }

            _loginAttempts.TryRemove(ip, out _);

            SetRefreshCookie(ctx, result.RefreshToken, result.RefreshExpiresInDays);

            return Results.Ok(new { result.AccessToken, result.ExpiresIn });
        }).AllowAnonymous();

        group.MapPost("/refresh", (HttpContext ctx, AuthService auth) =>
        {
            var refreshToken = ctx.Request.Cookies[RefreshCookieName];
            if (string.IsNullOrEmpty(refreshToken))
                return Results.Unauthorized();

            var result = auth.RefreshToken(refreshToken);
            if (result == null)
            {
                ctx.Response.Cookies.Delete(RefreshCookieName);
                return Results.Unauthorized();
            }

            SetRefreshCookie(ctx, result.RefreshToken, result.RefreshExpiresInDays);

            return Results.Ok(new { result.AccessToken, result.ExpiresIn });
        }).AllowAnonymous();

        group.MapPost("/logout", (HttpContext ctx) =>
        {
            ctx.Response.Cookies.Delete(RefreshCookieName);
            return Results.Ok();
        }).AllowAnonymous();
    }

    private static void SetRefreshCookie(HttpContext ctx, string token, int expiresInDays)
    {
        ctx.Response.Cookies.Append(RefreshCookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Lax,
            Path = "/api/auth",
            MaxAge = TimeSpan.FromDays(expiresInDays)
        });
    }
}
