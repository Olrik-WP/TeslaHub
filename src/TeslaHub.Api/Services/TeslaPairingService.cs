using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Orchestrates the full Tesla third-party pairing workflow:
///   1. Generate / persist the EC P-256 keypair for this domain.
///   2. Register the domain as a Tesla "partner account".
///   3. Discover the connected user's vehicles.
///   4. Track per-vehicle pairing state once the user approves the
///      virtual-key request from the Tesla mobile app.
///
/// All Fleet API calls go through TeslaFleetApiClient.
/// </summary>
public sealed class TeslaPairingService
{
    private readonly AppDbContext _db;
    private readonly TeslaKeyService _keys;
    private readonly TeslaOAuthService _oauth;
    private readonly TeslaFleetApiClient _fleet;
    private readonly ILogger<TeslaPairingService> _logger;

    public TeslaPairingService(
        AppDbContext db,
        TeslaKeyService keys,
        TeslaOAuthService oauth,
        TeslaFleetApiClient fleet,
        ILogger<TeslaPairingService> logger)
    {
        _db = db;
        _keys = keys;
        _oauth = oauth;
        _fleet = fleet;
        _logger = logger;
    }

    public async Task<TeslaPairingStatusDto> GetStatusAsync(CancellationToken cancellationToken)
    {
        var keypair = await _keys.GetCurrentAsync(cancellationToken);
        // Multi-account aware: we include the owning account's email
        // on each vehicle so the wizard can group Kitt (owner A) and
        // Nyx (owner B) under their respective Tesla identities.
        var vehicles = await _db.Set<TeslaVehicle>()
            .Include(v => v.TeslaAccount)
            .OrderBy(v => v.DisplayName ?? v.Vin)
            .ToListAsync(cancellationToken);

        return new TeslaPairingStatusDto
        {
            KeyGenerated = keypair is not null,
            Domain = keypair?.Domain,
            PublicKeyUrl = keypair is null ? null : TeslaKeyService.PublicKeyUrl(keypair.Domain),
            PartnerRegistered = keypair?.PartnerRegistered ?? false,
            PartnerRegisteredAt = keypair?.PartnerRegisteredAt,
            PartnerRegistrationError = keypair?.PartnerRegistrationError,
            PairingUrl = keypair is null ? null : TeslaKeyService.PairingUrl(keypair.Domain),
            Vehicles = vehicles.Select(v => new TeslaVehicleDto
            {
                Id = v.Id,
                Vin = v.Vin,
                DisplayName = v.DisplayName,
                Model = v.Model,
                TelemetryConfigured = v.TelemetryConfigured,
                KeyPaired = v.KeyPaired,
                AccountId = v.TeslaAccountId,
                AccountEmail = v.TeslaAccount?.Email,
            }).ToArray(),
        };
    }

    public Task<TeslaKeyPair> GenerateKeypairAsync(string domain, CancellationToken cancellationToken) =>
        _keys.GenerateAsync(domain, cancellationToken);

    public async Task<PartnerRegistrationResult> RegisterPartnerDomainAsync(CancellationToken cancellationToken)
    {
        var keypair = await _keys.GetCurrentAsync(cancellationToken)
            ?? throw new InvalidOperationException("No keypair generated yet. Generate the public key first.");

        var account = await _oauth.GetCurrentAccountAsync(cancellationToken)
            ?? throw new InvalidOperationException("No Tesla account connected. Connect via OAuth first.");

        var result = await _fleet.RegisterPartnerDomainAsync(account, keypair.Domain, cancellationToken);

        keypair.PartnerRegistered = result.Success;
        keypair.PartnerRegisteredAt = result.Success ? DateTime.UtcNow : keypair.PartnerRegisteredAt;
        keypair.PartnerRegistrationError = result.Success ? null : result.Error;
        await _db.SaveChangesAsync(cancellationToken);

        return result;
    }

    public async Task<int> SyncVehiclesAsync(CancellationToken cancellationToken)
    {
        // Sync every connected Tesla account. Each account sees its own
        // list of vehicles (owner + driver-shared) and we persist one
        // TeslaVehicle row per (AccountId, Vin). The unique index in
        // AppDbContext prevents duplicates per account while allowing
        // the same VIN to legitimately exist under two accounts (e.g.
        // a car the partner owns + shares with you as Driver).
        var accounts = await _db.Set<TeslaAccount>().ToListAsync(cancellationToken);
        if (accounts.Count == 0)
            throw new InvalidOperationException("No Tesla account connected.");

        var totalSynced = 0;
        foreach (var account in accounts)
        {
            try
            {
                // EnsureValidAccessTokenAsync refreshes the token if it is
                // about to expire. We call it per-account so a stale
                // second account doesn't poison the first one's sync.
                var live = await _oauth.EnsureValidAccessTokenAsync(account, cancellationToken);
                var fresh = await _fleet.ListVehiclesAsync(live, cancellationToken);
                var existing = await _db.Set<TeslaVehicle>()
                    .Where(v => v.TeslaAccountId == live.Id)
                    .ToListAsync(cancellationToken);

                foreach (var fv in fresh)
                {
                    var existingMatch = existing.FirstOrDefault(e => e.Vin == fv.Vin);
                    if (existingMatch is null)
                    {
                        _db.Set<TeslaVehicle>().Add(fv);
                    }
                    else
                    {
                        existingMatch.DisplayName = fv.DisplayName;
                        existingMatch.Model = fv.Model;
                        existingMatch.TeslaVehicleId = fv.TeslaVehicleId;
                        existingMatch.UpdatedAt = DateTime.UtcNow;
                    }
                }

                var freshVins = fresh.Select(v => v.Vin).ToHashSet();
                var stale = existing.Where(e => !freshVins.Contains(e.Vin)).ToList();
                if (stale.Count > 0)
                    _db.Set<TeslaVehicle>().RemoveRange(stale);

                await _db.SaveChangesAsync(cancellationToken);
                _logger.LogInformation(
                    "Synced {Count} Tesla vehicle(s) for account {AccountId} ({Email}).",
                    fresh.Count, live.Id, live.Email);
                totalSynced += fresh.Count;
            }
            catch (Exception ex)
            {
                // Don't fail the whole sync because one account's token
                // expired or Tesla hiccupped for that identity — surface
                // the warning and keep processing the other accounts.
                _logger.LogWarning(ex,
                    "Tesla vehicle sync failed for account {AccountId} ({Email}) — continuing with the other accounts.",
                    account.Id, account.Email);
            }
        }

        return totalSynced;
    }

