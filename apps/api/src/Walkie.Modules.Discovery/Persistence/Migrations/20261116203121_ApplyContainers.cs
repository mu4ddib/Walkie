using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Discovery.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ApplyContainers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_apply_steps_status",
                schema: "discovery",
                table: "apply_steps");

            migrationBuilder.AddCheckConstraint(
                name: "ck_apply_steps_status",
                schema: "discovery",
                table: "apply_steps",
                sql: "status IN ('planned', 'created', 'saved', 'compensated', 'kept')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_apply_steps_status",
                schema: "discovery",
                table: "apply_steps");

            migrationBuilder.AddCheckConstraint(
                name: "ck_apply_steps_status",
                schema: "discovery",
                table: "apply_steps",
                sql: "status IN ('planned', 'created', 'compensated', 'kept')");
        }
    }
}
