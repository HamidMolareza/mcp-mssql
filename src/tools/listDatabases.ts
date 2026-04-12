import { formatRecordset, countRows } from "../shared/format.js";
import type { AppRuntime, ToolResponse } from "../shared/types.js";

export function buildListDatabasesHandler(
  runtime: AppRuntime
): (args: { target?: string | undefined }) => Promise<ToolResponse> {
  return async ({ target }) => {
    const selectedTarget = runtime.getTarget(target);

    return runtime.executeAudited("list_databases", { target: selectedTarget.name }, async () => {
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
        response: {
          content: [
            {
              type: "text",
              text: formatRecordset({
                target: selectedTarget.name,
                databases: result.recordset
              })
            }
          ]
        },
        audit: {
          rowCount: countRows(result.recordset)
        }
      };
    });
  };
}
