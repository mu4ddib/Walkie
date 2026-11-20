using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DeletionOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "lease_until",
                schema: "apps",
                table: "deletions",
                newName: "retry_at");

            migrationBuilder.AddColumn<int>(
                name: "canvas_version",
                schema: "apps",
                table: "deletions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "owner_token",
                schema: "apps",
                table: "deletions",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "canvas_version",
                schema: "apps",
                table: "deletions");

            migrationBuilder.DropColumn(
                name: "owner_token",
                schema: "apps",
                table: "deletions");

            migrationBuilder.RenameColumn(
                name: "retry_at",
                schema: "apps",
                table: "deletions",
                newName: "lease_until");
        }
    }
}
