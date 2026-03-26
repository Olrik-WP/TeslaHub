using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Endpoints;

public static class VehicleImageEndpoints
{
    private const int MaxUploadBytes = 5 * 1024 * 1024;

    public static void MapVehicleImageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/vehicle").RequireAuthorization();

        group.MapGet("/{carId:int}/image", GetImage).AllowAnonymous();
        group.MapGet("/{carId:int}/image/info", GetImageInfo);
        group.MapPut("/{carId:int}/image/compositor", SaveCompositorImage);
        group.MapPost("/{carId:int}/image/upload", UploadCustomImage);
        group.MapDelete("/{carId:int}/image", DeleteImage);
    }

    private static async Task<IResult> GetImage(int carId, AppDbContext db)
    {
        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);

        if (img != null && img.ImageData.Length > 0)
            return Results.File(img.ImageData, img.ContentType);

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
        int carId, CompositorUrlDto dto, AppDbContext db,
        IHttpClientFactory httpFactory)
    {
        if (string.IsNullOrWhiteSpace(dto.Url) ||
            !dto.Url.Contains("static-assets.tesla.com") ||
            !dto.Url.Contains("compositor"))
        {
            return Results.BadRequest("Invalid Tesla compositor URL");
        }

        var client = httpFactory.CreateClient("tesla");
        byte[] imageBytes;
        try
        {
            var response = await client.GetAsync(dto.Url);
            if (!response.IsSuccessStatusCode)
                return Results.Problem($"Tesla returned {response.StatusCode}", statusCode: 502);
            imageBytes = await response.Content.ReadAsByteArrayAsync();
            if (imageBytes.Length < 100)
                return Results.Problem("Downloaded image is too small", statusCode: 502);
        }
        catch (Exception ex)
        {
            return Results.Problem($"Failed to download image: {ex.Message}", statusCode: 502);
        }

        var contentType = "image/jpeg";
        if (imageBytes.Length > 4 && imageBytes[0] == 0x89 && imageBytes[1] == 0x50)
            contentType = "image/png";

        var img = await db.CarImages.FirstOrDefaultAsync(i => i.CarId == carId);
        if (img != null)
        {
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

}

public record CompositorUrlDto
{
    public string Url { get; init; } = "";
}
