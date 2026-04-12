import { buildQueryAudit, summarizeError } from "../shared/format.js";
import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { assertReadOnlyQuery } from "../sql/safety.js";
import {
  createRowCountAudit,
  createTextResponse,
  executeTargetedTool,
  type TargetedToolArgs
} from "./common.js";

type QuerySqlArgs = TargetedToolArgs & {
  sql: string;
};

export function buildQuerySqlHandler(
  runtime: AppRuntime
): (args: QuerySqlArgs) => Promise<ToolResponse> {
  return async ({ target, sql: query }) => {
    const queryAudit = buildQueryAudit(query);

    return executeTargetedTool(
      runtime,
      "query_sql",
      target,
      (selectedTarget) => ({
        target: selectedTarget.name,
        ...queryAudit
      }),
      async ({ selectedTarget }) => {
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
          response: createTextResponse({
            target: selectedTarget.name,
            rows: result.recordset
          }),
          audit: createRowCountAudit(result.recordset)
        };
      }
    );
  };
}
