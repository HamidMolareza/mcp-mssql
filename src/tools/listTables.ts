import sql from "mssql";
import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { quoteSqlIdentifier } from "../sql/identifiers.js";
import {
  createRowCountAudit,
  createTextResponse,
  executeTargetedTool,
  type TargetedToolArgs
} from "./common.js";

type ListTablesArgs = TargetedToolArgs & {
  database: string;
  schema?: string | undefined;
};

export function buildListTablesHandler(
  runtime: AppRuntime
): (args: ListTablesArgs) => Promise<ToolResponse> {
  return async ({ target, database, schema }) => {
    const trimmedDatabase = database.trim();
    const normalizedSchema = schema?.trim() || null;

    return executeTargetedTool(
      runtime,
      "list_tables",
      target,
      (selectedTarget) => ({
        target: selectedTarget.name,
        database: trimmedDatabase,
        schema: normalizedSchema
      }),
      async ({ selectedTarget }) => {
        const pool = await runtime.getPool(selectedTarget.name);
        const databaseName = quoteSqlIdentifier(trimmedDatabase, "Database name");
        const result = await pool
          .request()
          .input("schema", sql.NVarChar, normalizedSchema)
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
          response: createTextResponse({
            target: selectedTarget.name,
            database: trimmedDatabase,
            schema: normalizedSchema,
            tables: result.recordset
          }),
          audit: createRowCountAudit(result.recordset)
        };
      }
    );
  };
}
