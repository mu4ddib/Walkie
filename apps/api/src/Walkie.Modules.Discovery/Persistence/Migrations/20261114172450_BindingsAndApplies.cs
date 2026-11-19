using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BindingsAndApplies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "applies",
                schema: "discovery",
                columns: table => new
                {
                    apply_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    request_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    result = table.Column<string>(type: "jsonb", nullable: false),
                    created_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_applies", x => x.apply_id);
                    table.ForeignKey(
                        name: "FK_applies_snapshots_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "bindings",
                schema: "discovery",
                columns: table => new
                {
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_key = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    decision = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    target_kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    target_id = table.Column<Guid>(type: "uuid", nullable: true),
                    target_title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    entity_fingerprint = table.Column<string>(type: "character varying(71)", maxLength: 71, nullable: true),
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    apply_id = table.Column<Guid>(type: "uuid", nullable: true),
                    note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    decided_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bindings", x => new { x.app_id, x.source_id, x.entity_key });
                    table.CheckConstraint("ck_bindings_decision", "decision IS NULL OR (decision = 'rejected' AND target_id IS NULL) OR (decision IN ('linked', 'created') AND target_id IS NOT NULL AND target_kind IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_bindings_snapshots_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bindings_sources_app_id_source_id",
                        columns: x => new { x.app_id, x.source_id },
                        principalSchema: "discovery",
                        principalTable: "sources",
                        principalColumns: new[] { "app_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_applies_snapshot_id",
                schema: "discovery",
                table: "applies",
                column: "snapshot_id");

            migrationBuilder.CreateIndex(
                name: "ix_bindings_app_target",
                schema: "discovery",
                table: "bindings",
                columns: new[] { "app_id", "target_kind", "target_id" });

            migrationBuilder.CreateIndex(
                name: "IX_bindings_snapshot_id",
                schema: "discovery",
                table: "bindings",
                column: "snapshot_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "applies",
                schema: "discovery");

            migrationBuilder.DropTable(
                name: "bindings",
                schema: "discovery");
        }
    }
}
