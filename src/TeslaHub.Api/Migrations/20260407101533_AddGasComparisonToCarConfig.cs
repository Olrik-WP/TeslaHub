using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGasComparisonToCarConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "GasConsumptionLPer100Km",
                table: "CarConfigs",
                type: "numeric(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "GasPricePerLiter",
                table: "CarConfigs",
                type: "numeric(10,4)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GasVehicleName",
                table: "CarConfigs",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GasConsumptionLPer100Km",
                table: "CarConfigs");

            migrationBuilder.DropColumn(
                name: "GasPricePerLiter",
                table: "CarConfigs");

            migrationBuilder.DropColumn(
                name: "GasVehicleName",
                table: "CarConfigs");
        }
    }
}
