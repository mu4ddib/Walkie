using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Memberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "memberships",
                schema: "apps",
                columns: table => new
                {
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    granted_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    granted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_memberships", x => new { x.app_id, x.user_id });
                    table.CheckConstraint("ck_memberships_role", "role IN ('owner', 'editor', 'viewer')");
                    table.ForeignKey(
                        name: "FK_memberships_apps_app_id",
                        column: x => x.app_id,
                        principalSchema: "apps",
                        principalTable: "apps",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "users",
                schema: "apps",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    first_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_memberships_user_id",
                schema: "apps",
                table: "memberships",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                schema: "apps",
                table: "users",
                column: "email");

            // ADR-0015: cada app que ya existía queda con quien la creó como owner (nadie pierde el acceso a lo suyo).
            migrationBuilder.Sql(
                "INSERT INTO apps.memberships (app_id, user_id, role, granted_by, granted_at) " +
                "SELECT id, created_by, 'owner', created_by, created_at FROM apps.apps ON CONFLICT DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "memberships",
                schema: "apps");

            migrationBuilder.DropTable(
                name: "users",
                schema: "apps");
        }
    }
}
