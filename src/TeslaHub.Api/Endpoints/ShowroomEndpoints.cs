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

    /// <summary>
    /// Hard cap on the custom wrap PNG. Matches Tesla's own
    /// in-car configurator (USB→Wraps tab) limit, and keeps a single
    /// car's row from bloating Postgres / the GET response.
    /// </summary>
    private const int MaxWrapBytes = 1024 * 1024;

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

        // Custom wrap PNG (separate URL so the GET-config endpoint
        // stays cheap and the renderer can fetch the PNG on its own
        // via a regular browser request — auth carried by the
        // session cookie that's already on every request).
        group.MapGet("/{carId:int}/showroom/wrap", GetShowroomWrap);
        group.MapPut("/{carId:int}/showroom/wrap", SaveShowroomWrap)
             .DisableAntiforgery();
        group.MapDelete("/{carId:int}/showroom/wrap", DeleteShowroomWrap);
    }

    private static async Task<IResult> GetShowroomConfig(int carId, AppDbContext db)
    {
        // Project away the WrapPng blob — we only need its presence /
        // size, not the bytes. Loading the whole PNG (~1 MB) on every
        // page mount would needlessly inflate the response.
        var row = await db.CarShowroomConfigs
            .AsNoTracking()
            .Where(c => c.CarId == carId)
            .Select(c => new
            {
                c.ConfigJson,
                c.UpdatedAt,
                WrapBytes = c.WrapPng == null ? 0 : c.WrapPng.Length,
            })
            .FirstOrDefaultAsync();

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
                WrapExists = false,
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
            WrapExists = row.WrapBytes > 0,
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

    // ─── Custom wrap PNG ──────────────────────────────────────────

    /// <summary>
    /// Stream the per-car body wrap PNG. 404 when no wrap is set so
    /// the frontend's `<img>` fallback / texture-loading error handler
    /// kicks in cleanly. Cache headers are intentionally short — the
    /// user can upload a new wrap any time and expect the viewer to
    /// pick it up on the next page load.
    /// </summary>
    private static async Task<IResult> GetShowroomWrap(int carId, AppDbContext db)
    {
        var png = await db.CarShowroomConfigs
            .AsNoTracking()
            .Where(c => c.CarId == carId)
            .Select(c => c.WrapPng)
            .FirstOrDefaultAsync();

        if (png == null || png.Length == 0)
            return Results.NotFound();

        return Results.File(png, "image/png");
    }

    /// <summary>
    /// Upload / replace the per-car body wrap PNG. Accepts the raw
    /// image bytes in the request body (`Content-Type: image/png`).
    /// We validate the PNG magic header so we don't store random
    /// garbage that would later fail to decode in three.js.
    /// </summary>
    private static async Task<IResult> SaveShowroomWrap(
        int carId, HttpRequest request, AppDbContext db)
    {
        using var ms = new MemoryStream();
        await request.Body.CopyToAsync(ms);
        var raw = ms.ToArray();

        if (raw.Length == 0)
            return Results.BadRequest(new { error = "Empty body" });

        if (raw.Length > MaxWrapBytes)
            return Results.BadRequest(new
            {
                error = $"Wrap exceeds {MaxWrapBytes / 1024} KB limit",
            });

        // PNG magic header — 89 50 4E 47 0D 0A 1A 0A. We refuse JPEG
        // / WebP / GIF on purpose: the renderer applies the wrap as
        // an sRGB baseColorTexture and we want a predictable lossless
        // format (Tesla's own configurator is PNG-only too).
        if (raw.Length < 8
            || raw[0] != 0x89 || raw[1] != 0x50 || raw[2] != 0x4E || raw[3] != 0x47
            || raw[4] != 0x0D || raw[5] != 0x0A || raw[6] != 0x1A || raw[7] != 0x0A)
        {
            return Results.BadRequest(new { error = "File is not a valid PNG" });
        }

        var row = await db.CarShowroomConfigs.FirstOrDefaultAsync(c => c.CarId == carId);
        if (row == null)
        {
            // Create a config row alongside the wrap — the row's
            // ConfigJson stays "{}" if the user hasn't touched any
            // slider yet, which is the documented "no override" shape.
            db.CarShowroomConfigs.Add(new CarShowroomConfig
            {
                CarId = carId,
                ConfigJson = "{}",
                WrapPng = raw,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            row.WrapPng = raw;
            row.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return Results.Ok(new
        {
            success = true,
            bytes = raw.Length,
            updatedAt = DateTime.UtcNow,
        });
    }

    /// <summary>
    /// Remove the wrap PNG for a car (reset to plain paint). We DO
    /// keep the rest of the showroom config — only the wrap column
    /// is nulled out.
    /// </summary>
    private static async Task<IResult> DeleteShowroomWrap(int carId, AppDbContext db)
    {
        var row = await db.CarShowroomConfigs.FirstOrDefaultAsync(c => c.CarId == carId);
        if (row != null && row.WrapPng != null)
        {
            row.WrapPng = null;
            row.UpdatedAt = DateTime.UtcNow;
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
    /// <summary>
    /// True when a custom body wrap PNG has been uploaded for this
    /// car. The PNG itself is served on a separate endpoint
    /// (`/vehicle/{carId}/showroom/wrap`) to keep this response small.
    /// </summary>
    public bool WrapExists { get; init; }
}
