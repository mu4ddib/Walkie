using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DecidedKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "decided_key",
                schema: "discovery",
                table: "bindings",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "decided_key",
                schema: "discovery",
                table: "bindings");
        }
    }
}
