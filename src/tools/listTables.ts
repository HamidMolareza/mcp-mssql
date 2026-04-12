import sql from "mssql";
import { countRows, formatRecordset } from "../shared/format.js";
import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { quoteSqlIdentifier } from "../sql/identifiers.js";

export function buildListTablesHandler(
  runtime: AppRuntime
): (args: { target?: string | undefined; database: string; schema?: string | undefined }) => Promise<ToolResponse> {
  return async ({ target, database, schema }) => {
    const selectedTarget = runtime.getTarget(target);

    return runtime.executeAudited(
      "list_tables",
      {
        target: selectedTarget.name,
        database: database.trim(),
        schema: schema?.trim() || null
      },
      async () => {
        const pool = await runtime.getPool(selectedTarget.name);
        const databaseName = quoteSqlIdentifier(database, "Database name");
        const result = await pool
          .request()
          .input("schema", sql.NVarChar, schema?.trim() || null)
          .query(`
            SELECT
              TABLE_CATALOG,
              TABLE_SCHEMA,
              TABLE_NAME
            FROM ${databaseName}.INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
              AND (@schema IS NULL OR TABLE_SCHEMA = @schema)
            ORDER BY TABLE_SCHEMA, TABLE_NAME
          `);

        return {
          response: {
            content: [
              {
                type: "text",
                text: formatRecordset({
                  target: selectedTarget.name,
                  database: database.trim(),
                  schema: schema?.trim() || null,
                  tables: result.recordset
                })
              }
            ]
          },
          audit: {
            rowCount: countRows(result.recordset)
          }
        };
      }
    );
  };
}
