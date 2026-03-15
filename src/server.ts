import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sql from "mssql";
import { z } from "zod";

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_@$#]*$/;
const WRITE_QUERY_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|create|merge|exec(?:ute)?|grant|revoke|deny)\b/i;
const READ_QUERY_PATTERN = /^(select|with)\b/i;

loadEnvFile(".env");

type ConnectionTarget = {
  name: string;
  description: string;
  host: string;
  user: string;
  password: string;
  defaultDatabase: string;
  port?: number;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
  };
};

type TargetConfigFile = {
  defaultTarget?: string | null;
  targets: ConnectionTarget[];
};

function loadEnvFile(fileName: string): void {
  const filePath = resolve(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return;
  }

  const fileContents = readFileSync(filePath, "utf8");

  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = stripOptionalQuotes(value);
  }
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function ensureNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

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

function loadTargets(): TargetConfigFile {
  const targetsFile = process.env.MSSQL_TARGETS_FILE?.trim();

  if (targetsFile) {
    const filePath = resolve(process.cwd(), targetsFile);

    if (!existsSync(filePath)) {
      throw new Error(`Targets file not found: ${filePath}`);
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<TargetConfigFile>;
    const targets = (parsed.targets ?? []).map(normalizeTarget);

    if (targets.length === 0) {
      throw new Error("Targets file must include at least one target.");
    }

    if (
      parsed.defaultTarget !== undefined &&
      parsed.defaultTarget !== null &&
      !targets.some((target) => target.name === parsed.defaultTarget)
    ) {
      throw new Error(`Unknown defaultTarget: ${parsed.defaultTarget}`);
    }

    return parsed.defaultTarget !== undefined
      ? {
          defaultTarget: parsed.defaultTarget,
          targets
        }
      : {
          targets
        };
  }

  return {
    defaultTarget: "default",
    targets: [
      normalizeTarget({
        name: "default",
        description:
          process.env.DB_DESCRIPTION?.trim() ||
          "Default SQL Server target loaded from DB_* environment variables.",
        host: requireEnv("DB_HOST"),
        user: requireEnv("DB_USER"),
        password: requireEnv("DB_PASSWORD"),
        defaultDatabase: requireEnv("DB_NAME")
      })
    ]
  };
}

function normalizeTarget(input: Partial<ConnectionTarget>): ConnectionTarget {
  const name = ensureNonEmpty(input.name ?? "", "Target name");

  if (!SQL_IDENTIFIER.test(name)) {
    throw new Error(`Invalid target name: ${name}`);
  }

  const normalizedTarget: ConnectionTarget = {
    name,
    description: ensureNonEmpty(
      input.description ?? "",
      `Description for target ${name}`
    ),
    host: ensureNonEmpty(input.host ?? "", `Host for target ${name}`),
    user: ensureNonEmpty(input.user ?? "", `User for target ${name}`),
    password: ensureNonEmpty(input.password ?? "", `Password for target ${name}`),
    defaultDatabase: ensureNonEmpty(
      input.defaultDatabase ?? "",
      `Default database for target ${name}`
    ),
    options: {
      encrypt: input.options?.encrypt ?? false,
      trustServerCertificate: input.options?.trustServerCertificate ?? true
    }
  };

  if (input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port <= 0) {
      throw new Error(`Invalid port for target ${name}`);
    }

    normalizedTarget.port = input.port;
  }

  return normalizedTarget;
}

function quoteSqlIdentifier(identifier: string, label: string): string {
  const trimmed = identifier.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  if (trimmed.includes("\u0000")) {
    throw new Error(`${label} contains invalid characters.`);
  }

  return `[${trimmed.replaceAll("]", "]]")}]`;
}

function parseTableReference(
  tableReference: string,
  schema?: string
): { schemaName: string; tableName: string } {
  const reference = tableReference.trim();

  if (!reference) {
    throw new Error("Table name is required.");
  }

  const segments = reference
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.length > 2) {
    throw new Error("Use `table` or `schema.table` format.");
  }

  if (segments.length === 2 && schema?.trim()) {
    throw new Error("Provide either `schema` or `schema.table`, not both.");
  }

  const schemaName =
    segments.length === 2
      ? (segments[0] ?? "").trim()
      : (schema?.trim() || "dbo").trim();
  const tableName = segments.at(-1)?.trim() ?? "";

  if (!SQL_IDENTIFIER.test(schemaName) || !SQL_IDENTIFIER.test(tableName)) {
    throw new Error("Schema and table names must be simple SQL identifiers.");
  }

  return { schemaName, tableName };
}

function normalizeQuery(query: string): string {
  return query
    .replace(/--.*$/gmu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/^\s*;+/u, "")
    .trim();
}

function assertReadOnlyQuery(query: string): void {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    throw new Error("SQL query cannot be empty.");
  }

  if (WRITE_QUERY_PATTERN.test(normalizedQuery)) {
    throw new Error("Only read-only SQL statements are allowed.");
  }

  if (!READ_QUERY_PATTERN.test(normalizedQuery)) {
    throw new Error("Query must start with SELECT or WITH.");
  }
}

function formatRecordset(recordset: unknown): string {
  return JSON.stringify(recordset, null, 2);
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

    const poolPromise = Promise.resolve(createPool(target)).then(async (pool) => {
      await pool.connect();
      return pool;
    });

    poolCache.set(target.name, poolPromise);
    return poolPromise;
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
      return {
        content: [
          {
            type: "text",
            text: formatRecordset({
              defaultTarget: config.defaultTarget ?? null,
              targets: config.targets.map((target) => ({
                name: target.name,
                description: target.description,
                host: target.host,
                defaultDatabase: target.defaultDatabase,
                port: target.port ?? 1433
              }))
            })
          }
        ]
      };
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
        content: [
          {
            type: "text",
            text: formatRecordset({
              target: selectedTarget.name,
              databases: result.recordset
            })
          }
        ]
      };
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
        content: [
          {
            type: "text",
            text: formatRecordset({
              target: selectedTarget.name,
              database: database.trim(),
              schema: schema?.trim() || null,
              tables: result.recordset
            })
          }
        ]
      };
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
      const pool = await getPool(selectedTarget.name);
      const databaseName = quoteSqlIdentifier(database, "Database name");
      const { schemaName, tableName } = parseTableReference(table, schema);
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
        throw new Error(`Table not found: ${database.trim()}.${schemaName}.${tableName}`);
      }

      return {
        content: [
          {
            type: "text",
            text: formatRecordset({
              target: selectedTarget.name,
              database: database.trim(),
              schema: schemaName,
              table: tableName,
              columns: result.recordset
            })
          }
        ]
      };
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
      const pool = await getPool(selectedTarget.name);
      assertReadOnlyQuery(query);

      const result = await pool.request().query(query);

      return {
        content: [
          {
            type: "text",
            text: formatRecordset({
              target: selectedTarget.name,
              rows: result.recordset
            })
          }
        ]
      };
    }
  );

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => undefined);
    await Promise.all(
      [...poolCache.values()].map(async (poolPromise) =>
        poolPromise.then((pool) => pool.close()).catch(() => undefined)
      )
    );
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start mssql MCP server: ${message}`);
  process.exit(1);
});
