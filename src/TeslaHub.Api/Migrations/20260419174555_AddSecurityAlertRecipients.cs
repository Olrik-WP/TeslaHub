using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TeslaHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSecurityAlertRecipients : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NotificationRecipients",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ChannelType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ChannelTarget = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Language = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationRecipients", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SecurityAlertEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Vin = table.Column<string>(type: "character varying(17)", maxLength: 17, nullable: false),
                    VehicleDisplayName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    AlertType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Detail = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DetectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RecipientsNotified = table.Column<int>(type: "integer", nullable: false),
                    RecipientsFailed = table.Column<int>(type: "integer", nullable: false),
                    FailureReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SecurityAlertEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RecipientVehicleSubscriptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RecipientId = table.Column<int>(type: "integer", nullable: false),
                    TeslaVehicleId = table.Column<int>(type: "integer", nullable: false),
                    SentryAlerts = table.Column<bool>(type: "boolean", nullable: false),
                    BreakInAlerts = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecipientVehicleSubscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecipientVehicleSubscriptions_NotificationRecipients_Recipi~",
                        column: x => x.RecipientId,
                        principalTable: "NotificationRecipients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RecipientVehicleSubscriptions_TeslaVehicles_TeslaVehicleId",
                        column: x => x.TeslaVehicleId,
                        principalTable: "TeslaVehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecipientVehicleSubscriptions_RecipientId_TeslaVehicleId",
                table: "RecipientVehicleSubscriptions",
                columns: new[] { "RecipientId", "TeslaVehicleId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecipientVehicleSubscriptions_TeslaVehicleId",
                table: "RecipientVehicleSubscriptions",
                column: "TeslaVehicleId");

            migrationBuilder.CreateIndex(
                name: "IX_SecurityAlertEvents_DetectedAt",
                table: "SecurityAlertEvents",
                column: "DetectedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecipientVehicleSubscriptions");

            migrationBuilder.DropTable(
                name: "SecurityAlertEvents");

            migrationBuilder.DropTable(
                name: "NotificationRecipients");
        }
    }
}
