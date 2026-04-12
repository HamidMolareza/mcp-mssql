import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sql from "mssql";
import { z } from "zod";
import { loadEnvFile } from "./config/env.js";
import { loadTargets } from "./config/targets.js";
import { createLogger } from "./logging/logger.js";
import { buildQueryAudit, countRows, formatRecordset, summarizeError } from "./shared/format.js";
import type { ConnectionTarget } from "./shared/types.js";
import { parseTableReference, quoteSqlIdentifier } from "./sql/identifiers.js";
import { assertReadOnlyQuery } from "./sql/safety.js";

loadEnvFile(".env");

const logger = createLogger(
  process.env.MSSQL_MCP_LOG_FILE?.trim() || "./logs/mssql-mcp.log.jsonl"
);

function createPool(target: ConnectionTarget) {
  return new sql.ConnectionPool({
    user: target.user,
    password: target.password,
    server: target.host,
    port: target.port,
    database: target.defaultDatabase,
    options: {
      encrypt: target.options?.encrypt ?? false,
      trustServerCertificate: target.options?.trustServerCertificate ?? true
    }
  });
}

function buildInstructions(
  targets: ConnectionTarget[],
  defaultTarget?: string | null
): string {
  const lines = [
    "Use the SQL Server tools with the `target` argument to choose the correct server.",
    "If the task does not specify a target, choose based on the descriptions below."
  ];

  for (const target of targets) {
    const defaultSuffix = target.name === defaultTarget ? " (default target)" : "";
    lines.push(
      `- ${target.name}${defaultSuffix}: ${target.description}. Host: ${target.host}. Default database: ${target.defaultDatabase}.`
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const config = loadTargets();
  const targetMap = new Map(config.targets.map((target) => [target.name, target]));
  const poolCache = new Map<string, Promise<any>>();

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

  const getTarget = (targetName?: string): ConnectionTarget => {
    const normalizedTargetName = targetName?.trim();

    if (normalizedTargetName) {
      const target = targetMap.get(normalizedTargetName);

      if (!target) {
        throw new Error(`Unknown target: ${normalizedTargetName}`);
      }

      return target;
    }

    if (config.defaultTarget) {
      const defaultTarget = targetMap.get(config.defaultTarget);

      if (defaultTarget) {
        return defaultTarget;
      }
    }

    if (config.targets.length === 1) {
      return config.targets[0]!;
    }

    throw new Error("Multiple targets are configured. Specify the `target` argument.");
  };

  const getPool = async (targetName?: string) => {
    const target = getTarget(targetName);
    const existing = poolCache.get(target.name);

    if (existing) {
      return existing;
    }

    logger.info("db.connecting", {
      target: target.name,
      host: target.host,
      port: target.port ?? 1433,
      defaultDatabase: target.defaultDatabase
    });

    const poolPromise = Promise.resolve(createPool(target))
      .then(async (pool) => {
        await pool.connect();
        logger.info("db.connected", {
          target: target.name,
          host: target.host,
          port: target.port ?? 1433,
          defaultDatabase: target.defaultDatabase
        });
        return pool;
      })
      .catch((error) => {
        poolCache.delete(target.name);
        logger.error("db.connection_failed", {
          target: target.name,
          host: target.host,
          port: target.port ?? 1433,
          defaultDatabase: target.defaultDatabase,
          error: summarizeError(error)
        });
        throw error;
      });

    poolCache.set(target.name, poolPromise);
    return poolPromise;
  };

  const executeAudited = async <T>(
    toolName: string,
    context: Record<string, unknown>,
    action: () => Promise<{ response: T; audit?: Record<string, unknown> }>
  ): Promise<T> => {
    const startedAt = Date.now();
    logger.info("tool.started", { tool: toolName, ...context });

    try {
      const { response, audit } = await action();
      logger.info("tool.succeeded", {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        ...context,
        ...audit
      });
      return response;
    } catch (error) {
      logger.error("tool.failed", {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        ...context,
        error: summarizeError(error)
      });
      throw error;
    }
  };

  const server = new McpServer(
    {
      name: "mssql-mcp-server",
      version: "1.3.0"
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: buildInstructions(config.targets, config.defaultTarget)
    }
  );

  server.registerTool(
    "list_targets",
    {
      description: "List configured SQL Server targets and when each should be used.",
      annotations: {
        readOnlyHint: true
      }
    },
    async () => {
      return executeAudited("list_targets", {}, async () => {
        const payload = {
          defaultTarget: config.defaultTarget ?? null,
          targets: config.targets.map((target) => ({
            name: target.name,
            description: target.description,
            host: target.host,
            defaultDatabase: target.defaultDatabase,
            port: target.port ?? 1433
          }))
        };

        return {
          response: {
            content: [
              {
                type: "text" as const,
                text: formatRecordset(payload)
              }
            ]
          },
          audit: {
            targetCount: config.targets.length
          }
        };
      });
    }
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
    async ({ target }) => {
      const selectedTarget = getTarget(target);
      return executeAudited("list_databases", { target: selectedTarget.name }, async () => {
        const pool = await getPool(selectedTarget.name);
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
                type: "text" as const,
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
    }
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
    async ({ target, database, schema }) => {
      const selectedTarget = getTarget(target);
      return executeAudited(
        "list_tables",
        {
          target: selectedTarget.name,
          database: database.trim(),
          schema: schema?.trim() || null
        },
        async () => {
          const pool = await getPool(selectedTarget.name);
          const databaseName = quoteSqlIdentifier(database, "Database name");
          const result = await pool
            .request()
            .input("schema", sql.NVarChar, schema?.trim() || null)
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
            response: {
              content: [
                {
                  type: "text" as const,
                  text: formatRecordset({
                    target: selectedTarget.name,
                    database: database.trim(),
                    schema: schema?.trim() || null,
                    tables: result.recordset
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
    }
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
    async ({ target, database, table, schema }) => {
      const selectedTarget = getTarget(target);
      const { schemaName, tableName } = parseTableReference(table, schema);
      return executeAudited(
        "describe_table",
        {
          target: selectedTarget.name,
          database: database.trim(),
          schema: schemaName,
          table: tableName
        },
        async () => {
          const pool = await getPool(selectedTarget.name);
          const databaseName = quoteSqlIdentifier(database, "Database name");
          const result = await pool
            .request()
            .input("schema", sql.NVarChar, schemaName)
            .input("table", sql.NVarChar, tableName)
            .query(`
              SELECT
                TABLE_CATALOG,
                TABLE_SCHEMA,
                TABLE_NAME,
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION,
                NUMERIC_SCALE
              FROM ${databaseName}.INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = @schema
                AND TABLE_NAME = @table
              ORDER BY ORDINAL_POSITION
            `);

          if (result.recordset.length === 0) {
            throw new Error(
              `Table not found: ${database.trim()}.${schemaName}.${tableName}`
            );
          }

          return {
            response: {
              content: [
                {
                  type: "text" as const,
                  text: formatRecordset({
                    target: selectedTarget.name,
                    database: database.trim(),
                    schema: schemaName,
                    table: tableName,
                    columns: result.recordset
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
    }
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
    async ({ target, sql: query }) => {
      const selectedTarget = getTarget(target);
      const queryAudit = buildQueryAudit(query);
      return executeAudited(
        "query_sql",
        {
          target: selectedTarget.name,
          ...queryAudit
        },
        async () => {
          const pool = await getPool(selectedTarget.name);

          try {
            assertReadOnlyQuery(query);
          } catch (error) {
            logger.warn("security.query_blocked", {
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
                  type: "text" as const,
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
    }
  );

  const shutdown = async (): Promise<void> => {
    logger.info("server.shutdown_started");
    await server.close().catch(() => undefined);
    await Promise.all(
      [...poolCache.values()].map(async (poolPromise) =>
        poolPromise.then((pool) => pool.close()).catch(() => undefined)
      )
    );
    logger.info("server.shutdown_completed");
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
