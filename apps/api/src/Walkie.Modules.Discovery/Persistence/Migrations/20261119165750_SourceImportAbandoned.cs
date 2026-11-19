using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SourceImportAbandoned : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_source_imports_status",
                schema: "discovery",
                table: "source_imports");

            migrationBuilder.AddCheckConstraint(
                name: "ck_source_imports_status",
                schema: "discovery",
                table: "source_imports",
                sql: "status IN ('pending', 'completed', 'compensated', 'abandoned') AND (status <> 'completed' OR snapshot_id IS NOT NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_source_imports_status",
                schema: "discovery",
                table: "source_imports");

            migrationBuilder.AddCheckConstraint(
                name: "ck_source_imports_status",
                schema: "discovery",
                table: "source_imports",
                sql: "status IN ('pending', 'completed', 'compensated') AND (status <> 'completed' OR snapshot_id IS NOT NULL)");
        }
    }
}
