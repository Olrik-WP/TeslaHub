using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLoadShedding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LoadSheddingEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TeslaVehicleId = table.Column<int>(type: "integer", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    FromAmps = table.Column<int>(type: "integer", nullable: true),
                    ToAmps = table.Column<int>(type: "integer", nullable: true),
                    HouseVa = table.Column<int>(type: "integer", nullable: true),
                    Detail = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoadSheddingEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "LoadSheddingProfiles",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TeslaVehicleId = table.Column<int>(type: "integer", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    DryRun = table.Column<bool>(type: "boolean", nullable: false),
                    MaxAmps = table.Column<int>(type: "integer", nullable: false),
                    MinAmps = table.Column<int>(type: "integer", nullable: false),
                    TargetReducedAmps = table.Column<int>(type: "integer", nullable: false),
                    HighThresholdVa = table.Column<int>(type: "integer", nullable: false),
                    LowThresholdVa = table.Column<int>(type: "integer", nullable: false),
                    HighWindowSeconds = table.Column<int>(type: "integer", nullable: false),
                    LowWindowSeconds = table.Column<int>(type: "integer", nullable: false),
                    CooldownSeconds = table.Column<int>(type: "integer", nullable: false),
                    MinAmpsDelta = table.Column<int>(type: "integer", nullable: false),
                    HourlyCommandQuota = table.Column<int>(type: "integer", nullable: false),
                    DailyCommandQuota = table.Column<int>(type: "integer", nullable: false),
                    MinSamplesInWindow = table.Column<int>(type: "integer", nullable: false),
                    MqttTopic = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PowerJsonField = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoadSheddingProfiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LoadSheddingProfiles_TeslaVehicles_TeslaVehicleId",
                        column: x => x.TeslaVehicleId,
                        principalTable: "TeslaVehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LoadSheddingEvents_TeslaVehicleId_At",
                table: "LoadSheddingEvents",
                columns: new[] { "TeslaVehicleId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_LoadSheddingProfiles_TeslaVehicleId",
                table: "LoadSheddingProfiles",
                column: "TeslaVehicleId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LoadSheddingEvents");

            migrationBuilder.DropTable(
                name: "LoadSheddingProfiles");
        }
    }
}
