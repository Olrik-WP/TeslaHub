using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPeakOffPeakKwhBreakdown : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "PeakKwh",
                table: "ChargingCostOverrides",
                type: "decimal(10,4)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "OffPeakKwh",
                table: "ChargingCostOverrides",
                type: "decimal(10,4)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PeakKwh",
                table: "ChargingCostOverrides");

            migrationBuilder.DropColumn(
                name: "OffPeakKwh",
                table: "ChargingCostOverrides");
        }
    }
}
