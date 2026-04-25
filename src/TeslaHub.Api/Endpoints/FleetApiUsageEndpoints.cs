using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Services;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// Reports the locally-estimated Tesla Fleet API usage and cost for the
/// current month. Hidden behind the <c>ShowFleetApiCost</c> setting:
/// when off, the endpoint still answers (so the SPA can render a
/// disabled state) but exposes only the toggle status.
///
/// IMPORTANT: this is an estimate. Tesla doesn't publish a billing API,
/// so the only authoritative source remains
/// https://developer.tesla.com/dashboard/usage. The estimate counts
/// every request emitted by TeslaHub (filtered to billable status &lt; 500)
/// and applies the public per-category prices + the $10 monthly credit.
/// </summary>
public static class FleetApiUsageEndpoints
{
    public static void MapFleetApiUsageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/fleet-usage").RequireAuthorization();

        group.MapGet("", async (
            AppDbContext db,
            FleetApiUsageMeter meter,
            CancellationToken ct) =>
        {
            var settings = await db.GlobalSettings.AsNoTracking().FirstOrDefaultAsync(ct);
            var enabled = settings?.ShowFleetApiCost ?? false;
            var snapshot = await meter.GetSnapshotAsync(db, enabled, ct);
            return Results.Ok(snapshot);
        });
    }
}
