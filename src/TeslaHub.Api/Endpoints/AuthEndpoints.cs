using System.Collections.Concurrent;
using System.Security.Claims;
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
                _loginAttempts.AddOrUpdate(ip,
                    _ => (1, DateTime.UtcNow + GetLockoutDuration(1)),
                    (_, existing) =>
                    {
                        var c = existing.Count + 1;
                        return (c, DateTime.UtcNow + GetLockoutDuration(c));
                    });

                return Results.Unauthorized();
            }

            _loginAttempts.TryRemove(ip, out _);

            SetRefreshCookie(ctx, result.RefreshToken, result.RefreshExpiresInDays);

            // refreshToken is also returned in the response body so the
            // frontend can persist it in localStorage. This is the path that
            // actually works in iOS Safari standalone PWA (cookies set in
            // Safari are NOT visible to the home-screen-installed app), and
            // on HTTP-only deployments (Tailscale) where Secure cookies
            // would be dropped by the browser entirely.
            return Results.Ok(new
            {
                result.AccessToken,
                result.RefreshToken,
                result.ExpiresIn,
                result.RefreshExpiresInDays,
            });
        }).AllowAnonymous();

        group.MapPost("/refresh", (RefreshRequest? body, HttpContext ctx, AuthService auth) =>
        {
            // Accept the refresh token from either the request body (PWA /
            // cross-origin / HTTP deployments) or the HttpOnly cookie
            // (classic same-origin browser session). Body wins when both
            // are present so a freshly-rotated client token always takes
            // precedence over a stale cookie.
            var refreshToken = !string.IsNullOrWhiteSpace(body?.RefreshToken)
                ? body!.RefreshToken
                : ctx.Request.Cookies[RefreshCookieName];

            if (string.IsNullOrEmpty(refreshToken))
                return Results.Unauthorized();

            var result = auth.RefreshToken(refreshToken);
            if (result == null)
            {
                ctx.Response.Cookies.Delete(RefreshCookieName, BuildCookieOptions(ctx));
                return Results.Unauthorized();
            }

            SetRefreshCookie(ctx, result.RefreshToken, result.RefreshExpiresInDays);

            return Results.Ok(new
            {
                result.AccessToken,
                result.RefreshToken,
                result.ExpiresIn,
                result.RefreshExpiresInDays,
            });
        }).AllowAnonymous();

        group.MapPost("/logout", (HttpContext ctx) =>
        {
            ctx.Response.Cookies.Delete(RefreshCookieName, BuildCookieOptions(ctx));
            return Results.Ok();
        }).AllowAnonymous();

        group.MapPost("/change-password", async (ChangePasswordRequest request, AuthService auth, HttpContext ctx) =>
        {
            var userIdClaim = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (userIdClaim == null || !int.TryParse(userIdClaim, out var userId))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 6)
                return Results.BadRequest("Password must be at least 6 characters.");

            var success = await auth.ChangePasswordAsync(userId, request.CurrentPassword, request.NewPassword);
            if (!success)
                return Results.BadRequest("Current password is incorrect.");

            return Results.Ok(new { message = "Password changed successfully." });
        }).RequireAuthorization();
    }

    private static void SetRefreshCookie(HttpContext ctx, string token, int expiresInDays)
    {
        var options = BuildCookieOptions(ctx);
        options.MaxAge = TimeSpan.FromDays(expiresInDays);
        options.Expires = DateTimeOffset.UtcNow.AddDays(expiresInDays);

        ctx.Response.Cookies.Append(RefreshCookieName, token, options);
    }

    private static CookieOptions BuildCookieOptions(HttpContext ctx) => new()
    {
        HttpOnly = true,

        // Secure is only meaningful — and only valid — on HTTPS. Forcing it
        // to true breaks every HTTP deployment (notably http://*.ts.net
        // over Tailscale and bare LAN access) because the browser silently
        // drops the cookie. We rely on ForwardedHeaders being enabled in
        // Program.cs so Request.IsHttps reflects the real client scheme
        // when the API sits behind Caddy / Cloudflare.
        Secure = ctx.Request.IsHttps,

        // Lax is the correct trade-off here: the cookie travels on the
        // top-level navigation that loads the SPA and on the same-site
        // POST /api/auth/refresh issued by the SPA, but never on truly
        // cross-site requests. We deliberately do not use SameSite=None
        // because that would force Secure=true and break HTTP setups.
        SameSite = SameSiteMode.Lax,

        Path = "/api/auth",
    };
}
