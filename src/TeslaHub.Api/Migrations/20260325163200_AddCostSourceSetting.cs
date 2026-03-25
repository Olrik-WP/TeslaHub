using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCostSourceSetting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CostSource",
                table: "GlobalSettings",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "teslahub");

            migrationBuilder.UpdateData(
                table: "GlobalSettings",
                keyColumn: "Id",
                keyValue: 1,
                column: "CostSource",
                value: "teslahub");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CostSource",
                table: "GlobalSettings");
        }
    }
}
