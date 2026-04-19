using System.Security.Cryptography;
using System.Text;

namespace TeslaHub.Api.Services;

/// <summary>
/// AES-GCM symmetric encryption for Tesla OAuth tokens at rest.
/// The encryption key is derived from TESLAHUB_JWT_SECRET via SHA-256
/// so users do not have to manage an additional secret.
///
/// Output format (Base64): [12-byte nonce][16-byte tag][ciphertext].
/// Decryption transparently re-derives the key on each call.
/// </summary>
public sealed class TeslaTokenEncryptionService
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly byte[] _key;

    public TeslaTokenEncryptionService(IConfiguration configuration)
    {
        var seed = configuration["TESLAHUB_JWT_SECRET"]
            ?? throw new InvalidOperationException("TESLAHUB_JWT_SECRET is required to derive the Tesla token encryption key.");

        _key = SHA256.HashData(Encoding.UTF8.GetBytes("teslahub-tesla-tokens:" + seed));
    }

    public string Encrypt(string plaintext)
    {
        if (string.IsNullOrEmpty(plaintext))
            return string.Empty;

        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintextBytes.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, plaintextBytes, ciphertext, tag);

        var output = new byte[NonceSize + TagSize + ciphertext.Length];
        Buffer.BlockCopy(nonce, 0, output, 0, NonceSize);
        Buffer.BlockCopy(tag, 0, output, NonceSize, TagSize);
        Buffer.BlockCopy(ciphertext, 0, output, NonceSize + TagSize, ciphertext.Length);

        return Convert.ToBase64String(output);
    }

    public string Decrypt(string encryptedBase64)
    {
        if (string.IsNullOrEmpty(encryptedBase64))
            return string.Empty;

        var input = Convert.FromBase64String(encryptedBase64);
        if (input.Length < NonceSize + TagSize)
            throw new CryptographicException("Encrypted payload is too short.");

        var nonce = new byte[NonceSize];
        var tag = new byte[TagSize];
        var ciphertext = new byte[input.Length - NonceSize - TagSize];

        Buffer.BlockCopy(input, 0, nonce, 0, NonceSize);
        Buffer.BlockCopy(input, NonceSize, tag, 0, TagSize);
        Buffer.BlockCopy(input, NonceSize + TagSize, ciphertext, 0, ciphertext.Length);

        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(_key, TagSize);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);

        return Encoding.UTF8.GetString(plaintext);
    }
}
