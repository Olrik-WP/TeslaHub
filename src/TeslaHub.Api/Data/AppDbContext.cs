using Microsoft.EntityFrameworkCore;
using TeslaHub.Api.Models;

namespace TeslaHub.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<GlobalSettings> GlobalSettings => Set<GlobalSettings>();
    public DbSet<CarConfig> CarConfigs => Set<CarConfig>();
    public DbSet<ChargingLocation> ChargingLocations => Set<ChargingLocation>();
    public DbSet<ChargingCostOverride> ChargingCostOverrides => Set<ChargingCostOverride>();
    public DbSet<CarImage> CarImages => Set<CarImage>();
    public DbSet<TeslaAccount> TeslaAccounts => Set<TeslaAccount>();
    public DbSet<TeslaVehicle> TeslaVehicles => Set<TeslaVehicle>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>()
            .HasIndex(u => u.Username)
            .IsUnique();

        modelBuilder.Entity<CarConfig>()
            .HasIndex(c => c.CarId)
            .IsUnique();

        modelBuilder.Entity<ChargingCostOverride>()
            .HasIndex(c => new { c.ChargingProcessId, c.CarId })
            .IsUnique();

        modelBuilder.Entity<CarImage>()
            .HasIndex(c => c.CarId)
            .IsUnique();

        modelBuilder.Entity<TeslaAccount>()
            .HasIndex(t => t.TeslaUserId)
            .IsUnique();

        modelBuilder.Entity<TeslaVehicle>()
            .HasIndex(v => new { v.TeslaAccountId, v.Vin })
            .IsUnique();

        modelBuilder.Entity<TeslaVehicle>()
            .HasOne(v => v.TeslaAccount)
            .WithMany()
            .HasForeignKey(v => v.TeslaAccountId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<GlobalSettings>().HasData(new GlobalSettings
        {
            Id = 1,
            Currency = "EUR",
            UnitOfLength = "km",
            UnitOfTemperature = "C",
            CostSource = "teslahub"
        });
    }
}
