using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;
using TeslaHub.Api.Services;
using TeslaHub.Api.TeslaMate;

namespace TeslaHub.Api.Endpoints;

public static class VehicleImageEndpoints
{
    private const int MaxUploadBytes = 2 * 1024 * 1024;

    public static void MapVehicleImageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/vehicle").RequireAuthorization();

        group.MapGet("/{carId:int}/image", GetImage).AllowAnonymous();
        group.MapGet("/{carId:int}/image/info", GetImageInfo);
        group.MapPut("/{carId:int}/image/compositor", SaveCompositorImage);
        group.MapPost("/{carId:int}/image/upload", UploadCustomImage);
        group.MapDelete("/{carId:int}/image", DeleteImage);
    }

    private static async Task<IResult> GetImage(
        int carId, AppDbContext db, TeslaMateConnectionFactory tm,
        IHttpClientFactory httpFactory, CompositorService compositor)
    {
        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);

        if (img != null && img.ImageData.Length > 0)
            return Results.File(img.ImageData, img.ContentType);

        var autoBytes = await TryAutoGenerate(carId, db, tm, httpFactory, compositor);
        if (autoBytes != null)
            return Results.File(autoBytes, "image/jpeg");

        return Results.NotFound();
    }

    private static async Task<IResult> GetImageInfo(int carId, AppDbContext db)
    {
        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);
        return Results.Ok(new
        {
            paintCode = img?.PaintCode,
            wheelCode = img?.WheelCode,
            isCustomUpload = img?.IsCustomUpload ?? false,
            hasImage = img?.ImageData.Length > 0,
        });
    }

    private static async Task<IResult> SaveCompositorImage(
        int carId, AppearanceDto dto, AppDbContext db,
        IHttpClientFactory httpFactory, CompositorService compositor)
    {
        var url = compositor.BuildUrl(dto.ModelCode, dto.PaintCode, dto.WheelCode);

        var client = httpFactory.CreateClient("tesla");
        byte[] imageBytes;
        try
        {
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
                return Results.Problem($"Tesla compositor returned {response.StatusCode}", statusCode: 502);
            imageBytes = await response.Content.ReadAsByteArrayAsync();
        }
        catch (Exception ex)
        {
            return Results.Problem($"Failed to download compositor image: {ex.Message}", statusCode: 502);
        }

        var contentType = "image/jpeg";
        if (imageBytes.Length > 4 && imageBytes[0] == 0x89 && imageBytes[1] == 0x50)
            contentType = "image/png";

        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);
        if (img != null)
        {
            img.PaintCode = dto.PaintCode;
            img.WheelCode = dto.WheelCode;
            img.IsCustomUpload = false;
            img.ImageData = imageBytes;
            img.ContentType = contentType;
            img.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            db.CarImages.Add(new CarImage
            {
                CarId = carId,
                PaintCode = dto.PaintCode,
                WheelCode = dto.WheelCode,
                IsCustomUpload = false,
                ImageData = imageBytes,
                ContentType = contentType,
                UpdatedAt = DateTime.UtcNow,
            });
        }

        await db.SaveChangesAsync();
        return Results.Ok(new { success = true });
    }

    private static async Task<IResult> UploadCustomImage(
        int carId, HttpRequest request, AppDbContext db)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest("Expected multipart form data");

        var form = await request.ReadFormAsync();
        var file = form.Files.FirstOrDefault();

        if (file == null || file.Length == 0)
            return Results.BadRequest("No file provided");

        if (file.Length > MaxUploadBytes)
            return Results.BadRequest("File exceeds 2 MB limit");

        if (!file.ContentType.StartsWith("image/"))
            return Results.BadRequest("Only image files are accepted");

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var imageBytes = ms.ToArray();

        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);
        if (img != null)
        {
            img.IsCustomUpload = true;
            img.ImageData = imageBytes;
            img.ContentType = file.ContentType;
            img.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            db.CarImages.Add(new CarImage
            {
                CarId = carId,
                IsCustomUpload = true,
                ImageData = imageBytes,
                ContentType = file.ContentType,
                UpdatedAt = DateTime.UtcNow,
            });
        }

        await db.SaveChangesAsync();
        return Results.Ok(new { success = true });
    }

    private static async Task<IResult> DeleteImage(int carId, AppDbContext db)
    {
        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);
        if (img != null)
        {
            db.CarImages.Remove(img);
            await db.SaveChangesAsync();
        }
        return Results.Ok(new { success = true });
    }

    private static async Task<byte[]?> TryAutoGenerate(
        int carId, AppDbContext db, TeslaMateConnectionFactory tm,
        IHttpClientFactory httpFactory, CompositorService compositor)
    {
        var vehicle = await tm.GetVehicleStatusAsync(carId);
        if (vehicle == null) return null;

        var url = compositor.TryBuildAutoUrl(vehicle.Model, vehicle.ExteriorColor, vehicle.WheelType);
        if (url == null) return null;

        try
        {
            var client = httpFactory.CreateClient("tesla");
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode) return null;

            var imageBytes = await response.Content.ReadAsByteArrayAsync();
            if (imageBytes.Length < 100) return null;

            var contentType = "image/jpeg";
            if (imageBytes.Length > 4 && imageBytes[0] == 0x89 && imageBytes[1] == 0x50)
                contentType = "image/png";

            db.CarImages.Add(new CarImage
            {
                CarId = carId,
                PaintCode = compositor.MapPaint(vehicle.ExteriorColor),
                WheelCode = compositor.MapWheel(vehicle.WheelType),
                IsCustomUpload = false,
                ImageData = imageBytes,
                ContentType = contentType,
                UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();

            return imageBytes;
        }
        catch
        {
            return null;
        }
    }
}

public record AppearanceDto
{
    public string ModelCode { get; init; } = "";
    public string PaintCode { get; init; } = "";
    public string WheelCode { get; init; } = "";
}
