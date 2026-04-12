import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppRuntime } from "../shared/types.js";
import { buildDescribeTableHandler } from "./describeTable.js";
import { buildListDatabasesHandler } from "./listDatabases.js";
import { buildListTablesHandler } from "./listTables.js";
import { buildListTargetsHandler } from "./listTargets.js";
import { buildQuerySqlHandler } from "./querySql.js";

export function registerTools(server: McpServer, runtime: AppRuntime): void {
  server.registerTool(
    "list_targets",
    {
      description: "List configured SQL Server targets and when each should be used.",
      annotations: {
        readOnlyHint: true
      }
    },
    buildListTargetsHandler(runtime)
  );

  server.registerTool(
    "list_databases",
    {
      description: "List databases available on a SQL Server target.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .optional()
          .describe("Connection target name. Required when multiple targets are configured.")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    buildListDatabasesHandler(runtime)
  );

  server.registerTool(
    "list_tables",
    {
      description: "List base tables in the selected database, optionally filtered by schema.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .optional()
          .describe("Connection target name. Required when multiple targets are configured."),
        database: z.string().min(1).describe("Database name"),
        schema: z.string().min(1).optional().describe("Optional schema filter")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    buildListTablesHandler(runtime)
  );

  server.registerTool(
    "describe_table",
    {
      description: "Describe a table in a selected database.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .optional()
          .describe("Connection target name. Required when multiple targets are configured."),
        database: z.string().min(1).describe("Database name"),
        table: z.string().min(1).describe("Table name or schema-qualified table name"),
        schema: z.string().min(1).optional().describe("Optional schema when `table` is not qualified")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    buildDescribeTableHandler(runtime)
  );

  server.registerTool(
    "query_sql",
    {
      description: "Run a read-only SQL query (SELECT/CTE only).",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .optional()
          .describe("Connection target name. Required when multiple targets are configured."),
        sql: z.string().min(1).describe("Read-only SQL query")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    buildQuerySqlHandler(runtime)
  );
}
