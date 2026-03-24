using Npgsql;

namespace TeslaHub.Api.TeslaMate;

public class TeslaMateConnectionFactory
{
    private readonly string _connectionString;

    public TeslaMateConnectionFactory(string connectionString)
    {
        _connectionString = connectionString;
    }

    public NpgsqlConnection CreateConnection() => new(_connectionString);
}
