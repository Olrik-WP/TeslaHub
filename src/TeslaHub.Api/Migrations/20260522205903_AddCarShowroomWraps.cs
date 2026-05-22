using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCarShowroomWraps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CarShowroomWraps",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    PngBytes = table.Column<byte[]>(type: "bytea", nullable: false),
                    SizeBytes = table.Column<int>(type: "integer", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarShowroomWraps", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CarShowroomWraps_CarId_UploadedAt",
                table: "CarShowroomWraps",
                columns: new[] { "CarId", "UploadedAt" });

            // Data migration — every car that already had a single
            // wrap PNG in the legacy `CarShowroomConfigs.WrapPng`
            // column gets it transferred to the new multi-row table
            // so users don't lose their upload when this migration
            // runs. The legacy column is then nulled out (but kept
            // around for one release in case any cached frontend
            // bundle still hits the old endpoint — those reads now
            // fall back to the first row of the new table).
            migrationBuilder.Sql(@"
                INSERT INTO ""CarShowroomWraps""
                    (""CarId"", ""Name"", ""PngBytes"", ""SizeBytes"", ""UploadedAt"")
                SELECT
                    ""CarId"",
                    'Imported wrap'   AS ""Name"",
                    ""WrapPng""       AS ""PngBytes"",
                    octet_length(""WrapPng"") AS ""SizeBytes"",
                    ""UpdatedAt""     AS ""UploadedAt""
                FROM ""CarShowroomConfigs""
                WHERE ""WrapPng"" IS NOT NULL;

                UPDATE ""CarShowroomConfigs""
                   SET ""WrapPng"" = NULL
                 WHERE ""WrapPng"" IS NOT NULL;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CarShowroomWraps");
        }
    }
}
