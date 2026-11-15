using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ApplyJournal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "pending_apply_id",
                schema: "discovery",
                table: "bindings",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "result",
                schema: "discovery",
                table: "applies",
                type: "jsonb",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "jsonb");

            migrationBuilder.AddColumn<string>(
                name: "plan",
                schema: "discovery",
                table: "applies",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "source_id",
                schema: "discovery",
                table: "applies",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "updated_at",
                schema: "discovery",
                table: "applies",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // Las entradas de la tarea 4 (reject, link, reset) ya existen: su fuente sale de su análisis y su última
            // actualización es su creación (se escribieron completed de una vez).
            migrationBuilder.Sql(
                "UPDATE discovery.applies AS a SET source_id = s.source_id, updated_at = a.created_at "
                + "FROM discovery.snapshots AS s WHERE s.id = a.snapshot_id;");

            migrationBuilder.CreateTable(
                name: "apply_steps",
                schema: "discovery",
                columns: table => new
                {
                    apply_id = table.Column<Guid>(type: "uuid", nullable: false),
                    index = table.Column<int>(type: "integer", nullable: false),
                    entity_key = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    target_kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    target_id = table.Column<Guid>(type: "uuid", nullable: false),
                    item = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_apply_steps", x => new { x.apply_id, x.index });
                    table.CheckConstraint("ck_apply_steps_status", "status IN ('planned', 'created', 'compensated', 'kept')");
                    table.ForeignKey(
                        name: "FK_apply_steps_applies_apply_id",
                        column: x => x.apply_id,
                        principalSchema: "discovery",
                        principalTable: "applies",
                        principalColumn: "apply_id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_applies_source_status",
                schema: "discovery",
                table: "applies",
                columns: new[] { "app_id", "source_id", "status" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_applies_status",
                schema: "discovery",
                table: "applies",
                sql: "status IN ('pending', 'completed', 'compensated') AND (status = 'pending' OR result IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "ux_apply_steps_target",
                schema: "discovery",
                table: "apply_steps",
                column: "target_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "apply_steps",
                schema: "discovery");

            migrationBuilder.DropIndex(
                name: "ix_applies_source_status",
                schema: "discovery",
                table: "applies");

            migrationBuilder.DropCheckConstraint(
                name: "ck_applies_status",
                schema: "discovery",
                table: "applies");

            migrationBuilder.DropColumn(
                name: "pending_apply_id",
                schema: "discovery",
                table: "bindings");

            migrationBuilder.DropColumn(
                name: "plan",
                schema: "discovery",
                table: "applies");

            migrationBuilder.DropColumn(
                name: "source_id",
                schema: "discovery",
                table: "applies");

            migrationBuilder.DropColumn(
                name: "updated_at",
                schema: "discovery",
                table: "applies");

            migrationBuilder.AlterColumn<string>(
                name: "result",
                schema: "discovery",
                table: "applies",
                type: "jsonb",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldNullable: true);
        }
    }
}
