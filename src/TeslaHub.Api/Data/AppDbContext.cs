using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<GlobalSettings> GlobalSettings => Set<GlobalSettings>();
    public DbSet<CarConfig> CarConfigs => Set<CarConfig>();
    public DbSet<PriceRule> PriceRules => Set<PriceRule>();
    public DbSet<ChargingCostOverride> ChargingCostOverrides => Set<ChargingCostOverride>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>()
            .HasIndex(u => u.Username)
            .IsUnique();

        modelBuilder.Entity<CarConfig>()
            .HasIndex(c => c.CarId)
            .IsUnique();

        modelBuilder.Entity<PriceRule>()
            .HasIndex(p => new { p.Priority, p.IsActive });

        modelBuilder.Entity<ChargingCostOverride>()
            .HasIndex(c => new { c.ChargingProcessId, c.CarId })
            .IsUnique();

        modelBuilder.Entity<GlobalSettings>().HasData(new GlobalSettings
        {
            Id = 1,
            Currency = "EUR",
            UnitOfLength = "km",
            UnitOfTemperature = "C"
        });
    }
}
