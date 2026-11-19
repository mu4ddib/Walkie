using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialDiscovery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "discovery");

            migrationBuilder.CreateTable(
                name: "sources",
                schema: "discovery",
                columns: table => new
                {
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sources", x => new { x.app_id, x.id });
                });

            migrationBuilder.CreateTable(
                name: "snapshots",
                schema: "discovery",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    previous_snapshot_id = table.Column<Guid>(type: "uuid", nullable: true),
                    format_version = table.Column<int>(type: "integer", nullable: false),
                    analyzer_name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    analyzer_version = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    generated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    imported_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    imported_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    completeness = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    pack_sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    content_fingerprint = table.Column<string>(type: "character varying(71)", maxLength: 71, nullable: false),
                    manifest = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_snapshots", x => x.id);
                    table.ForeignKey(
                        name: "FK_snapshots_snapshots_previous_snapshot_id",
                        column: x => x.previous_snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_snapshots_sources_app_id_source_id",
                        columns: x => new { x.app_id, x.source_id },
                        principalSchema: "discovery",
                        principalTable: "sources",
                        principalColumns: new[] { "app_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "entities",
                schema: "discovery",
                columns: table => new
                {
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    basis = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    confidence = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    fingerprint = table.Column<string>(type: "character varying(71)", maxLength: 71, nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_entities", x => new { x.snapshot_id, x.key });
                    table.ForeignKey(
                        name: "FK_entities_snapshots_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "evidence",
                schema: "discovery",
                columns: table => new
                {
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    detector = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    path = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_evidence", x => new { x.snapshot_id, x.id });
                    table.ForeignKey(
                        name: "FK_evidence_snapshots_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "relations",
                schema: "discovery",
                columns: table => new
                {
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(1100)", maxLength: 1100, nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    from_key = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    to_key = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    basis = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    confidence = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_relations", x => new { x.snapshot_id, x.key });
                    table.ForeignKey(
                        name: "FK_relations_entities_snapshot_id_from_key",
                        columns: x => new { x.snapshot_id, x.from_key },
                        principalSchema: "discovery",
                        principalTable: "entities",
                        principalColumns: new[] { "snapshot_id", "key" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_relations_entities_snapshot_id_to_key",
                        columns: x => new { x.snapshot_id, x.to_key },
                        principalSchema: "discovery",
                        principalTable: "entities",
                        principalColumns: new[] { "snapshot_id", "key" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_relations_snapshots_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "discovery",
                        principalTable: "snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_entities_snapshot_kind",
                schema: "discovery",
                table: "entities",
                columns: new[] { "snapshot_id", "kind" });

            migrationBuilder.CreateIndex(
                name: "ix_relations_snapshot_from",
                schema: "discovery",
                table: "relations",
                columns: new[] { "snapshot_id", "from_key" });

            migrationBuilder.CreateIndex(
                name: "ix_relations_snapshot_to",
                schema: "discovery",
                table: "relations",
                columns: new[] { "snapshot_id", "to_key" });

            migrationBuilder.CreateIndex(
                name: "ix_snapshots_app_source_imported",
                schema: "discovery",
                table: "snapshots",
                columns: new[] { "app_id", "source_id", "imported_at" });

            migrationBuilder.CreateIndex(
                name: "IX_snapshots_previous_snapshot_id",
                schema: "discovery",
                table: "snapshots",
                column: "previous_snapshot_id");

            migrationBuilder.CreateIndex(
                name: "ux_snapshots_app_source_pack",
                schema: "discovery",
                table: "snapshots",
                columns: new[] { "app_id", "source_id", "pack_sha256" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "evidence",
                schema: "discovery");

            migrationBuilder.DropTable(
                name: "relations",
                schema: "discovery");

            migrationBuilder.DropTable(
                name: "entities",
                schema: "discovery");

            migrationBuilder.DropTable(
                name: "snapshots",
                schema: "discovery");

            migrationBuilder.DropTable(
                name: "sources",
                schema: "discovery");
        }
    }
}
