using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddChargersSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChargersCustomNetworks",
                table: "GlobalSettings",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ChargersEnabled",
                table: "GlobalSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ChargersNetworkFilter",
                table: "GlobalSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.UpdateData(
                table: "GlobalSettings",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "ChargersCustomNetworks", "ChargersEnabled", "ChargersNetworkFilter" },
                values: new object[] { null, false, "all" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ChargersCustomNetworks",
                table: "GlobalSettings");

            migrationBuilder.DropColumn(
                name: "ChargersEnabled",
                table: "GlobalSettings");

            migrationBuilder.DropColumn(
                name: "ChargersNetworkFilter",
                table: "GlobalSettings");
        }
    }
}
