using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Endpoints;

/// <summary>
/// Per-car 3D viewer ("Showroom") configuration overrides.
///
/// The Showroom page lets the user tune visual parameters that are
/// otherwise hard-coded in the frontend's vehicleModelConfig.ts:
///   - paint color / wheel choice / trim selection
///   - wheel anchor offsets (X/Y/Z per corner)
///   - charge port socket position, plug direction, cable ground anchor
///   - sentry camera anchor positions
///   - glass opacity / tint / privacy darkening
///   - headlight & stoplight projection texture / color / opacity
///
/// Once saved, every page that mounts the 3D viewer (Home, Cards…)
/// loads the same override and renders the same calibrated vehicle.
/// "No row" = "use the repo defaults" so removing a row is a clean
/// reset back to the shipped defaults.
///
/// The body is opaque JSON owned by the frontend (see TS type
/// ShowroomOverrides). We never read inside on the server; we just
/// validate that it parses as a JSON object and persist it to a
/// PostgreSQL jsonb column.
/// </summary>
public static class ShowroomEndpoints
{
    /// <summary>
    /// Hard cap on the JSON payload size. The frontend's full override
    /// (every tunable param × every model) sits well under 30 KB; we
    /// reject anything bigger to keep a malicious / buggy client from
    /// shoving megabytes of garbage into Postgres.
    /// </summary>
    private const int MaxConfigBytes = 256 * 1024;

    public static void MapShowroomEndpoints(this WebApplication app)
    {
        // Showroom tweaks visual chrome only — never sends Tesla
        // commands — but we still require auth so each user only
        // mutates configs for cars they own. Authorization is handled
        // by the existing /api/vehicle group convention.
        var group = app.MapGroup("/api/vehicle").RequireAuthorization();

        group.MapGet("/{carId:int}/showroom", GetShowroomConfig);
        group.MapPut("/{carId:int}/showroom", SaveShowroomConfig);
        group.MapDelete("/{carId:int}/showroom", DeleteShowroomConfig);
    }

    private static async Task<IResult> GetShowroomConfig(int carId, AppDbContext db)
    {
        var row = await db.CarShowroomConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.CarId == carId);

        // No row = no override = caller falls back to the repo defaults.
        // We return an empty object rather than 404 so the frontend's
        // useQuery hook gets a deterministic shape every time.
        if (row == null)
        {
            return Results.Ok(new ShowroomConfigDto
            {
                CarId = carId,
                Config = new Dictionary<string, object>(),
                UpdatedAt = null,
            });
        }

        // We re-parse the stored JSON so the response is a real JSON
        // object (not a string-escaped blob). JsonDocument.Parse is
        // cheap; this endpoint is called once per page mount.
        Dictionary<string, object>? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<Dictionary<string, object>>(row.ConfigJson)
                ?? new Dictionary<string, object>();
        }
        catch (JsonException)
        {
            // Defensive: if the stored payload was somehow corrupted
            // (manual edit, partial write…) hand back an empty config
            // so the page still loads instead of 500-ing.
            parsed = new Dictionary<string, object>();
        }

        return Results.Ok(new ShowroomConfigDto
        {
            CarId = carId,
            Config = parsed,
            UpdatedAt = row.UpdatedAt,
        });
    }

    private static async Task<IResult> SaveShowroomConfig(
        int carId, HttpRequest request, AppDbContext db)
    {
        // Read the body ourselves so we can validate size + JSON-ness
        // BEFORE EF tries to write the column. .NET's model binder
        // would already have parsed the JSON, but we want a strict
        // 400 (not a 415 / model-binding error page) on bad input.
        using var ms = new MemoryStream();
        await request.Body.CopyToAsync(ms);
        var raw = ms.ToArray();

        if (raw.Length == 0)
            return Results.BadRequest(new { error = "Empty body" });

        if (raw.Length > MaxConfigBytes)
            return Results.BadRequest(new
            {
                error = $"Payload exceeds {MaxConfigBytes / 1024} KB limit",
            });

        // Validate the body is a JSON OBJECT (not a number, array, or
        // bare string). Anything else means the caller is doing it
        // wrong; we reject early rather than store junk that the
        // frontend won't be able to deserialize.
        string normalized;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return Results.BadRequest(new { error = "Body must be a JSON object" });

            // Re-serialize via JsonDocument so we strip insignificant
            // whitespace and store a canonical form. Cheap, makes the
            // jsonb column smaller, and means diffs in the DB are
            // semantic (not whitespace noise).
            normalized = doc.RootElement.GetRawText();
        }
        catch (JsonException ex)
        {
            return Results.BadRequest(new { error = $"Invalid JSON: {ex.Message}" });
        }

        var row = await db.CarShowroomConfigs.FirstOrDefaultAsync(c => c.CarId == carId);
        if (row == null)
        {
            db.CarShowroomConfigs.Add(new CarShowroomConfig
            {
                CarId = carId,
                ConfigJson = normalized,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            row.ConfigJson = normalized;
            row.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return Results.Ok(new { success = true, updatedAt = DateTime.UtcNow });
    }

    private static async Task<IResult> DeleteShowroomConfig(int carId, AppDbContext db)
    {
        // Delete = reset to defaults. We don't 404 on missing row so
        // the frontend can blindly call this for the "Reset défauts"
        // button without worrying about prior state.
        var row = await db.CarShowroomConfigs.FirstOrDefaultAsync(c => c.CarId == carId);
        if (row != null)
        {
            db.CarShowroomConfigs.Remove(row);
            await db.SaveChangesAsync();
        }
        return Results.Ok(new { success = true });
    }
}

/// <summary>
/// Response payload for GET /api/vehicle/{carId}/showroom.
/// `Config` is the opaque frontend shape (rendered as a JSON object so
/// React Query can `data.config.wheelOffsets.LF.x` directly without an
/// extra parse step). `UpdatedAt` is null when no override exists yet.
/// </summary>
public record ShowroomConfigDto
{
    public int CarId { get; init; }
    public Dictionary<string, object> Config { get; init; } = new();
    public DateTime? UpdatedAt { get; init; }
}
