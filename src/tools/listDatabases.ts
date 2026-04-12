import type { AppRuntime, ToolResponse } from "../shared/types.js";
import {
  createRowCountAudit,
  createTextResponse,
  executeTargetedTool,
  type TargetedToolArgs
} from "./common.js";

export function buildListDatabasesHandler(
  runtime: AppRuntime
): (args: TargetedToolArgs) => Promise<ToolResponse> {
  return async ({ target }) => {
    return executeTargetedTool(
      runtime,
      "list_databases",
      target,
      (selectedTarget) => ({ target: selectedTarget.name }),
      async ({ selectedTarget }) => {
        const pool = await runtime.getPool(selectedTarget.name);
        const result = await pool.request().query(`
        SELECT
          name,
          database_id,
          create_date,
          compatibility_level,
          state_desc
        FROM sys.databases
        ORDER BY name
      `);

        return {
          response: createTextResponse({
            target: selectedTarget.name,
            databases: result.recordset
          }),
          audit: createRowCountAudit(result.recordset)
        };
      }
    );
  };
}
