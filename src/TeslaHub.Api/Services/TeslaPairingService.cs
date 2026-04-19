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
        var vehicles = await _db.Set<TeslaVehicle>()
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
        var account = await _oauth.GetCurrentAccountAsync(cancellationToken)
            ?? throw new InvalidOperationException("No Tesla account connected.");

        var fresh = await _fleet.ListVehiclesAsync(account, cancellationToken);
        var existing = await _db.Set<TeslaVehicle>()
            .Where(v => v.TeslaAccountId == account.Id)
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
        _logger.LogInformation("Synced {Count} Tesla vehicle(s) for account {AccountId}.", fresh.Count, account.Id);
        return fresh.Count;
    }

    public async Task<TelemetryConfigResult> ConfigureTelemetryAsync(
        IConfiguration config,
        IEnumerable<int> vehicleIds,
        CancellationToken cancellationToken)
    {
        var account = await _oauth.GetCurrentAccountAsync(cancellationToken)
            ?? throw new InvalidOperationException("No Tesla account connected.");

        var hostname = config["TELEMETRY_DOMAIN"];
        if (string.IsNullOrWhiteSpace(hostname))
            throw new InvalidOperationException("TELEMETRY_DOMAIN env var is not set.");

        var port = int.TryParse(config["TELEMETRY_PORT"], out var p) ? p : 8443;
        var caPath = config["TELEMETRY_CA_PATH"] ?? "/etc/teslahub/server-ca.crt";
        var ca = File.Exists(caPath) ? await File.ReadAllTextAsync(caPath, cancellationToken) : string.Empty;
        if (string.IsNullOrWhiteSpace(ca))
            throw new InvalidOperationException(
                $"Server CA file not found or empty at {caPath}. Place the Tesla server CA there before configuring telemetry.");

        var ids = vehicleIds.ToHashSet();
        var vehicles = await _db.Set<TeslaVehicle>()
            .Where(v => v.TeslaAccountId == account.Id && ids.Contains(v.Id))
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

        var request = new TelemetryConfigRequest(
            vehicles.Select(v => v.Vin).ToArray(),
            hostname,
            port,
            ca,
            fields);

        var result = await _fleet.CreateTelemetryConfigAsync(account, request, cancellationToken);

        if (result.Success)
        {
            foreach (var v in vehicles)
            {
                v.TelemetryConfigured = true;
                v.UpdatedAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync(cancellationToken);
        }

        return result;
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
