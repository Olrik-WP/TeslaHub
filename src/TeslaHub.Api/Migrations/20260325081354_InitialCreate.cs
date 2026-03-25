using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CarConfigs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ColorOverride = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarConfigs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChargingLocations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Latitude = table.Column<double>(type: "double precision", nullable: false),
                    Longitude = table.Column<double>(type: "double precision", nullable: false),
                    RadiusMeters = table.Column<int>(type: "integer", nullable: false),
                    PricingType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PeakPricePerKwh = table.Column<decimal>(type: "numeric(10,4)", nullable: true),
                    OffPeakPricePerKwh = table.Column<decimal>(type: "numeric(10,4)", nullable: true),
                    OffPeakStart = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    OffPeakEnd = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    MonthlySubscription = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    CarId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChargingLocations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GlobalSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Currency = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    UnitOfLength = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    UnitOfTemperature = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    DefaultCarId = table.Column<int>(type: "integer", nullable: true),
                    MapTileUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GlobalSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Username = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChargingCostOverrides",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ChargingProcessId = table.Column<int>(type: "integer", nullable: false),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    PricePerKwh = table.Column<decimal>(type: "numeric(10,4)", nullable: true),
                    TotalCost = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    IsFree = table.Column<bool>(type: "boolean", nullable: false),
                    IsManualOverride = table.Column<bool>(type: "boolean", nullable: false),
                    LocationId = table.Column<int>(type: "integer", nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChargingCostOverrides", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChargingCostOverrides_ChargingLocations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "ChargingLocations",
                        principalColumn: "Id");
                });

            migrationBuilder.InsertData(
                table: "GlobalSettings",
                columns: new[] { "Id", "Currency", "DefaultCarId", "MapTileUrl", "UnitOfLength", "UnitOfTemperature" },
                values: new object[] { 1, "EUR", null, "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "km", "C" });

            migrationBuilder.CreateIndex(
                name: "IX_CarConfigs_CarId",
                table: "CarConfigs",
                column: "CarId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChargingCostOverrides_ChargingProcessId_CarId",
                table: "ChargingCostOverrides",
                columns: new[] { "ChargingProcessId", "CarId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChargingCostOverrides_LocationId",
                table: "ChargingCostOverrides",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CarConfigs");

            migrationBuilder.DropTable(
                name: "ChargingCostOverrides");

            migrationBuilder.DropTable(
                name: "GlobalSettings");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "ChargingLocations");
        }
    }
}
