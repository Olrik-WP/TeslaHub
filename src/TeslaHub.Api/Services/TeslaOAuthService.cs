// ─────────────────────────────────────────────────────────────────────────────
// TeslaOAuthService — Tesla Fleet API OAuth 2.0 client.
//
// Architecture inspired by SentryGuard's TeslaOAuthService
// (https://github.com/abarghoud/SentryGuard, AGPL-3.0).
// Reimplemented from scratch in C# for TeslaHub. Behavior follows the
// Tesla Fleet API public documentation.
// ─────────────────────────────────────────────────────────────────────────────

using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

public sealed class TeslaOAuthService
{
    // Tesla OAuth endpoints are region-specific (global vs China) and now
    // come from TeslaOAuthOptions (driven by TESLA_REGION). See the region
    // presets in TeslaOAuthOptions below.
    private const string StateTokenAudience = "teslahub:tesla-oauth-state";
    private const int StateValidityMinutes = 10;

    private readonly AppDbContext _db;
    private readonly TeslaTokenEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<TeslaOAuthService> _logger;
    private readonly TeslaOAuthOptions _options;

    public TeslaOAuthService(
        AppDbContext db,
        TeslaTokenEncryptionService encryption,
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger<TeslaOAuthService> logger)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _logger = logger;
        _options = TeslaOAuthOptions.FromConfiguration(configuration);
    }

    public TeslaOAuthOptions Options => _options;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_options.ClientId) &&
        !string.IsNullOrWhiteSpace(_options.ClientSecret) &&
        !string.IsNullOrWhiteSpace(_options.RedirectUri);

    public TeslaOAuthLoginDto BuildLoginRequest(string? userLocale)
    {
        EnsureConfigured();

        var locale = NormalizeLocale(userLocale);
        var state = CreateSignedState(locale);

        var query = new Dictionary<string, string>
        {
            ["client_id"] = _options.ClientId,
            ["locale"] = locale,
            ["prompt"] = "login",
            ["redirect_uri"] = _options.RedirectUri,
            ["response_type"] = "code",
            ["scope"] = _options.Scopes,
            ["state"] = state,
        };

        var url = _options.AuthorizeUrl + "?" + string.Join("&",
            query.Select(kvp => $"{Uri.EscapeDataString(kvp.Key)}={Uri.EscapeDataString(kvp.Value)}"));

        return new TeslaOAuthLoginDto { AuthorizeUrl = url, State = state };
    }

    public async Task<TeslaAccount> AuthenticateWithCodeAsync(string code, string state, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        ValidateSignedState(state);

        var tokens = await ExchangeCodeForTokensAsync(code, cancellationToken);
        var profile = ExtractProfileFromIdToken(tokens) ?? new TeslaProfile();

        var account = await UpsertAccountAsync(tokens, profile, cancellationToken);
        return account;
    }

    public async Task<TeslaAccount?> RefreshTokensAsync(int accountId, CancellationToken cancellationToken = default)
    {
        var account = await _db.Set<TeslaAccount>().FirstOrDefaultAsync(a => a.Id == accountId, cancellationToken);
        if (account is null)
            return null;

        return await RefreshTokensInternalAsync(account, cancellationToken);
    }

    public async Task<TeslaAccount> EnsureValidAccessTokenAsync(TeslaAccount account, CancellationToken cancellationToken = default)
    {
        if (account.AccessTokenExpiresAt > DateTime.UtcNow.AddMinutes(2))
            return account;

        var refreshed = await RefreshTokensInternalAsync(account, cancellationToken);
        return refreshed ?? account;
    }

    public string DecryptAccessToken(TeslaAccount account) => _encryption.Decrypt(account.EncryptedAccessToken);

    // Partner tokens are obtained through client_credentials (machine-to-machine).
    // They are required for partner_accounts register/unregister/public_key endpoints,
    // which user tokens are NOT allowed to call. We cache the token in-memory until
    // ~60s before expiry to avoid hammering the token endpoint.
    private string? _cachedPartnerToken;
    private DateTime _cachedPartnerTokenExpiresAt = DateTime.MinValue;
    private readonly SemaphoreSlim _partnerTokenLock = new(1, 1);

    public async Task<string> GetPartnerAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        if (_cachedPartnerToken is not null && DateTime.UtcNow < _cachedPartnerTokenExpiresAt.AddSeconds(-60))
            return _cachedPartnerToken;

        await _partnerTokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_cachedPartnerToken is not null && DateTime.UtcNow < _cachedPartnerTokenExpiresAt.AddSeconds(-60))
                return _cachedPartnerToken;

            var tokens = await CallTokenEndpointAsync(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = _options.ClientId,
                ["client_secret"] = _options.ClientSecret,
                ["scope"] = _options.Scopes,
                ["audience"] = _options.Audience,
            }, cancellationToken);

            _cachedPartnerToken = tokens.AccessToken;
            _cachedPartnerTokenExpiresAt = DateTime.UtcNow.AddSeconds(tokens.ExpiresIn);
            _logger.LogInformation("Obtained Tesla partner token, expires at {ExpiresAt}", _cachedPartnerTokenExpiresAt);
            return _cachedPartnerToken;
        }
        finally
        {
            _partnerTokenLock.Release();
        }
    }

    public async Task<bool> DisconnectAsync(int accountId, CancellationToken cancellationToken = default)
    {
        var account = await _db.Set<TeslaAccount>().FirstOrDefaultAsync(a => a.Id == accountId, cancellationToken);
        if (account is null)
            return false;

        var vehicles = await _db.Set<TeslaVehicle>().Where(v => v.TeslaAccountId == accountId).ToListAsync(cancellationToken);
        if (vehicles.Count > 0)
            _db.Set<TeslaVehicle>().RemoveRange(vehicles);

        _db.Set<TeslaAccount>().Remove(account);
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public Task<TeslaAccount?> GetCurrentAccountAsync(CancellationToken cancellationToken = default) =>
        _db.Set<TeslaAccount>()
            .OrderByDescending(a => a.UpdatedAt)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<TeslaOAuthStatusDto> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
            return new TeslaOAuthStatusDto { Configured = false, Connected = false };

        var accounts = await _db.Set<TeslaAccount>()
            .OrderByDescending(a => a.UpdatedAt)
            .ToListAsync(cancellationToken);

        if (accounts.Count == 0)
            return new TeslaOAuthStatusDto { Configured = true, Connected = false, Accounts = [] };

        // Legacy top-level fields still describe the most recent account so
        // pre-multi-account clients keep working. The new Accounts array
        // carries the full list; new clients read it to show every linked
        // Tesla identity (e.g. couple sharing one TeslaHub instance).
        var primary = accounts[0];
        var vehicleCountByAccount = await _db.Set<TeslaVehicle>()
            .GroupBy(v => v.TeslaAccountId)
            .Select(g => new { AccountId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var byId = vehicleCountByAccount.ToDictionary(x => x.AccountId, x => x.Count);

        return new TeslaOAuthStatusDto
        {
            Configured = true,
            Connected = true,
            Email = primary.Email,
            FullName = primary.FullName,
            ConnectedAt = primary.CreatedAt,
            AccessTokenExpiresAt = primary.AccessTokenExpiresAt,
            LastRefreshAt = primary.LastRefreshAt,
            RefreshFailureCount = primary.RefreshFailureCount,
            LastRefreshError = primary.LastRefreshError,
            Scopes = (primary.Scopes ?? string.Empty)
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            VehicleCount = byId.TryGetValue(primary.Id, out var cnt) ? cnt : 0,
            Accounts = accounts.Select(a => new TeslaAccountSummaryDto
            {
                Id = a.Id,
                Email = a.Email,
                FullName = a.FullName,
                ConnectedAt = a.CreatedAt,
                AccessTokenExpiresAt = a.AccessTokenExpiresAt,
                LastRefreshAt = a.LastRefreshAt,
                RefreshFailureCount = a.RefreshFailureCount,
                LastRefreshError = a.LastRefreshError,
                VehicleCount = byId.TryGetValue(a.Id, out var c) ? c : 0,
            }).ToArray(),
        };
    }

    /// <summary>
    /// Lists every connected Tesla account (for the Settings page
    /// multi-account management UI). Never returns the secret fields —
    /// the caller is trusted to be an authenticated TeslaHub admin.
    /// </summary>
    public async Task<List<TeslaAccountSummaryDto>> ListAccountsAsync(CancellationToken cancellationToken = default)
    {
        var accounts = await _db.Set<TeslaAccount>()
            .OrderByDescending(a => a.UpdatedAt)
            .ToListAsync(cancellationToken);

        var vehicleCountByAccount = await _db.Set<TeslaVehicle>()
            .GroupBy(v => v.TeslaAccountId)
            .Select(g => new { AccountId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AccountId, x => x.Count, cancellationToken);

        return accounts.Select(a => new TeslaAccountSummaryDto
        {
            Id = a.Id,
            Email = a.Email,
            FullName = a.FullName,
            ConnectedAt = a.CreatedAt,
            AccessTokenExpiresAt = a.AccessTokenExpiresAt,
            LastRefreshAt = a.LastRefreshAt,
            RefreshFailureCount = a.RefreshFailureCount,
            LastRefreshError = a.LastRefreshError,
            VehicleCount = vehicleCountByAccount.TryGetValue(a.Id, out var c) ? c : 0,
        }).ToList();
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private async Task<TeslaAccount?> RefreshTokensInternalAsync(TeslaAccount account, CancellationToken cancellationToken)
    {
        try
        {
            var refreshToken = _encryption.Decrypt(account.EncryptedRefreshToken);
            var tokens = await CallTokenEndpointAsync(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = _options.ClientId,
                ["client_secret"] = _options.ClientSecret,
                ["refresh_token"] = refreshToken,
            }, cancellationToken);

            account.EncryptedAccessToken = _encryption.Encrypt(tokens.AccessToken);
            if (!string.IsNullOrEmpty(tokens.RefreshToken))
                account.EncryptedRefreshToken = _encryption.Encrypt(tokens.RefreshToken);
            account.AccessTokenExpiresAt = DateTime.UtcNow.AddSeconds(tokens.ExpiresIn);
            account.LastRefreshAt = DateTime.UtcNow;
            account.RefreshFailureCount = 0;
            account.LastRefreshError = null;
            account.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Refreshed Tesla tokens for account {AccountId}", account.Id);
            return account;
        }
        catch (Exception ex)
        {
            account.RefreshFailureCount += 1;
            account.LastRefreshError = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
            account.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);

            _logger.LogError(ex, "Failed to refresh Tesla tokens for account {AccountId}", account.Id);
            return null;
        }
    }

    private async Task<TeslaTokensResponse> ExchangeCodeForTokensAsync(string code, CancellationToken cancellationToken)
    {
        return await CallTokenEndpointAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["client_id"] = _options.ClientId,
            ["client_secret"] = _options.ClientSecret,
            ["code"] = code,
            ["audience"] = _options.Audience,
            ["redirect_uri"] = _options.RedirectUri,
        }, cancellationToken);
    }

    private async Task<TeslaTokensResponse> CallTokenEndpointAsync(IDictionary<string, string> form, CancellationToken cancellationToken)
    {
        var client = _httpFactory.CreateClient("tesla");
        using var request = new HttpRequestMessage(HttpMethod.Post, _options.TokenUrl)
        {
            Content = new FormUrlEncodedContent(form),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Tesla token endpoint returned {StatusCode}: {Body}", response.StatusCode, Truncate(body, 500));
            throw new InvalidOperationException($"Tesla token request failed ({(int)response.StatusCode}).");
        }

        var parsed = JsonSerializer.Deserialize<TeslaTokensResponse>(body, JsonOptions);
        if (parsed is null || string.IsNullOrEmpty(parsed.AccessToken))
            throw new InvalidOperationException("Tesla token response was empty or invalid.");

        return parsed;
    }

    private async Task<TeslaAccount> UpsertAccountAsync(TeslaTokensResponse tokens, TeslaProfile profile, CancellationToken cancellationToken)
    {
        var teslaUserId = string.IsNullOrEmpty(profile.Sub) ? Guid.NewGuid().ToString("N") : profile.Sub!;

        var account = await _db.Set<TeslaAccount>().FirstOrDefaultAsync(a => a.TeslaUserId == teslaUserId, cancellationToken);
        var now = DateTime.UtcNow;

        if (account is null)
        {
            account = new TeslaAccount
            {
                TeslaUserId = teslaUserId,
                CreatedAt = now,
            };
            _db.Set<TeslaAccount>().Add(account);
        }

        account.Email = profile.Email;
        account.FullName = profile.FullName;
        account.EncryptedAccessToken = _encryption.Encrypt(tokens.AccessToken);
        if (!string.IsNullOrEmpty(tokens.RefreshToken))
            account.EncryptedRefreshToken = _encryption.Encrypt(tokens.RefreshToken);
        account.AccessTokenExpiresAt = now.AddSeconds(tokens.ExpiresIn);
        account.Scopes = profile.Scopes ?? _options.Scopes;
        account.Audience = _options.Audience;
        account.UpdatedAt = now;
        account.LastRefreshAt = now;
        account.RefreshFailureCount = 0;
        account.LastRefreshError = null;

        await _db.SaveChangesAsync(cancellationToken);
        return account;
    }

    private TeslaProfile? ExtractProfileFromIdToken(TeslaTokensResponse tokens)
    {
        var jwt = tokens.IdToken;
        if (string.IsNullOrEmpty(jwt))
            jwt = tokens.AccessToken;

        try
        {
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(jwt))
                return null;

            var token = handler.ReadJwtToken(jwt);
            return new TeslaProfile
            {
                Sub = token.Claims.FirstOrDefault(c => c.Type == "sub")?.Value,
                Email = token.Claims.FirstOrDefault(c => c.Type == "email")?.Value,
                FullName = token.Claims.FirstOrDefault(c => c.Type == "name")?.Value
                    ?? token.Claims.FirstOrDefault(c => c.Type == "preferred_username")?.Value,
                Scopes = token.Claims.FirstOrDefault(c => c.Type == "scope")?.Value,
            };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not decode Tesla ID token, continuing without profile data.");
            return null;
        }
    }

    private string CreateSignedState(string locale)
    {
        var key = new SymmetricSecurityKey(GetStateKey());
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim("locale", locale),
            new Claim("nonce", Convert.ToHexString(RandomNumberGenerator.GetBytes(16))),
        };

        var token = new JwtSecurityToken(
            audience: StateTokenAudience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(StateValidityMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private void ValidateSignedState(string state)
    {
        if (string.IsNullOrEmpty(state))
            throw new InvalidOperationException("Missing OAuth state parameter.");

        var key = new SymmetricSecurityKey(GetStateKey());
        var handler = new JwtSecurityTokenHandler();

        try
        {
            handler.ValidateToken(state, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ValidateIssuer = false,
                ValidateAudience = true,
                ValidAudience = StateTokenAudience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(30),
            }, out _);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Invalid or expired OAuth state.", ex);
        }
    }

    private byte[] GetStateKey() =>
        SHA256.HashData(Encoding.UTF8.GetBytes("teslahub-tesla-oauth-state:" + _options.ClientSecret));

    private void EnsureConfigured()
    {
        if (!IsConfigured)
            throw new InvalidOperationException(
                "Tesla OAuth is not configured. Set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and TESLA_REDIRECT_URI.");
    }

    private static string NormalizeLocale(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
            return "en-US";
        var lower = locale.Trim().ToLowerInvariant();
        return lower switch
        {
            "fr" or "fr-fr" => "fr-FR",
            "en" or "en-us" => "en-US",
            _ => locale,
        };
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    // ── Internal records ─────────────────────────────────────────────────────

    private sealed class TeslaTokensResponse
    {
        [JsonPropertyName("access_token")] public string AccessToken { get; set; } = string.Empty;
        [JsonPropertyName("refresh_token")] public string RefreshToken { get; set; } = string.Empty;
        [JsonPropertyName("id_token")] public string? IdToken { get; set; }
        [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; } = 3600;
        [JsonPropertyName("token_type")] public string? TokenType { get; set; }
    }

    private sealed class TeslaProfile
    {
        public string? Sub { get; set; }
        public string? Email { get; set; }
        public string? FullName { get; set; }
        public string? Scopes { get; set; }
    }
}

public sealed class TeslaOAuthOptions
{
    // ── Region presets — official Tesla Fleet API endpoints ──────────────────
    // Global region (NA/EU/AP). Token exchange uses the dedicated
    // fleet-auth domain Tesla mandated for partners (announcement
    // 2025-07-21, migrating away from auth.tesla.com).
    //   Docs: https://developer.tesla.com/docs/fleet-api
    public const string GlobalAuthorizeUrl = "https://auth.tesla.com/oauth2/v3/authorize";
    public const string GlobalTokenUrl = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
    public const string GlobalAudience = "https://fleet-api.prd.eu.vn.cloud.tesla.com";

    // China region. Tesla runs a fully separate instance — a dedicated
    // developer account + app (created on developer.tesla.cn, requires a
    // +86 phone) is mandatory; NA/EU credentials are rejected here. China
    // has no fleet-auth domain: token exchange is on auth.tesla.cn directly.
    //   Docs: https://developer.tesla.cn/docs/fleet-api
    public const string ChinaAuthorizeUrl = "https://auth.tesla.cn/oauth2/v3/authorize";
    public const string ChinaTokenUrl = "https://auth.tesla.cn/oauth2/v3/token";
    public const string ChinaAudience = "https://fleet-api.prd.cn.vn.cloud.tesla.cn";

    private const string DefaultScopes = "openid offline_access vehicle_device_data vehicle_cmds";

    public string ClientId { get; init; } = string.Empty;
    public string ClientSecret { get; init; } = string.Empty;
    public string RedirectUri { get; init; } = string.Empty;
    /// <summary>Resolved region — "global" (default) or "china".</summary>
    public string Region { get; init; } = "global";
    public string AuthorizeUrl { get; init; } = GlobalAuthorizeUrl;
    public string TokenUrl { get; init; } = GlobalTokenUrl;
    public string Audience { get; init; } = GlobalAudience;
    public string Scopes { get; init; } = DefaultScopes;
    public bool SecurityAlertsEnabled { get; init; }

    public static TeslaOAuthOptions FromConfiguration(IConfiguration config)
    {
        // TESLA_REGION selects the endpoint preset. Default "global" keeps
        // the exact pre-existing behaviour for every current deployment;
        // "china"/"cn" switches authorize + token + audience to the .cn
        // instance. Each endpoint can still be overridden individually
        // (escape hatch for future regions / Tesla URL changes).
        var region = (config["TESLA_REGION"] ?? "global").Trim().ToLowerInvariant();
        var isChina = region is "china" or "cn";

        var authorizeDefault = isChina ? ChinaAuthorizeUrl : GlobalAuthorizeUrl;
        var tokenDefault = isChina ? ChinaTokenUrl : GlobalTokenUrl;
        var audienceDefault = isChina ? ChinaAudience : GlobalAudience;

        static string Pick(IConfiguration c, string key, string fallback) =>
            string.IsNullOrWhiteSpace(c[key]) ? fallback : c[key]!;

        return new TeslaOAuthOptions
        {
            ClientId = config["TESLA_CLIENT_ID"] ?? string.Empty,
            ClientSecret = config["TESLA_CLIENT_SECRET"] ?? string.Empty,
            RedirectUri = config["TESLA_REDIRECT_URI"] ?? string.Empty,
            Region = isChina ? "china" : "global",
            AuthorizeUrl = Pick(config, "TESLA_AUTHORIZE_URL", authorizeDefault),
            TokenUrl = Pick(config, "TESLA_TOKEN_URL", tokenDefault),
            Audience = Pick(config, "TESLA_AUDIENCE", audienceDefault),
            Scopes = Pick(config, "TESLA_SCOPES", DefaultScopes),
            SecurityAlertsEnabled = string.Equals(config["SECURITY_ALERTS_ENABLED"], "true", StringComparison.OrdinalIgnoreCase),
        };
    }
}
