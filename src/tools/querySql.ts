import { buildQueryAudit, countRows, formatRecordset, summarizeError } from "../shared/format.js";
import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { assertReadOnlyQuery } from "../sql/safety.js";

export function buildQuerySqlHandler(
  runtime: AppRuntime
): (args: { target?: string | undefined; sql: string }) => Promise<ToolResponse> {
  return async ({ target, sql: query }) => {
    const selectedTarget = runtime.getTarget(target);
    const queryAudit = buildQueryAudit(query);

    return runtime.executeAudited(
      "query_sql",
      {
        target: selectedTarget.name,
        ...queryAudit
      },
      async () => {
        const pool = await runtime.getPool(selectedTarget.name);

        try {
          assertReadOnlyQuery(query);
        } catch (error) {
          runtime.logger.warn("security.query_blocked", {
            target: selectedTarget.name,
            ...queryAudit,
            error: summarizeError(error)
          });
          throw error;
        }

        const result = await pool.request().query(query);

        return {
          response: {
            content: [
              {
                type: "text",
                text: formatRecordset({
                  target: selectedTarget.name,
                  rows: result.recordset
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
