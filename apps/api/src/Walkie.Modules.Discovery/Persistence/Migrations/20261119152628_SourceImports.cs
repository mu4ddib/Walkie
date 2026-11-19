using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SourceImports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "source_imports",
                schema: "discovery",
                columns: table => new
                {
                    import_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    pack_sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    request_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_source_imports", x => x.import_id);
                    table.CheckConstraint("ck_source_imports_status", "status IN ('pending', 'completed', 'compensated') AND (status <> 'completed' OR snapshot_id IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_source_imports_snapshots_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_source_imports_snapshot_id",
                schema: "discovery",
                table: "source_imports",
                column: "snapshot_id");

            migrationBuilder.CreateIndex(
                name: "ux_source_imports_app",
                schema: "discovery",
                table: "source_imports",
                column: "app_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_source_imports_pending_source",
                schema: "discovery",
                table: "source_imports",
                column: "source_id",
                unique: true,
                filter: "status = 'pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "source_imports",
                schema: "discovery");
        }
    }
}
