using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace Walkie.Modules.Sharing.Features;

/// <summary>Tokens de los enlaces: 256 bits aleatorios en base64url (43 caracteres) y su hash SHA-256.</summary>
internal static class ShareTokens
{
    public static string New() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

    public static byte[] Hash(string token) => SHA256.HashData(Encoding.ASCII.GetBytes(token));
}
