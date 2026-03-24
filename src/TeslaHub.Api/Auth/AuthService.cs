using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Auth;

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly string _jwtSecret;
    private readonly int _sessionDays;

    public AuthService(AppDbContext db, IConfiguration config)
    {
        _db = db;
        _jwtSecret = config["TESLAHUB_JWT_SECRET"]
            ?? config["JwtSecret"]
            ?? throw new InvalidOperationException("JWT secret is not configured");
        _sessionDays = int.TryParse(config["TESLAHUB_SESSION_DAYS"], out var days) ? days : 30;
    }

    public async Task EnsureAdminUserAsync(string username, string password)
    {
        if (await _db.Users.AnyAsync())
            return;

        var user = new AppUser
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password)
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();
    }

    public async Task<TokenResult?> LoginAsync(string username, string password)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user == null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            return null;

        return GenerateTokens(user);
    }

    public TokenResult? RefreshToken(string refreshToken)
    {
        var principal = ValidateToken(refreshToken, validateLifetime: true);
        if (principal == null)
            return null;

        var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var username = principal.FindFirstValue(ClaimTypes.Name)!;

        return GenerateTokens(new AppUser { Id = userId, Username = username });
    }

    public ClaimsPrincipal? ValidateToken(string token, bool validateLifetime = true)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret));
        var handler = new JwtSecurityTokenHandler();

        try
        {
            return handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = validateLifetime,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out _);
        }
        catch
        {
            return null;
        }
    }

    private TokenResult GenerateTokens(AppUser user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username)
        };

        var accessToken = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: credentials
        );

        var refreshToken = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddDays(_sessionDays),
            signingCredentials: credentials
        );

        var handler = new JwtSecurityTokenHandler();

        return new TokenResult
        {
            AccessToken = handler.WriteToken(accessToken),
            RefreshToken = handler.WriteToken(refreshToken),
            ExpiresIn = 900,
            RefreshExpiresInDays = _sessionDays
        };
    }
}

public record TokenResult
{
    public string AccessToken { get; init; } = string.Empty;
    public string RefreshToken { get; init; } = string.Empty;
    public int ExpiresIn { get; init; }
    public int RefreshExpiresInDays { get; init; }
}

public record LoginRequest
{
    public string Username { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

public record RefreshRequest
{
    public string RefreshToken { get; init; } = string.Empty;
}
