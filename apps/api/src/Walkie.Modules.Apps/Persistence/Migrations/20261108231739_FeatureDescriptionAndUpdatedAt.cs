using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Walkie.Modules.Apps.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FeatureDescriptionAndUpdatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "description",
                schema: "apps",
                table: "features",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "updated_at",
                schema: "apps",
                table: "features",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // Las features existentes no tienen cambios: su fecha de actualización es la de creación.
            migrationBuilder.Sql("UPDATE apps.features SET updated_at = created_at;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "description",
                schema: "apps",
                table: "features");

            migrationBuilder.DropColumn(
                name: "updated_at",
                schema: "apps",
                table: "features");
        }
    }
}
