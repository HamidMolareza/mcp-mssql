import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./app/createServer.js";
import { createAppRuntime } from "./app/runtime.js";
import { loadEnvFile } from "./config/env.js";
import { loadTargets } from "./config/targets.js";
import { createLogger } from "./logging/logger.js";
import { summarizeError } from "./shared/format.js";

loadEnvFile(".env");

const logger = createLogger(
  process.env.MSSQL_MCP_LOG_FILE?.trim() || "./logs/mssql-mcp.log.jsonl"
);

async function main(): Promise<void> {
  const config = loadTargets();
  const runtime = createAppRuntime(config, logger);

  logger.info("server.starting", {
    logFilePath: logger.logFilePath,
    targetCount: config.targets.length,
    defaultTarget: config.defaultTarget ?? null,
    targets: config.targets.map((target) => ({
      name: target.name,
      host: target.host,
      defaultDatabase: target.defaultDatabase
    }))
  });

  const server = createServer(runtime);

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => undefined);
    await runtime.shutdown();
  };

  process.once("SIGINT", () => {
    logger.warn("server.signal_received", { signal: "SIGINT" });
    void shutdown().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    logger.warn("server.signal_received", { signal: "SIGTERM" });
    void shutdown().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("server.ready");
}

main().catch((error: unknown) => {
  logger.error("server.startup_failed", {
    error: summarizeError(error)
  });
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start mssql MCP server: ${message}`);
  process.exit(1);
});