    public async Task<TelemetryConfigResult> ConfigureTelemetryAsync(
        IConfiguration config,
        IEnumerable<int> vehicleIds,
        CancellationToken cancellationToken)
    {
        var hostname = config["TELEMETRY_DOMAIN"];
        if (string.IsNullOrWhiteSpace(hostname))
            throw new InvalidOperationException("TELEMETRY_DOMAIN env var is not set.");

        var port = int.TryParse(config["TELEMETRY_PORT"], out var p) ? p : 8443;

        // Tesla expects the CA chain that signed our telemetry TLS server
        // certificate. Caddy already stores the cert + intermediate chain
        // it obtained from Let's Encrypt at:
        //   /certs/<domain>/<domain>.crt
        var caPath = config["TELEMETRY_CA_PATH"] ?? $"/certs/{hostname}/{hostname}.crt";
        if (!File.Exists(caPath))
            throw new InvalidOperationException(
                $"Telemetry TLS certificate not found at {caPath}. " +
                $"Make sure {hostname} is set up in Caddy and the cert directory is mounted into teslahub-api.");
        var ca = await File.ReadAllTextAsync(caPath, cancellationToken);
        if (string.IsNullOrWhiteSpace(ca))
            throw new InvalidOperationException($"Telemetry TLS certificate at {caPath} is empty.");

        var ids = vehicleIds.ToHashSet();
        // Multi-account: fetch ALL requested vehicles regardless of which
        // Tesla account they belong to. We group them by account and call
        // fleet_telemetry_config once per account so each request is
        // signed with the token of the vehicle's actual owner (which is
        // mandatory — Tesla rejects telemetry config signed by a Driver).
        var vehicles = await _db.Set<TeslaVehicle>()
            .Include(v => v.TeslaAccount)
            .Where(v => ids.Contains(v.Id))
            .ToListAsync(cancellationToken);

        if (vehicles.Count == 0)
            throw new InvalidOperationException("No matching paired vehicles to configure.");

        var fields = new Dictionary<string, TelemetryField>
        {
            ["SentryMode"] = new TelemetryField(30),
            ["VehicleSpeed"] = new TelemetryField(10),
            ["Locked"] = new TelemetryField(60),
            ["DoorState"] = new TelemetryField(30),
        };

        var byAccount = vehicles
            .Where(v => v.TeslaAccount is not null)
            .GroupBy(v => v.TeslaAccountId);

        var succeeded = new List<TeslaVehicle>();
        var errors = new List<string>();

        foreach (var group in byAccount)
        {
            var account = group.First().TeslaAccount!;
            var live = await _oauth.EnsureValidAccessTokenAsync(account, cancellationToken);
            var request = new TelemetryConfigRequest(
                group.Select(v => v.Vin).ToArray(),
                hostname,
                port,
                ca,
                fields);

            var result = await _fleet.CreateTelemetryConfigAsync(live, request, cancellationToken);
            if (result.Success)
            {
                succeeded.AddRange(group);
            }
            else
            {
                errors.Add($"{live.Email ?? $"account {live.Id}"}: {result.Error}");
                _logger.LogWarning(
                    "Telemetry config failed for account {AccountId} ({Email}): {Error}",
                    live.Id, live.Email, result.Error);
            }
        }

        foreach (var v in succeeded)
        {
            v.TelemetryConfigured = true;
            v.UpdatedAt = DateTime.UtcNow;
        }
        if (succeeded.Count > 0)
            await _db.SaveChangesAsync(cancellationToken);

        if (errors.Count == 0)
            return new TelemetryConfigResult(true, null);

        // Partial success is possible on multi-account installs — report
        // which accounts failed but still mark the ones that worked.
        return new TelemetryConfigResult(
            succeeded.Count > 0,
            string.Join("; ", errors));
    }

    public async Task<bool> MarkVehiclePairedAsync(int vehicleId, bool paired, CancellationToken cancellationToken)
    {
        var vehicle = await _db.Set<TeslaVehicle>().FirstOrDefaultAsync(v => v.Id == vehicleId, cancellationToken);
        if (vehicle is null)
            return false;

        vehicle.KeyPaired = paired;
        vehicle.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
