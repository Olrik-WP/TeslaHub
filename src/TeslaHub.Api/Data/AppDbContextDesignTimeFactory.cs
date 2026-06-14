using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace TeslaHub.Api.Data;

/// <summary>
/// Design-time factory used only by the EF Core tooling (e.g.
/// <c>dotnet ef migrations add</c>). The real application configures the
/// DbContext in Program.cs from environment variables; this factory lets the
/// tooling instantiate AppDbContext without booting the full host (which
/// requires runtime secrets like TESLAHUB_JWT_SECRET). It never connects to a
/// database during "migrations add" — the connection string is only a
/// placeholder so UseNpgsql has something to parse.
/// </summary>
public sealed class AppDbContextDesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var host = Environment.GetEnvironmentVariable("APP_DB_HOST") ?? "localhost";
        var port = Environment.GetEnvironmentVariable("APP_DB_PORT") ?? "5432";
        var db = Environment.GetEnvironmentVariable("APP_DB_NAME") ?? "teslahub";
        var user = Environment.GetEnvironmentVariable("APP_DB_USER") ?? "teslahub_app";
        var pass = Environment.GetEnvironmentVariable("APP_DB_PASSWORD") ?? "";
        var connectionString = $"Host={host};Port={port};Database={db};Username={user};Password={pass};";

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new AppDbContext(options);
    }
}
