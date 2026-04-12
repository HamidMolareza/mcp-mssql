import type { AppRuntime, ToolResponse } from "../shared/types.js";
import { createTextResponse } from "./common.js";

export function buildListTargetsHandler(runtime: AppRuntime): () => Promise<ToolResponse> {
  return async () => {
    return runtime.executeAudited("list_targets", {}, async () => {
      const payload = {
        defaultTarget: runtime.config.defaultTarget ?? null,
        targets: runtime.config.targets.map((target) => ({
          name: target.name,
          description: target.description,
          host: target.host,
          defaultDatabase: target.defaultDatabase,
          port: target.port ?? 1433
        }))
      };

      return {
        response: createTextResponse(payload),
        audit: {
          targetCount: runtime.config.targets.length
        }
      };
    });
  };
}
