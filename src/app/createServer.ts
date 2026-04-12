import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildInstructions } from "./instructions.js";
import { registerTools } from "../tools/registerTools.js";
import type { AppRuntime } from "../shared/types.js";

export function createServer(runtime: AppRuntime): McpServer {
  const server = new McpServer(
    {
      name: "mssql-mcp-server",
      version: "1.3.0"
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: buildInstructions(runtime.config.targets, runtime.config.defaultTarget)
    }
  );

  registerTools(server, runtime);
  return server;
}
