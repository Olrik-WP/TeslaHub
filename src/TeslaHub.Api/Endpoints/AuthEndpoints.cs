using System.Collections.Concurrent;
using TeslaHub.Api.Auth;

namespace TeslaHub.Api.Endpoints;

public static class AuthEndpoints
{
    private static readonly ConcurrentDictionary<string, (int Count, DateTime ResetAt)> _loginAttempts = new();
    private const int MaxAttempts = 10;
    private static readonly TimeSpan Window = TimeSpan.FromHours(1);
    private const string RefreshCookieName = "teslahub_refresh";

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", async (LoginRequest request, AuthService auth, HttpContext ctx) =>
        {
            var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            if (_loginAttempts.TryGetValue(ip, out var attempt))
            {
                if (DateTime.UtcNow < attempt.ResetAt && attempt.Count >= MaxAttempts)
                    return Results.Problem("Too many login attempts. Try again later.", statusCode: 429);

                if (DateTime.UtcNow >= attempt.ResetAt)
                    _loginAttempts.TryRemove(ip, out _);
            }

            var result = await auth.LoginAsync(request.Username, request.Password);
            if (result == null)
            {
                _loginAttempts.AddOrUpdate(ip,
                    _ => (1, DateTime.UtcNow.Add(Window)),
                    (_, existing) => (existing.Count + 1, existing.ResetAt));

                return Results.Unauthorized();
            }

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
            SameSite = SameSiteMode.Strict,
            Path = "/api/auth",
            MaxAge = TimeSpan.FromDays(expiresInDays)
        });
    }
}
