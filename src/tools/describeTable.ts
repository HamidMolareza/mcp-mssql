import sql from "mssql";
import { countRows, formatRecordset } from "../shared/format.js";
import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { parseTableReference, quoteSqlIdentifier } from "../sql/identifiers.js";

export function buildDescribeTableHandler(
  runtime: AppRuntime
): (args: { target?: string | undefined; database: string; table: string; schema?: string | undefined }) => Promise<ToolResponse> {
  return async ({ target, database, table, schema }) => {
    const selectedTarget = runtime.getTarget(target);
    const { schemaName, tableName } = parseTableReference(table, schema);

    return runtime.executeAudited(
      "describe_table",
      {
        target: selectedTarget.name,
        database: database.trim(),
        schema: schemaName,
        table: tableName
      },
      async () => {
        const pool = await runtime.getPool(selectedTarget.name);
        const databaseName = quoteSqlIdentifier(database, "Database name");
        const result = await pool
          .request()
          .input("schema", sql.NVarChar, schemaName)
          .input("table", sql.NVarChar, tableName)
          .query(`
            SELECT
              TABLE_CATALOG,
              TABLE_SCHEMA,
              TABLE_NAME,
              COLUMN_NAME,
              DATA_TYPE,
              IS_NULLABLE,
              CHARACTER_MAXIMUM_LENGTH,
              NUMERIC_PRECISION,
              NUMERIC_SCALE
            FROM ${databaseName}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @schema
              AND TABLE_NAME = @table
            ORDER BY ORDINAL_POSITION
          `);

        if (result.recordset.length === 0) {
          throw new Error(`Table not found: ${database.trim()}.${schemaName}.${tableName}`);
        }

        return {
          response: {
            content: [
              {
                type: "text",
                text: formatRecordset({
                  target: selectedTarget.name,
                  database: database.trim(),
                  schema: schemaName,
                  table: tableName,
                  columns: result.recordset
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
