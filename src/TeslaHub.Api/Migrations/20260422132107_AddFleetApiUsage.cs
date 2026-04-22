using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFleetApiUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ShowFleetApiCost",
                table: "GlobalSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "FleetApiUsages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    YearMonth = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    RequestCount = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FleetApiUsages", x => x.Id);
                });

            migrationBuilder.UpdateData(
                table: "GlobalSettings",
                keyColumn: "Id",
                keyValue: 1,
                column: "ShowFleetApiCost",
                value: false);

            migrationBuilder.CreateIndex(
                name: "IX_FleetApiUsages_YearMonth_Category",
                table: "FleetApiUsages",
                columns: new[] { "YearMonth", "Category" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FleetApiUsages");

            migrationBuilder.DropColumn(
                name: "ShowFleetApiCost",
                table: "GlobalSettings");
        }
    }
}
