using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddUserPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DashboardColorPreset",
                table: "GlobalSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "DashboardGaugeMode",
                table: "GlobalSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "DashboardMaxScale",
                table: "GlobalSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Language",
                table: "GlobalSettings",
                type: "character varying(5)",
                maxLength: 5,
                nullable: false,
                defaultValue: "");

            migrationBuilder.UpdateData(
                table: "GlobalSettings",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "DashboardColorPreset", "DashboardGaugeMode", "DashboardMaxScale", "Language" },
                values: new object[] { "teslaRed", "analog", 200, "en" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DashboardColorPreset",
                table: "GlobalSettings");

            migrationBuilder.DropColumn(
                name: "DashboardGaugeMode",
                table: "GlobalSettings");

            migrationBuilder.DropColumn(
                name: "DashboardMaxScale",
                table: "GlobalSettings");

            migrationBuilder.DropColumn(
                name: "Language",
                table: "GlobalSettings");
        }
    }
}
