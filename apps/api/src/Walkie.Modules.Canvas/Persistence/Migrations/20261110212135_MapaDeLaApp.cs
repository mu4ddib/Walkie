using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Canvas.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MapaDeLaApp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "app_maps",
                schema: "canvas",
                columns: table => new
                {
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    positions = table.Column<string>(type: "jsonb", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_maps", x => x.app_id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "app_maps",
                schema: "canvas");
        }
    }
}
