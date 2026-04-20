using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// HTTP endpoints for the Tesla Fleet API OAuth flow.
/// All endpoints live under /api/tesla-oauth and require authentication
/// except the OAuth callback (which Tesla calls without a TeslaHub session).
/// </summary>
public static class TeslaOAuthEndpoints
{
    public static void MapTeslaOAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/tesla-oauth");

        group.MapGet("/status", async (TeslaOAuthService oauth, CancellationToken ct) =>
        {
            var status = await oauth.GetStatusAsync(ct);
            return Results.Ok(status);
        }).RequireAuthorization();

        group.MapPost("/login", (TeslaOAuthService oauth, HttpContext ctx) =>
        {
            if (!oauth.IsConfigured)
                return Results.Problem(
                    title: "Tesla OAuth not configured",
                    detail: "Set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and TESLA_REDIRECT_URI in your environment to enable Security Alerts.",
                    statusCode: 503);

            try
            {
                var locale = ctx.Request.Headers.AcceptLanguage.ToString();
                var first = string.IsNullOrEmpty(locale) ? null : locale.Split(',')[0];
                var result = oauth.BuildLoginRequest(first);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        }).RequireAuthorization();

        group.MapGet("/callback", async (
            string? code,
            string? state,
            string? error,
            string? error_description,
            TeslaOAuthService oauth,
            CancellationToken ct) =>
        {
            const string redirectBase = "/settings?tab=tesla&tesla=";

            if (!string.IsNullOrEmpty(error))
            {
                var safeError = Uri.EscapeDataString(error_description ?? error);
                return Results.Redirect($"{redirectBase}error&detail={safeError}");
            }

            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
                return Results.Redirect($"{redirectBase}missing_params");

            try
            {
                await oauth.AuthenticateWithCodeAsync(code, state, ct);
                return Results.Redirect($"{redirectBase}connected");
            }
            catch (Exception ex)
            {
                var safeError = Uri.EscapeDataString(ex.Message);
                return Results.Redirect($"{redirectBase}error&detail={safeError}");
            }
        }).AllowAnonymous();

        group.MapPost("/disconnect", async (TeslaOAuthService oauth, CancellationToken ct) =>
        {
            var account = await oauth.GetCurrentAccountAsync(ct);
            if (account is null)
                return Results.NoContent();

            await oauth.DisconnectAsync(account.Id, ct);
            return Results.Ok(new { disconnected = true });
        }).RequireAuthorization();

        group.MapPost("/refresh", async (TeslaOAuthService oauth, CancellationToken ct) =>
        {
            var account = await oauth.GetCurrentAccountAsync(ct);
            if (account is null)
                return Results.NotFound(new { error = "No connected Tesla account." });

            var refreshed = await oauth.RefreshTokensAsync(account.Id, ct);
            if (refreshed is null)
                return Results.Problem(
                    title: "Refresh failed",
                    detail: "Could not refresh Tesla tokens. Reconnect your Tesla account.",
                    statusCode: 502);

            return Results.Ok(await oauth.GetStatusAsync(ct));
        }).RequireAuthorization();
    }
}
