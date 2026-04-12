import { countRows, formatRecordset } from "../shared/format.js";
import type {
  AppRuntime,
  AuditedActionResult,
  ConnectionTarget,
  JsonRecord,
  ToolResponse
} from "../shared/types.js";

export type TargetedToolArgs = {
  target?: string | undefined;
};

type TargetedToolContext = {
  selectedTarget: ConnectionTarget;
};

type TargetedToolCallback<T> = (
  context: TargetedToolContext
) => Promise<AuditedActionResult<T>>;

export function createTextResponse(payload: unknown): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: formatRecordset(payload)
      }
    ]
  };
}

export function createRowCountAudit(recordset: unknown): JsonRecord {
  return {
    rowCount: countRows(recordset)
  };
}

export async function executeTargetedTool<T>(
  runtime: AppRuntime,
  toolName: string,
  targetName: string | undefined,
  buildContext: (selectedTarget: ConnectionTarget) => JsonRecord,
  action: TargetedToolCallback<T>
): Promise<T> {
  const selectedTarget = runtime.getTarget(targetName);

  return runtime.executeAudited(toolName, buildContext(selectedTarget), () =>
    action({ selectedTarget })
  );
}
