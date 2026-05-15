using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLoadSheddingPowerUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Defaults match the model defaults so existing profiles
            // (created before this migration) keep behaving exactly like
            // a fresh ZLinky FR install: VA unit, no scaling.
            migrationBuilder.AddColumn<double>(
                name: "PowerScale",
                table: "LoadSheddingProfiles",
                type: "double precision",
                nullable: false,
                defaultValue: 1.0);

            migrationBuilder.AddColumn<string>(
                name: "PowerUnit",
                table: "LoadSheddingProfiles",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "VA");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PowerScale",
                table: "LoadSheddingProfiles");

            migrationBuilder.DropColumn(
                name: "PowerUnit",
                table: "LoadSheddingProfiles");
        }
    }
}
