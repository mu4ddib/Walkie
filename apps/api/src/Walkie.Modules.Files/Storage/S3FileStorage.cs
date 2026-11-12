using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Walkie.Modules.Files.Storage;

/// <summary>Almacenamiento compatible con S3 (AWS, R2, RustFS…).</summary>
internal sealed class S3FileStorage : IFileStorage, IDisposable
{
    private readonly AmazonS3Client _client;
    private readonly string _bucket;

    public S3FileStorage(IOptions<StorageOptions> options)
    {
        var o = options.Value;
        var config = new AmazonS3Config
        {
            // Servidores compatibles (RustFS) no aceptan los checksums que el SDK v4 agrega por defecto.
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
            AuthenticationRegion = o.Region,
        };
        if (!string.IsNullOrEmpty(o.Endpoint))
        {
            config.ServiceURL = o.Endpoint;
            config.ForcePathStyle = true;
        }

        _client = new AmazonS3Client(new BasicAWSCredentials(o.AccessKey, o.SecretKey), config);
        _bucket = o.Bucket;
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken) =>
        await _client.PutObjectAsync(
            new PutObjectRequest { BucketName = _bucket, Key = key, InputStream = content, ContentType = contentType },
            cancellationToken).ConfigureAwait(false);

    public async Task<Stream?> GetAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            var response = await _client.GetObjectAsync(_bucket, key, cancellationToken).ConfigureAwait(false);
            return response.ResponseStream;
        }
        catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        await _client.DeleteObjectAsync(_bucket, key, cancellationToken).ConfigureAwait(false);

    public async Task EnsureReadyAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _client.PutBucketAsync(new PutBucketRequest { BucketName = _bucket }, cancellationToken).ConfigureAwait(false);
        }
        catch (AmazonS3Exception e) when (e.ErrorCode is "BucketAlreadyOwnedByYou" or "BucketAlreadyExists")
        {
            // Ya existe: nada que hacer.
        }
    }

    public void Dispose() => _client.Dispose();
}
