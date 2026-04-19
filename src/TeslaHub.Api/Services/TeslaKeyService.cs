using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Data;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Services;

/// <summary>
/// Manages the EC P-256 keypair that identifies this TeslaHub instance to
/// the Tesla Fleet API. The private key is stored encrypted at rest;
/// the public key is exposed (in PEM, SubjectPublicKeyInfo format) at
/// /.well-known/appspecific/com.tesla.3p.public-key.pem so Tesla can
/// verify partner registration and per-vehicle pairing.
/// </summary>
public sealed class TeslaKeyService
{
    private const string WellKnownPath = "/.well-known/appspecific/com.tesla.3p.public-key.pem";

    private readonly AppDbContext _db;
    private readonly TeslaTokenEncryptionService _encryption;

    public TeslaKeyService(AppDbContext db, TeslaTokenEncryptionService encryption)
    {
        _db = db;
        _encryption = encryption;
    }

    public Task<TeslaKeyPair?> GetCurrentAsync(CancellationToken cancellationToken = default) =>
        _db.Set<TeslaKeyPair>().OrderByDescending(k => k.CreatedAt).FirstOrDefaultAsync(cancellationToken);

    public async Task<TeslaKeyPair> GenerateAsync(string domain, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(domain))
            throw new ArgumentException("A non-empty public domain is required.", nameof(domain));

        var existing = await _db.Set<TeslaKeyPair>().ToListAsync(cancellationToken);
        if (existing.Count > 0)
            _db.Set<TeslaKeyPair>().RemoveRange(existing);

        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var publicPem = ExportPublicKeyPem(ecdsa);
        var privatePem = ExportPrivateKeyPem(ecdsa);

        var keypair = new TeslaKeyPair
        {
            PublicKeyPem = publicPem,
            EncryptedPrivateKeyPem = _encryption.Encrypt(privatePem),
            Domain = NormalizeDomain(domain),
            PartnerRegistered = false,
            CreatedAt = DateTime.UtcNow,
        };

        _db.Set<TeslaKeyPair>().Add(keypair);
        await _db.SaveChangesAsync(cancellationToken);
        return keypair;
    }

    public string DecryptPrivateKeyPem(TeslaKeyPair keypair) =>
        _encryption.Decrypt(keypair.EncryptedPrivateKeyPem);

    public static string PublicKeyUrl(string domain)
    {
        var clean = NormalizeDomain(domain);
        return $"https://{clean}{WellKnownPath}";
    }

    public static string PairingUrl(string domain)
    {
        var clean = NormalizeDomain(domain);
        return $"https://tesla.com/_ak/{clean}";
    }

    public static string WellKnownEndpointPath => WellKnownPath;

    private static string NormalizeDomain(string domain)
    {
        var s = domain.Trim().ToLowerInvariant();
        if (s.StartsWith("https://", StringComparison.Ordinal))
            s = s[8..];
        else if (s.StartsWith("http://", StringComparison.Ordinal))
            s = s[7..];
        var slash = s.IndexOf('/');
        if (slash >= 0)
            s = s[..slash];
        return s.TrimEnd('.');
    }

    private static string ExportPublicKeyPem(ECDsa ecdsa)
    {
        var spki = ecdsa.ExportSubjectPublicKeyInfo();
        return PemEncode("PUBLIC KEY", spki);
    }

    private static string ExportPrivateKeyPem(ECDsa ecdsa)
    {
        var pkcs8 = ecdsa.ExportPkcs8PrivateKey();
        return PemEncode("PRIVATE KEY", pkcs8);
    }

    private static string PemEncode(string label, byte[] data)
    {
        var base64 = Convert.ToBase64String(data);
        var sb = new System.Text.StringBuilder();
        sb.Append("-----BEGIN ").Append(label).Append("-----\n");
        for (int i = 0; i < base64.Length; i += 64)
        {
            sb.Append(base64.AsSpan(i, Math.Min(64, base64.Length - i)));
            sb.Append('\n');
        }
        sb.Append("-----END ").Append(label).Append("-----\n");
        return sb.ToString();
    }
}
