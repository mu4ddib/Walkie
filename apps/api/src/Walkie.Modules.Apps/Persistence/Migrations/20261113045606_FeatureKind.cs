using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FeatureKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                schema: "apps",
                table: "features",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "feature");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "kind",
                schema: "apps",
                table: "features");
        }
    }
}
