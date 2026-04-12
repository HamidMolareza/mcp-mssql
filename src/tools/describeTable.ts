import sql from "mssql";
import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { parseTableReference, quoteSqlIdentifier } from "../sql/identifiers.js";
import {
  createRowCountAudit,
  createTextResponse,
  executeTargetedTool,
  type TargetedToolArgs
} from "./common.js";

type DescribeTableArgs = TargetedToolArgs & {
  database: string;
  table: string;
  schema?: string | undefined;
};

export function buildDescribeTableHandler(
  runtime: AppRuntime
): (args: DescribeTableArgs) => Promise<ToolResponse> {
  return async ({ target, database, table, schema }) => {
    const trimmedDatabase = database.trim();
    const { schemaName, tableName } = parseTableReference(table, schema);

    return executeTargetedTool(
      runtime,
      "describe_table",
      target,
      (selectedTarget) => ({
        target: selectedTarget.name,
        database: trimmedDatabase,
        schema: schemaName,
        table: tableName
      }),
      async ({ selectedTarget }) => {
        const pool = await runtime.getPool(selectedTarget.name);
        const databaseName = quoteSqlIdentifier(trimmedDatabase, "Database name");
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
          throw new Error(`Table not found: ${trimmedDatabase}.${schemaName}.${tableName}`);
        }

        return {
          response: createTextResponse({
            target: selectedTarget.name,
            database: trimmedDatabase,
            schema: schemaName,
            table: tableName,
            columns: result.recordset
          }),
          audit: createRowCountAudit(result.recordset)
        };
      }
    );
  };
}
