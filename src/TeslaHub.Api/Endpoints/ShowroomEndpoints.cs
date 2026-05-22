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

        // ─── Custom wraps ────────────────────────────────────────
        //
        // The READ sides are intentionally anonymous: three.js loads
        // the texture via a plain `<img>` element which doesn't
        // forward the JWT bearer token (it only sends cookies, but
        // our auth pipeline expects the bearer). Switching to a
        // fetch + blob round-trip would add complexity for no real
        // benefit — the PNG is a per-car visual chrome, not
        // sensitive data. The WRITE / DELETE sides keep auth so
        // only the owner can mutate the wrap library.
        //
        // Multi-wraps endpoints (preferred):
        //   GET  /wraps          → list all uploads (no blobs)
        //   POST /wraps?name=…   → add a new upload (returns id)
        //   GET  /wraps/{wrapId} → stream the PNG (anonymous)
        //   DELETE /wraps/{wrapId} → delete one upload
        //   DELETE /wraps          → delete ALL uploads for the car
        //
        // Legacy single-wrap endpoints (kept for backwards-compat
        // with older bundles still in browser cache — they now
        // alias the most-recent upload):
        //   GET  /wrap           → stream the most-recent PNG
        //   PUT  /wrap           → upload a new wrap (named "Uploaded wrap")
        //   DELETE /wrap         → delete ALL uploads
        group.MapGet("/{carId:int}/showroom/wraps", ListShowroomWraps)
             .AllowAnonymous();
        group.MapPost("/{carId:int}/showroom/wraps", AddShowroomWrap)
             .DisableAntiforgery();
        group.MapGet("/{carId:int}/showroom/wraps/{wrapId:int}", GetShowroomWrapById)
             .AllowAnonymous();
        group.MapDelete("/{carId:int}/showroom/wraps/{wrapId:int}", DeleteShowroomWrapById);
        group.MapDelete("/{carId:int}/showroom/wraps", DeleteAllShowroomWraps);

        group.MapGet("/{carId:int}/showroom/wrap", GetShowroomWrapLegacy)
             .AllowAnonymous();
        group.MapPut("/{carId:int}/showroom/wrap", SaveShowroomWrapLegacy)
             .DisableAntiforgery();
        group.MapDelete("/{carId:int}/showroom/wrap", DeleteAllShowroomWraps);
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
            })
            .FirstOrDefaultAsync();

        // Fetch the wrap LIBRARY in the same round-trip so the
        // Showroom gallery can render every previously-uploaded
        // wrap on first paint (no extra fetch). We deliberately do
        // not load the PNG bytes here — the renderer fetches each
        // PNG on demand from /wraps/{wrapId}.
        var wraps = await db.CarShowroomWraps
            .AsNoTracking()
            .Where(w => w.CarId == carId)
            .OrderByDescending(w => w.UploadedAt)
            .Select(w => new ShowroomWrapDto
            {
                Id = w.Id,
                Name = w.Name,
                SizeBytes = w.SizeBytes,
                UploadedAt = w.UploadedAt,
            })
            .ToListAsync();

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
                WrapExists = wraps.Count > 0,
                Wraps = wraps,
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
            WrapExists = wraps.Count > 0,
            Wraps = wraps,
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

    // ─── Custom wraps (multi-upload library) ─────────────────────

    /// <summary>
    /// List every uploaded wrap PNG for a car (metadata only — the
    /// PNG bytes are streamed from <see cref="GetShowroomWrapById"/>
    /// on demand). Sorted by most recent first so the gallery's
    /// "newest" tile is the one that just got dropped in.
    /// </summary>
    private static async Task<IResult> ListShowroomWraps(int carId, AppDbContext db)
    {
        var wraps = await db.CarShowroomWraps
            .AsNoTracking()
            .Where(w => w.CarId == carId)
            .OrderByDescending(w => w.UploadedAt)
            .Select(w => new ShowroomWrapDto
            {
                Id = w.Id,
                Name = w.Name,
                SizeBytes = w.SizeBytes,
                UploadedAt = w.UploadedAt,
            })
            .ToListAsync();
        return Results.Ok(wraps);
    }

    /// <summary>
    /// Add a new wrap PNG to the car's library. Accepts the raw
    /// image bytes in the body (`Content-Type: image/png`). The
    /// `name` query parameter is the user-displayable label (we
    /// sanitise / cap it server-side). Returns the freshly created
    /// row so the client can pin it as the active wrap.
    /// </summary>
    private static async Task<IResult> AddShowroomWrap(
        int carId, HttpRequest request, AppDbContext db, string? name)
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

        var safeName = SanitizeWrapName(name);
        var now = DateTime.UtcNow;
        var entity = new CarShowroomWrap
        {
            CarId = carId,
            Name = safeName,
            PngBytes = raw,
            SizeBytes = raw.Length,
            UploadedAt = now,
        };
        db.CarShowroomWraps.Add(entity);
        await db.SaveChangesAsync();

        return Results.Ok(new ShowroomWrapDto
        {
            Id = entity.Id,
            Name = entity.Name,
            SizeBytes = entity.SizeBytes,
            UploadedAt = entity.UploadedAt,
        });
    }

    /// <summary>
    /// Stream a single wrap PNG by its database id. The id is
    /// embedded in the renderer URL so cache busting works
    /// naturally (a deleted wrap returns 404 and the client falls
    /// back to plain paint).
    /// </summary>
    private static async Task<IResult> GetShowroomWrapById(
        int carId, int wrapId, AppDbContext db)
    {
        var png = await db.CarShowroomWraps
            .AsNoTracking()
            .Where(w => w.CarId == carId && w.Id == wrapId)
            .Select(w => w.PngBytes)
            .FirstOrDefaultAsync();

        if (png == null || png.Length == 0)
            return Results.NotFound();

        return Results.File(png, "image/png");
    }

    /// <summary>
    /// Delete a single wrap from the library. The Showroom config
    /// row stays untouched (the user may still have non-wrap
    /// tweaks saved).
    /// </summary>
    private static async Task<IResult> DeleteShowroomWrapById(
        int carId, int wrapId, AppDbContext db)
    {
        var row = await db.CarShowroomWraps
            .FirstOrDefaultAsync(w => w.CarId == carId && w.Id == wrapId);
        if (row != null)
        {
            db.CarShowroomWraps.Remove(row);
            await db.SaveChangesAsync();
        }
        return Results.Ok(new { success = true });
    }

    /// <summary>
    /// Drop the WHOLE wrap library for a car. The Showroom config
    /// row stays around (only the bound wraps are removed).
    /// Returns 200 even when the library was already empty so the
    /// frontend's "reset" button is idempotent.
    /// </summary>
    private static async Task<IResult> DeleteAllShowroomWraps(int carId, AppDbContext db)
    {
        var rows = await db.CarShowroomWraps
            .Where(w => w.CarId == carId)
            .ToListAsync();
        if (rows.Count > 0)
        {
            db.CarShowroomWraps.RemoveRange(rows);
            await db.SaveChangesAsync();
        }
        return Results.Ok(new { success = true });
    }

    // ─── Legacy single-wrap endpoints (backwards-compat) ─────────
    //
    // Old frontend bundles still in browser cache (or third-party
    // clients) call /wrap (no plural). We alias those to the new
    // library so they keep working until everyone has refreshed.

    /// <summary>
    /// Legacy GET — streams the MOST RECENT uploaded wrap so old
    /// bundles still see something when they hit /wrap with no id.
    /// </summary>
    private static async Task<IResult> GetShowroomWrapLegacy(int carId, AppDbContext db)
    {
        var png = await db.CarShowroomWraps
            .AsNoTracking()
            .Where(w => w.CarId == carId)
            .OrderByDescending(w => w.UploadedAt)
            .Select(w => w.PngBytes)
            .FirstOrDefaultAsync();

        if (png == null || png.Length == 0)
            return Results.NotFound();

        return Results.File(png, "image/png");
    }

    /// <summary>
    /// Legacy PUT — adds the upload to the new library under a
    /// default name. Old bundles will then re-render with their
    /// upload still visible.
    /// </summary>
    private static async Task<IResult> SaveShowroomWrapLegacy(
        int carId, HttpRequest request, AppDbContext db)
    {
        return await AddShowroomWrap(carId, request, db, name: "Uploaded wrap");
    }

    /// <summary>
    /// Strip path separators and exotic characters from the user-
    /// supplied wrap name, fall back to "wrap", and cap at 80 chars
    /// so the column constraint is never violated.
    /// </summary>
    private static string SanitizeWrapName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return "wrap";

        var trimmed = raw.Trim();
        var sb = new System.Text.StringBuilder(trimmed.Length);
        foreach (var ch in trimmed)
        {
            if (char.IsLetterOrDigit(ch)
                || ch == ' ' || ch == '-' || ch == '_' || ch == '.'
                || ch == '(' || ch == ')')
            {
                sb.Append(ch);
            }
        }

        var cleaned = sb.ToString().Trim();
        if (string.IsNullOrEmpty(cleaned))
            return "wrap";

        return cleaned.Length <= 80 ? cleaned : cleaned[..80];
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
    /// True as soon as <see cref="Wraps"/> has at least one entry.
    /// Kept around for older bundles still in browser cache that
    /// only inspect this boolean before showing the upload widget.
    /// </summary>
    public bool WrapExists { get; init; }
    /// <summary>
    /// Library of every wrap PNG the user has uploaded for this car,
    /// most-recent first. The bytes are NOT included here — the
    /// renderer fetches each PNG from /wraps/{id} on demand.
    /// </summary>
    public IReadOnlyList<ShowroomWrapDto> Wraps { get; init; } =
        Array.Empty<ShowroomWrapDto>();
}

/// <summary>
/// One entry in a car's wrap library — metadata only.
/// </summary>
public record ShowroomWrapDto
{
    public int Id { get; init; }
    public string Name { get; init; } = "wrap";
    public int SizeBytes { get; init; }
    public DateTime UploadedAt { get; init; }
}
