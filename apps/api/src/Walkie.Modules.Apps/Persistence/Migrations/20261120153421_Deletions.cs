using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Deletions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleting_at",
                schema: "apps",
                table: "features",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleting_at",
                schema: "apps",
                table: "apps",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "deletions",
                schema: "apps",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    feature_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    requested_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    steps = table.Column<string>(type: "jsonb", nullable: false),
                    error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    lease_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deletions", x => x.id);
                    table.CheckConstraint("ck_deletions_status", "status IN ('pending', 'completed', 'cancelled')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_deletions_app_id",
                schema: "apps",
                table: "deletions",
                column: "app_id");

            migrationBuilder.CreateIndex(
                name: "ix_deletions_status",
                schema: "apps",
                table: "deletions",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "deletions",
                schema: "apps");

            migrationBuilder.DropColumn(
                name: "deleting_at",
                schema: "apps",
                table: "features");

            migrationBuilder.DropColumn(
                name: "deleting_at",
                schema: "apps",
                table: "apps");
        }
    }
}
