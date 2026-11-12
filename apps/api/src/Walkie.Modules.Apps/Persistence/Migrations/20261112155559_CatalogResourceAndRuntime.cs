using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CatalogResourceAndRuntime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "resource",
                schema: "apps",
                table: "catalog_items",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "runtime",
                schema: "apps",
                table: "catalog_items",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "resource",
                schema: "apps",
                table: "catalog_items");

            migrationBuilder.DropColumn(
                name: "runtime",
                schema: "apps",
                table: "catalog_items");
        }
    }
}
