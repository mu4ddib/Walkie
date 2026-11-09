using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CatalogContractJsonb : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "database",
                schema: "apps",
                table: "catalog_items",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "http",
                schema: "apps",
                table: "catalog_items",
                type: "jsonb",
                nullable: true);

            // El método y la ruta pasan al contrato estructurado (mismo $defs/http del grafo).
            migrationBuilder.Sql("""
                UPDATE apps.catalog_items
                SET http = jsonb_strip_nulls(jsonb_build_object('method', http_method, 'path', http_path))
                WHERE http_method IS NOT NULL OR http_path IS NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "http_method",
                schema: "apps",
                table: "catalog_items");

            migrationBuilder.DropColumn(
                name: "http_path",
                schema: "apps",
                table: "catalog_items");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "http_method",
                schema: "apps",
                table: "catalog_items",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "http_path",
                schema: "apps",
                table: "catalog_items",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE apps.catalog_items
                SET http_method = http ->> 'method', http_path = http ->> 'path'
                WHERE http IS NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "database",
                schema: "apps",
                table: "catalog_items");

            migrationBuilder.DropColumn(
                name: "http",
                schema: "apps",
                table: "catalog_items");
        }
    }
}
