using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Refreshes Tesla OAuth tokens proactively before they expire.
/// Runs every 30 minutes and refreshes any account whose access token
/// expires within the next 60 minutes. Quietly does nothing when the
/// Security Alerts feature is not configured.
/// </summary>
public sealed class TeslaTokenRefreshBackgroundService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan RefreshHorizon = TimeSpan.FromMinutes(60);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TeslaTokenRefreshBackgroundService> _logger;

    public TeslaTokenRefreshBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<TeslaTokenRefreshBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken).ConfigureAwait(false);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RefreshDueAccountsAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Tesla token refresh cycle failed.");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RefreshDueAccountsAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var oauth = scope.ServiceProvider.GetRequiredService<TeslaOAuthService>();
        if (!oauth.IsConfigured)
            return;

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var threshold = DateTime.UtcNow.Add(RefreshHorizon);

        var dueAccounts = await db.Set<TeslaAccount>()
            .Where(a => a.AccessTokenExpiresAt <= threshold)
            .Select(a => a.Id)
            .ToListAsync(cancellationToken);

        if (dueAccounts.Count == 0)
            return;

        _logger.LogInformation("Refreshing {Count} Tesla account(s) due to expire before {Threshold}.",
            dueAccounts.Count, threshold);

        foreach (var accountId in dueAccounts)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await oauth.RefreshTokensAsync(accountId, cancellationToken);
        }
    }
}
