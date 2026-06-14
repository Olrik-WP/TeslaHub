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
    public DbSet<CarShowroomConfig> CarShowroomConfigs => Set<CarShowroomConfig>();
    public DbSet<CarShowroomWrap> CarShowroomWraps => Set<CarShowroomWrap>();
    public DbSet<TeslaAccount> TeslaAccounts => Set<TeslaAccount>();
    public DbSet<TeslaVehicle> TeslaVehicles => Set<TeslaVehicle>();
    public DbSet<TeslaKeyPair> TeslaKeyPairs => Set<TeslaKeyPair>();
    public DbSet<NotificationRecipient> NotificationRecipients => Set<NotificationRecipient>();
    public DbSet<RecipientVehicleSubscription> RecipientVehicleSubscriptions => Set<RecipientVehicleSubscription>();
    public DbSet<SecurityAlertEvent> SecurityAlertEvents => Set<SecurityAlertEvent>();
    public DbSet<FleetApiUsage> FleetApiUsages => Set<FleetApiUsage>();
    public DbSet<LoadSheddingProfile> LoadSheddingProfiles => Set<LoadSheddingProfile>();
    public DbSet<LoadSheddingEvent> LoadSheddingEvents => Set<LoadSheddingEvent>();
    public DbSet<BatteryModuleTempSample> BatteryModuleTempSamples => Set<BatteryModuleTempSample>();

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

        modelBuilder.Entity<CarShowroomConfig>()
            .HasIndex(c => c.CarId)
            .IsUnique();

        // Multiple uploaded wraps per car: index on CarId is NOT unique.
        // Sorted lookups (newest first) are the only access pattern.
        modelBuilder.Entity<CarShowroomWrap>()
            .HasIndex(w => new { w.CarId, w.UploadedAt });

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

        modelBuilder.Entity<RecipientVehicleSubscription>()
            .HasIndex(s => new { s.RecipientId, s.TeslaVehicleId })
            .IsUnique();

        modelBuilder.Entity<RecipientVehicleSubscription>()
            .HasOne(s => s.Recipient)
            .WithMany()
            .HasForeignKey(s => s.RecipientId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RecipientVehicleSubscription>()
            .HasOne(s => s.TeslaVehicle)
            .WithMany()
            .HasForeignKey(s => s.TeslaVehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<SecurityAlertEvent>()
            .HasIndex(e => e.DetectedAt);

        modelBuilder.Entity<FleetApiUsage>()
            .HasIndex(u => new { u.YearMonth, u.Category })
            .IsUnique();

        modelBuilder.Entity<LoadSheddingProfile>()
            .HasIndex(p => p.TeslaVehicleId)
            .IsUnique();

        modelBuilder.Entity<LoadSheddingProfile>()
            .HasOne(p => p.TeslaVehicle)
            .WithMany()
            .HasForeignKey(p => p.TeslaVehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<LoadSheddingEvent>()
            .HasIndex(e => new { e.TeslaVehicleId, e.At });

        modelBuilder.Entity<BatteryModuleTempSample>()
            .HasIndex(s => new { s.CarId, s.RecordedAt });

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
